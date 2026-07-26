import { debug } from './log.js';
import { getBlueskyAuth, debugId } from './bot.js';
import { recordContent } from './feedback.js';
import { LocalStorage } from './kv.js';
import { postMastodonStatus, getMastodonStatus, createBlueskyRecord } from './social.js';
import { stripHtml, stripMentions, normalizeWhitespace } from './text.js';

// Default Workers AI text-generation model. Gemma 4 26B A4B is a Mixture-of-
// Experts model (26B total params, ~4B active per pass), so it runs close to
// 4B-model speed while keeping larger-model quality. Override via WORKERS_AI_MODEL.
const DEFAULT_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

// Workers AI binding (env.AI), injected by the Worker at request/cron time.
let aiBinding = null;
function initAI(binding) {
    aiBinding = binding;
}

// The Workers AI model currently used for replies (also stored on feedback
// records so votes can be compared across model swaps).
function getReplyModel() {
    return process.env.WORKERS_AI_MODEL || DEFAULT_AI_MODEL;
}

// Workers AI returns different shapes depending on the model. Classic
// text-generation models return { response }, while others (e.g. Gemma 4, which
// reports itself as "...-external") return an OpenAI-style chat completion with
// { choices: [{ message: { content } }] }. Support both so a model swap doesn't
// silently drop every reply.
function extractReplyText(result) {
    if (!result) {
        return '';
    }
    let raw = '';
    if (typeof result.response === 'string') {
        raw = result.response;
    } else {
        const choice = Array.isArray(result.choices) ? result.choices[0] : null;
        if (choice) {
            const content = choice.message?.content ?? choice.text;
            if (typeof content === 'string') {
                raw = content;
            } else if (Array.isArray(content)) {
                // Some providers return content as an array of parts.
                raw = content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
            }
        }
    }
    // Thinking-mode models may inline their reasoning in a <think> block; keep
    // only the answer that follows it.
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
}

// Cache to store our bot's recent posts
const recentPosts = new Map();

// KV namespace for storing posts
let _postsKV = null;
let kvInitialized = false;
const _localStorage = new LocalStorage();

// Initialize KV namespace
async function initializeKV(namespace) {
    if (!namespace) {
        debug('No KV namespace provided, using local storage', 'warn');
        _postsKV = _localStorage;
    } else {
        _postsKV = namespace;
    }
    kvInitialized = true;
}

// Helper to get KV namespace
function getKVNamespace() {
    return _postsKV;
}

// Load recent posts from KV storage
async function loadRecentPostsFromKV() {
    if (!kvInitialized) {
        throw new Error('Cannot load posts - KV not initialized');
    }

    try {
        const kv = getKVNamespace();
        debug('Loading posts from storage...', 'info');

        const { keys } = await kv.list({ prefix: 'post:' });
        const posts = await Promise.all(keys.map(key => kv.get(key.name)));

        // Clear existing cache before loading
        recentPosts.clear();

        keys.forEach((key, i) => {
            const post = posts[i];
            if (post) {
                // Keep everything after "post:" verbatim: Bluesky ids are AT URIs
                // (at://did:plc:.../...) that themselves contain colons, so a naive
                // split(':') would truncate them to "bluesky:at" and collide.
                recentPosts.set(key.name.slice('post:'.length), JSON.parse(post));
            }
        });

        debug('Loaded posts from storage', 'info', { count: recentPosts.size });
    } catch (error) {
        debug('Error loading posts from storage:', 'error', error);
        throw error;
    }
}

// Helper function to extract post ID from Mastodon URL
function extractMastodonPostId(url) {
    const match = url.match(/\/(\d+)$/);
    return match ? match[1] : null;
}

// Helper function to extract post ID from Bluesky URL
function extractBlueskyPostId(url) {
    debug('Extracting Bluesky post ID from URL:', 'verbose', url);
    const match = url.match(/\/post\/([a-zA-Z0-9]+)$/);
    debug('Match result:', 'verbose', match);
    return match ? match[1] : null;
}

// Helper function to extract handle from Bluesky URL
function extractBlueskyHandle(url) {
    debug('Extracting Bluesky handle from URL:', 'verbose', url);
    const match = url.match(/\/profile\/([^/]+)/);
    debug('Match result:', 'verbose', match);
    return match ? match[1] : null;
}

// Fetch post content from Mastodon URL
async function fetchMastodonPost(url) {
    try {
        const postId = extractMastodonPostId(url);
        if (!postId) {
            throw new Error('Invalid Mastodon post URL');
        }

        const response = await getMastodonStatus(postId);

        if (!response.ok) {
            throw new Error('Failed to fetch Mastodon post');
        }

        const post = await response.json();
        return stripHtml(post.content);
    } catch (error) {
        debug('Error fetching Mastodon post:', 'error', error);
        return null;
    }
}

// Fetch post content from Bluesky URL
async function fetchBlueskyPost(url) {
    try {
        const postId = extractBlueskyPostId(url);
        debug('Extracted post ID:', 'verbose', postId);
        if (!postId) {
            throw new Error('Invalid Bluesky post URL - could not extract post ID');
        }

        const handle = extractBlueskyHandle(url);
        debug('Extracted handle:', 'verbose', handle);
        if (!handle) {
            throw new Error('Invalid Bluesky URL format - could not extract handle');
        }

        const apiUrl = `${process.env.BLUESKY_API_URL}/xrpc/com.atproto.repo.getRecord?repo=${handle}&collection=app.bsky.feed.post&rkey=${postId}`;
        debug('Fetching from URL:', 'verbose', apiUrl);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            debug('Bluesky API error:', 'error', errorText);
            throw new Error(`Failed to fetch Bluesky post: ${response.status} ${response.statusText}`);
        }

        const post = await response.json();
        debug('Received post data:', 'verbose', post);
        return post.value.text;
    } catch (error) {
        debug('Error fetching Bluesky post:', 'error', error);
        return null;
    }
}

// Fetch post content from URL
async function fetchPostContent(postUrl) {
    if (postUrl.includes('mastodon') || postUrl.includes('hachyderm.io')) {
        return await fetchMastodonPost(postUrl);
    } else if (postUrl.includes('bsky.app')) {
        return await fetchBlueskyPost(postUrl);
    } else {
        throw new Error('Unsupported platform URL');
    }
}

// Store a new post from our bot
async function storeRecentPost(platform, postId, content) {
    debug('Storing recent post', 'info', {
        platform,
        postId,
        content: content.substring(0, 50) + '...',
        cacheSize: recentPosts.size
    });

    const key = `${platform}:${postId}`;
    const post = { content, timestamp: Date.now() };
    
    // Store in memory
    recentPosts.set(key, post);

    // Store in storage
    try {
        const kv = getKVNamespace();
        if (!kv) {
            throw new Error('Storage not initialized');
        }

        await kv.put(`post:${key}`, JSON.stringify(post));
        debug('Stored post in storage', 'info', { 
            key,
            postCount: recentPosts.size,
            storage: 'KV'
        });

        // Clean up old posts (older than 24 hours)
        const now = Date.now();
        const oldPosts = [];
        for (const [existingKey, existingPost] of recentPosts.entries()) {
            if (now - existingPost.timestamp > 24 * 60 * 60 * 1000) {
                oldPosts.push(existingKey);
            }
        }

        // Remove old posts
        for (const oldKey of oldPosts) {
            debug('Removing old post', 'info', { key: oldKey });
            recentPosts.delete(oldKey);
            await kv.delete(`post:${oldKey}`);
        }

        debug('Storage cleanup complete', 'info', {
            removed: oldPosts.length,
            remaining: recentPosts.size
        });
    } catch (error) {
        debug('Error in post storage:', 'error', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Get the original post content
async function getOriginalPost(platform, postId) {
    const key = `${platform}:${postId}`;
    debug('Getting original post', 'info', { key, exists: recentPosts.has(key) });

    // First check memory cache
    let post = recentPosts.get(key);
    
    // If not in memory, try loading from storage
    if (!post) {
        try {
            const kv = getKVNamespace();
            const storedPost = await kv.get(`post:${key}`);
            if (storedPost) {
                try {
                    post = JSON.parse(storedPost);
                    // Add back to memory cache
                    recentPosts.set(key, post);
                    debug('Loaded post from storage', 'info', { 
                        key,
                        content: post.content?.substring(0, 50)
                    });
                } catch (parseError) {
                    debug('Error parsing stored post:', 'error', {
                        error: parseError,
                        storedPost
                    });
                }
            } else {
                debug('Post not found in storage', 'info', { key });
            }
        } catch (error) {
            debug('Error loading post from storage:', 'error', error);
        }
    }

    if (!post || !post.content) {
        debug('Post not found in cache or storage', 'info', { 
            key,
            hasPost: !!post,
            hasContent: !!(post && post.content)
        });
        return null;
    }

    debug('Found post', 'info', { 
        key, 
        content: post.content.substring(0, 50) + '...'
    });
    return post.content;
}

// Track backoff state for Workers AI (exponential backoff after a capacity error)
const INITIAL_BACKOFF_MINUTES = 5;
const rateLimitState = {
    backoffMinutes: INITIAL_BACKOFF_MINUTES,
    maxBackoffMinutes: 60,
    resetTime: null
};

// Fallback responses used while rate limited
const fallbackResponses = [
    'Hmm, I need a moment to think about that one...',
    'My circuits are a bit overloaded right now...',
    'Give me a minute to process that...',
    'Taking a quick break to cool my processors...',
    'Sometimes even bots need a moment to reflect...',
    'Processing... please stand by...'
];

// Get a random fallback response
function getFallbackResponse() {
    const index = Math.floor(Math.random() * fallbackResponses.length);
    return fallbackResponses[index];
}

// Generate a reply using Workers AI (Gemma 4 by default).
async function generateReply(originalPost, replyContent) {
    try {
        if (!originalPost || !replyContent) {
            debug('Missing required content for reply generation', 'error', {
                hasOriginalPost: !!originalPost,
                hasReplyContent: !!replyContent
            });
            return null;
        }

        if (!aiBinding) {
            debug('Workers AI binding not initialized, cannot generate reply', 'error');
            return null;
        }

        debug('Generating reply with Workers AI', 'info', {
            originalPost: originalPost?.substring(0, 100),
            replyContent: replyContent?.substring(0, 100)
        });

        // Strip HTML, mentions, and extra whitespace from both sides of the thread.
        const clean = (text) => normalizeWhitespace(stripMentions(stripHtml(text)));
        const cleanOriginal = clean(originalPost);
        const cleanReplyContent = clean(replyContent);

        // If we're still inside a backoff window, skip the call and use a fallback.
        if (rateLimitState.resetTime && Date.now() < rateLimitState.resetTime) {
            debug('Workers AI backing off, using fallback response', 'warn', {
                resetTime: new Date(rateLimitState.resetTime).toISOString()
            });
            return getFallbackResponse();
        }

        // Tight system prompt keeps input tokens (and latency) low; the reply
        // itself is short, so max_tokens is capped well under the model default.
        const messages = [
            {
                role: 'system',
                content: 'You are a witty, engaging social media bot. Reply with one clever, concise, respectful line under 400 characters. Do not include @mentions, usernames, or hashtags unless clearly relevant. Output only the reply text.'
            },
            {
                role: 'user',
                content: `Original post: "${cleanOriginal}"\nReply to it: "${cleanReplyContent}"`
            }
        ];

        const model = getReplyModel();
        const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '2000', 10);
        const temperature = parseFloat(process.env.AI_TEMPERATURE || '0.7');

        let result;
        try {
            result = await aiBinding.run(model, { messages, max_tokens: maxTokens, temperature });
        } catch (aiError) {
            // Treat inference/capacity errors as a signal to back off exponentially.
            rateLimitState.resetTime = Date.now() + rateLimitState.backoffMinutes * 60 * 1000;
            debug('Workers AI call failed, backing off', 'warn', {
                error: aiError.message,
                backoffMinutes: rateLimitState.backoffMinutes,
                resetTime: new Date(rateLimitState.resetTime).toISOString()
            });
            rateLimitState.backoffMinutes = Math.min(
                rateLimitState.backoffMinutes * 2,
                rateLimitState.maxBackoffMinutes
            );
            return getFallbackResponse();
        }

        // Successful call — clear any backoff state.
        rateLimitState.backoffMinutes = INITIAL_BACKOFF_MINUTES;
        rateLimitState.resetTime = null;

        const reply = extractReplyText(result);
        if (!reply) {
            // console.log truncates nested objects to [Object], which hides the
            // actual shape — describe it explicitly so failures are diagnosable.
            const choice = Array.isArray(result?.choices) ? result.choices[0] : null;
            const message = choice?.message || {};
            debug('No reply generated from Workers AI', 'warn', {
                finishReason: choice?.finish_reason,
                choiceKeys: choice ? Object.keys(choice) : null,
                messageKeys: Object.keys(message),
                contentLength: typeof message.content === 'string' ? message.content.length : null,
                reasoningLength: typeof message.reasoning_content === 'string' ? message.reasoning_content.length : null,
                usage: result?.usage,
                hint: choice?.finish_reason === 'length'
                    ? 'Model hit max_tokens before answering (thinking mode). Raise AI_MAX_TOKENS.'
                    : undefined
            });
            return null;
        }

        // A reply cut off at the token limit reads badly; surface it so
        // AI_MAX_TOKENS can be raised.
        if (result?.choices?.[0]?.finish_reason === 'length') {
            debug('Workers AI response hit the token limit; consider raising AI_MAX_TOKENS', 'warn', {
                maxTokens,
                completionTokens: result?.usage?.completion_tokens
            });
        }

        // Clean up any remaining mentions or wrapping quotes.
        const cleanReply = stripMentions(reply)
            .replace(/^["']|["']$/g, '')
            .trim();

        debug('Generated reply', 'info', { reply: cleanReply });
        return cleanReply;
    } catch (error) {
        debug('Error generating reply:', 'error', error);
        return null;
    }
}

// Handle a reply on Mastodon
async function handleMastodonReply(notification) {
    try {
        debug('Processing Mastodon reply...', 'info', {
            id: notification.id,
            type: notification.type,
            account: notification.account?.username,
            status: {
                id: notification.status.id,
                content: notification.status.content,
                in_reply_to_id: notification.status.in_reply_to_id
            }
        });

        // Check if we've already replied to this notification
        const replyKey = `replied:mastodon:${notification.id}`;
        const hasReplied = await getKVNamespace().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this notification', 'info', { replyKey });
            return;
        }

        // Clean the content
        const content = notification.status.content;
        const cleanedContent = normalizeWhitespace(stripHtml(content));

        debug('Cleaned content', 'info', {
            original: content,
            cleaned: cleanedContent
        });

        // Get the original post we're replying to
        const originalPostId = notification.status.in_reply_to_id;
        
        // Try to get the original post from our cache first
        let originalPost = await getOriginalPost('mastodon', originalPostId);
        
        // If not in cache, fetch it from Mastodon
        if (!originalPost) {
            debug('Original post not in cache, fetching from Mastodon...', 'info', { originalPostId });
            
            const response = await getMastodonStatus(originalPostId);

            if (!response.ok) {
                debug('Failed to fetch original post', 'error', {
                    status: response.status,
                    statusText: response.statusText
                });
                return;
            }

            const post = await response.json();
            originalPost = post.content;
            
            // Store the post for future reference
            await storeRecentPost('mastodon', originalPostId, originalPost);
        }

        // If we still don't have the original post, skip
        if (!originalPost) {
            debug('Could not find original post, skipping', 'warn', { originalPostId });
            return;
        }

        // Check if this is a reply to our own post
        const isOurPost = await getOriginalPost('mastodon', notification.status.id);
        if (isOurPost) {
            debug('Skipping reply to our own post', 'info', { postId: notification.status.id });
            // Mark as replied to prevent future processing
            await getKVNamespace().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
            return;
        }

        // Generate and post the reply
        const reply = await generateReply(originalPost, cleanedContent);
        if (!reply) {
            debug('No reply generated', 'warn');
            // Still mark as processed to prevent retries
            await getKVNamespace().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
            return;
        }

        // Add the user mention to the reply
        const userHandle = notification.account?.acct || notification.account?.username;
        const replyWithMention = `@${userHandle} ${reply}`;

        // Post the reply
        if (process.env.DEBUG_MODE !== 'true') {
            const response = await postMastodonStatus({
                status: replyWithMention,
                in_reply_to_id: notification.status.id,  // Reply to the notification that mentioned us
                visibility: 'public'
            });

            if (!response.ok) {
                debug('Failed to post reply', 'error', {
                    status: response.status,
                    statusText: response.statusText
                });
                return;
            }

            const postedReply = await response.json();
            await storeRecentPost('mastodon', postedReply.id, replyWithMention);
            await recordContent({
                type: 'reply',
                platform: 'mastodon',
                id: postedReply.id,
                content: replyWithMention,
                context: originalPost,
                model: getReplyModel()
            });

            // Mark as replied to prevent duplicate replies
            await getKVNamespace().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
            
            debug('Successfully posted reply', 'info', {
                replyId: postedReply.id,
                inReplyTo: notification.status.id,
                userHandle,
                content: replyWithMention
            });
        } else {
            debug('Debug mode: Would have posted reply', 'info', {
                content: replyWithMention,
                inReplyTo: notification.status.id,
                userHandle
            });
            await recordContent({
                type: 'reply',
                platform: 'mastodon',
                id: debugId(),
                content: replyWithMention,
                context: originalPost,
                model: getReplyModel()
            });
            // Even in debug mode, mark as replied to prevent duplicate processing
            await getKVNamespace().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
        }
    } catch (error) {
        debug('Error handling Mastodon reply:', 'error', error);
    }
}

// Handle replies on Bluesky
async function handleBlueskyReply(notification) {
    try {
        debug('Processing Bluesky reply...', notification);

        // Load recent posts from storage if needed
        if (recentPosts.size === 0) {
            await loadRecentPostsFromKV();
        }

        // Check if this is a reply to one of our posts
        const originalPost = await getOriginalPost('bluesky', notification.reasonSubject);
        if (!originalPost) {
            debug('Not a reply to our post', 'info', {
                replyToId: notification.reasonSubject,
                recentPostsCount: recentPosts.size,
                recentPostKeys: Array.from(recentPosts.keys())
            });
            return;
        }

        // Check if we've already replied to this post
        const replyKey = `replied:bluesky:${notification.uri}`;
        const hasReplied = await getKVNamespace().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this post', 'info', { replyKey });
            return;
        }

        // Generate the reply
        const generatedReply = await generateReply(originalPost, notification.record.text);
        if (!generatedReply) {
            debug('Failed to generate reply');
            return;
        }

        // In debug mode, just log what would have been posted
        if (process.env.DEBUG_MODE === 'true') {
            debug('Debug mode: Would reply to Bluesky post', 'info', {
                originalPost,
                replyTo: notification.record.text,
                generatedReply,
                notification
            });
            await recordContent({
                type: 'reply',
                platform: 'bluesky',
                id: debugId(),
                content: generatedReply,
                context: originalPost,
                model: getReplyModel()
            });
            // Still store that we "replied" to prevent duplicate debug logs
            await getKVNamespace().put(replyKey, 'true');
            debug('Marked post as replied to (debug mode)', 'info', { replyKey });
            return;
        }

        // Get auth token
        const auth = await getBlueskyAuth();
        if (!auth || !auth.accessJwt) {
            throw new Error('Failed to authenticate with Bluesky');
        }

        // Create the post (host resolution handled by the shared helper)
        const response = await createBlueskyRecord(auth, {
            text: generatedReply,
            reply: {
                root: {
                    uri: notification.reasonSubject,
                    cid: notification.record.reply?.root?.cid
                },
                parent: {
                    uri: notification.uri,
                    cid: notification.cid
                }
            },
            createdAt: new Date().toISOString()
        });

        if (!response.ok) {
            const errorData = await response.text();
            debug('Error response from Bluesky:', 'error', {
                status: response.status,
                statusText: response.statusText,
                error: errorData
            });
            throw new Error(`Failed to post reply: ${errorData}`);
        }

        // Record the reply for feedback, then mark this post as replied to
        const postedReply = await response.json();
        await recordContent({
            type: 'reply',
            platform: 'bluesky',
            id: postedReply.uri || notification.uri,
            content: generatedReply,
            context: originalPost,
            model: getReplyModel()
        });
        await getKVNamespace().put(replyKey, 'true');
        debug('Successfully replied to Bluesky post', 'info', { replyKey });

    } catch (error) {
        debug('Error handling Bluesky reply:', 'error', error);
    }
}

// Export all functions
export {
    handleMastodonReply,
    handleBlueskyReply,
    generateReply,
    fetchPostContent,
    loadRecentPostsFromKV,
    storeRecentPost,
    getOriginalPost,
    initializeKV,
    initAI
};
