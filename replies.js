import { debug, getBlueskyAuth } from './bot.js';

// Cache to store our bot's recent posts
const recentPosts = new Map();

// Local storage for development
class LocalStorage {
    constructor() {
        this.store = new Map();
    }

    async put(key, value) {
        this.store.set(key, value);
        return Promise.resolve();
    }

    async get(key) {
        return Promise.resolve(this.store.get(key));
    }

    async delete(key) {
        this.store.delete(key);
        return Promise.resolve();
    }

    async list({ prefix }) {
        const keys = Array.from(this.store.keys())
            .filter(key => key.startsWith(prefix))
            .map(name => ({ name }));
        return Promise.resolve({ keys });
    }
}

// KV namespace for storing posts
let postsKV = null;
let kvInitialized = false;
const localStorage = new LocalStorage();

// Initialize KV namespace
async function initializeKV(kv) {
    if (!kv) {
        debug('No KV namespace provided, using local storage', 'warn');
        postsKV = localStorage;
        kvInitialized = true;
        return;
    }
    
    try {
        // Test if the KV binding is working
        await kv.list({ prefix: 'test' });
        postsKV = kv;
        kvInitialized = true;
        debug('Successfully initialized KV namespace', 'info');
    } catch (error) {
        debug('Error during KV initialization, using local storage', 'warn', error);
        postsKV = localStorage;
        kvInitialized = true;
    }
}

// Helper to get storage
function getStorage() {
    if (!kvInitialized) {
        throw new Error('KV not initialized - call initializeKV first');
    }
    if (!postsKV) {
        debug('No storage available after initialization, using local storage', 'warn');
        postsKV = localStorage;
    }
    return postsKV;
}

// Helper to get KV namespace
function getKVNamespace() {
    return getStorage();
}

// Load recent posts from KV storage
async function loadRecentPostsFromKV() {
    if (!kvInitialized) {
        throw new Error('Cannot load posts - KV not initialized');
    }

    try {
        const kv = getStorage();
        debug('Loading posts from storage...', 'info');

        const { keys } = await kv.list({ prefix: 'post:' });
        debug('Found posts in storage', 'info', { count: keys.length });

        // Clear existing cache before loading
        recentPosts.clear();

        for (const key of keys) {
            const post = await kv.get(key.name);
            if (post) {
                const [platform, postId] = key.name.replace('post:', '').split(':');
                const parsedPost = JSON.parse(post);
                recentPosts.set(`${platform}:${postId}`, parsedPost);
                debug('Loaded post', 'info', { 
                    platform,
                    postId,
                    content: parsedPost.content.substring(0, 50) + '...'
                });
            }
        }
        
        debug('Loaded all posts from storage', 'info', {
            count: recentPosts.size,
            keys: Array.from(recentPosts.keys())
        });
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

        const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses/${postId}`, {
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch Mastodon post');
        }

        const post = await response.json();
        return post.content.replace(/<[^>]+>/g, ''); // Strip HTML tags
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
        const kv = getStorage();
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
    debug('Getting original post', 'info', {
        platform,
        postId,
        key,
        exists: recentPosts.has(key),
        cacheSize: recentPosts.size,
        cacheKeys: Array.from(recentPosts.keys())
    });

    const post = recentPosts.get(key);
    if (!post) {
        debug('Post not found in cache', 'info', { key });
        return null;
    }

    return post.content;
}

// Track rate limit state
const rateLimitState = {
    lastError: null,
    backoffMinutes: 5,
    maxBackoffMinutes: 60,
    resetTime: null
};

// Fallback responses when rate limited
const fallbackResponses = [
    "My AI brain needs a quick nap! 😴 I'll be back with witty responses soon!",
    "Taking a brief creative break! Check back in a bit for more banter! 🎭",
    "Currently recharging my joke batteries! 🔋 Will be back with fresh material soon!",
    "In a brief meditation session to expand my wit! 🧘‍♂️ Back shortly!",
    "Temporarily out of clever responses - but I'll return with double the humor! ✨",
    "My pun generator is cooling down! Will be back with more wordplay soon! 🎮",
    "Taking a quick comedy workshop! Back soon with fresh material! 🎭",
    "Briefly offline doing stand-up practice! 🎤 Return in a bit for the good stuff!"
];

function getFallbackResponse() {
    const randomIndex = Math.floor(Math.random() * fallbackResponses.length);
    return fallbackResponses[randomIndex];
}

// Generate a reply using OpenAI
async function generateReply(originalPost, replyContent) {
    try {
        debug('Generating reply with OpenAI', 'info', {
            originalPost: originalPost?.substring(0, 100),
            replyContent: replyContent?.substring(0, 100)
        });

        // Clean up the posts
        const cleanOriginal = originalPost
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/@[\w]+/g, '') // Remove user mentions
            .trim();

        const cleanReplyContent = replyContent
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .replace(/@[\w]+/g, '') // Remove user mentions
            .trim();

        // Create the prompt
        const prompt = `As a witty and engaging social media bot, generate a brief, clever reply to this conversation. 
DO NOT include any @mentions or usernames in your response - those will be handled separately.
DO NOT use hashtags unless they're contextually relevant.
Keep the response under 400 characters.

Original post: "${cleanOriginal}"
Reply to original: "${cleanReplyContent}"

Generate a witty response that:
1. Is relevant to the conversation
2. Shows personality but stays respectful
3. Encourages further engagement
4. Is concise and to the point

Your response:`;

        // Get completion from OpenAI
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                temperature: 0.7,
                max_tokens: 150
            })
        });

        if (!response.ok) {
            debug('OpenAI API error:', 'error', {
                status: response.status,
                statusText: response.statusText
            });
            return null;
        }

        const data = await response.json();
        const reply = data.choices[0]?.message?.content?.trim();

        if (!reply) {
            debug('No reply generated from OpenAI', 'warn');
            return null;
        }

        // Clean up any remaining mentions or formatting
        const cleanReply = reply
            .replace(/@[\w]+/g, '') // Remove any mentions that might have slipped through
            .replace(/^["']|["']$/g, '') // Remove quotes if present
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
        const hasReplied = await getStorage().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this notification', 'info', { replyKey });
            return;
        }

        // Clean the content
        const content = notification.status.content;
        const cleanedContent = content
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

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
            
            const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses/${originalPostId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`
                }
            });

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
            await getStorage().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
            return;
        }

        // Generate and post the reply
        const reply = await generateReply(originalPost, cleanedContent);
        if (!reply) {
            debug('No reply generated', 'warn');
            // Still mark as processed to prevent retries
            await getStorage().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
            return;
        }

        // Add the user mention to the reply
        const userHandle = notification.account?.acct || notification.account?.username;
        const replyWithMention = `@${userHandle} ${reply}`;

        // Post the reply
        if (process.env.DEBUG_MODE !== 'true') {
            const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    status: replyWithMention,
                    in_reply_to_id: notification.status.id,  // Reply to the notification that mentioned us
                    visibility: 'public'
                })
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
            
            // Mark as replied to prevent duplicate replies
            await getStorage().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
            
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
            // Even in debug mode, mark as replied to prevent duplicate processing
            await getStorage().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
        }
    } catch (error) {
        debug('Error handling Mastodon reply:', 'error', error);
    }
}

// Handle replies on Bluesky
async function handleBlueskyReply(notification) {
    try {
        debug('Processing Bluesky reply...', 'info', notification);

        // Check if this is a reply to our post
        const originalPost = await getOriginalPost('bluesky', notification.uri);
        if (!originalPost) {
            debug('Not a reply to our post', 'info', {
                replyToId: notification.uri,
                recentPostsCount: recentPosts.size,
                recentPostKeys: Array.from(recentPosts.keys())
            });
            return;
        }

        // Check if we've already replied to this post
        const replyKey = `replied:bluesky:${notification.uri}`;
        const hasReplied = await getStorage().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this post', 'info', { replyKey });
            return;
        }

        // Generate the reply
        const generatedReply = await generateReply(originalPost.content, notification.record.text);
        if (!generatedReply) {
            debug('Failed to generate reply');
            return;
        }

        // In debug mode, just log what would have been posted
        if (process.env.DEBUG_MODE === 'true') {
            debug('Debug mode: Would reply to Bluesky post', 'info', {
                originalPost: originalPost.content,
                replyTo: notification.record.text,
                generatedReply,
                notification
            });
            // Still store that we "replied" to prevent duplicate debug logs
            await getStorage().put(replyKey, 'true');
            debug('Marked post as replied to (debug mode)', 'info', { replyKey });
            return;
        }

        // Get auth token
        const auth = await getBlueskyAuth();
        if (!auth || !auth.accessJwt) {
            throw new Error('Failed to authenticate with Bluesky');
        }

        // Create the post
        const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.accessJwt}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repo: auth.did,
                collection: 'app.bsky.feed.post',
                record: {
                    text: generatedReply,
                    reply: {
                        root: notification.uri,
                        parent: notification.uri
                    },
                    createdAt: new Date().toISOString()
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to post reply: ${errorData}`);
        }

        // Mark this post as replied to
        await getStorage().put(replyKey, 'true');
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
    initializeKV,
    loadRecentPostsFromKV,
    storeRecentPost,
    getOriginalPost
};
