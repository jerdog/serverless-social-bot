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

// Fetch a post from Mastodon
async function fetchMastodonPost(postId) {
    try {
        debug('Fetching Mastodon post', 'info', { postId });

        // Make sure we have a valid post ID
        if (!postId || typeof postId !== 'string') {
            throw new Error('Invalid post ID');
        }

        const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses/${postId}`, {
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`
            }
        });

        if (!response.ok) {
            debug('Failed to fetch Mastodon post', 'error', {
                status: response.status,
                statusText: response.statusText,
                postId
            });
            return null;
        }

        const post = await response.json();
        if (!post || !post.content) {
            debug('Invalid Mastodon post data', 'error', { post });
            return null;
        }

        // Clean the post content
        const cleanContent = post.content
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        debug('Successfully fetched Mastodon post', 'info', {
            postId,
            content: cleanContent.substring(0, 50) + (cleanContent.length > 50 ? '...' : '')
        });

        return cleanContent;
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
        const postId = extractMastodonPostId(postUrl);
        return await fetchMastodonPost(postId);
    } else if (postUrl.includes('bsky.app')) {
        return await fetchBlueskyPost(postUrl);
    } else {
        throw new Error('Unsupported platform URL');
    }
}

// Store a new post from our bot
async function storeRecentPost(platform, postId, content, isReply = false) {
    try {
        const key = `${platform}:${postId}`;
        const post = {
            platform,
            postId,
            content,
            type: isReply ? 'reply' : 'post',
            timestamp: new Date().toISOString()
        };

        // Store in memory cache
        recentPosts.set(key, post);

        // Trim cache if it gets too big (keep last 100 posts)
        if (recentPosts.size > 100) {
            const oldestKey = Array.from(recentPosts.keys())[0];
            recentPosts.delete(oldestKey);
            debug('Trimmed memory cache', 'info', {
                removedKey: oldestKey,
                newSize: recentPosts.size
            });
        }

        // Store in KV with appropriate prefix
        const kv = getKVNamespace();
        const kvKey = isReply ? `reply:${key}` : `post:${key}`;
        await kv.put(kvKey, JSON.stringify(post), {
            // Store for 24 hours
            expirationTtl: 86400
        });

        debug('Stored post', 'info', {
            key: kvKey,
            type: post.type,
            content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
        });

        return true;
    } catch (error) {
        debug('Error storing post:', 'error', error);
        return false;
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

    // First check memory cache
    let post = recentPosts.get(key);
    
    // If not in memory, try loading from storage
    if (!post) {
        try {
            const kv = getKVNamespace();
            
            // Try both post and reply keys
            let storedPost = await kv.get(`post:${key}`);
            if (!storedPost) {
                storedPost = await kv.get(`reply:${key}`);
            }
            
            if (storedPost) {
                try {
                    post = JSON.parse(storedPost);
                    // Add back to memory cache
                    recentPosts.set(key, post);
                    debug('Loaded post from storage', 'info', { 
                        key,
                        type: post.type,
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

    // Only return content if it's a post, not a reply
    if (post.type === 'reply') {
        debug('Found post but it is a reply, ignoring', 'info', { 
            key, 
            type: post.type
        });
        return null;
    }

    debug('Found post', 'info', { 
        key, 
        type: post.type,
        content: post.content.substring(0, 50) + '...'
    });
    return post.content;
}

// Fetch thread context from Bluesky
async function getThreadContext(notification, auth) {
    try {
        const threadContext = [];
        
        // Get the root post if it exists
        if (notification.record.reply?.root?.uri) {
            const rootResponse = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(notification.record.reply.root.uri)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${auth.accessJwt}`
                }
            });

            if (rootResponse.ok) {
                const rootData = await rootResponse.json();
                if (rootData.thread?.post?.record?.text) {
                    threadContext.push({
                        type: 'root',
                        text: rootData.thread.post.record.text
                    });
                }
            }
        }

        // Get the parent post if different from root
        if (notification.record.reply?.parent?.uri && 
            notification.record.reply.parent.uri !== notification.record.reply?.root?.uri) {
            const parentResponse = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(notification.record.reply.parent.uri)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${auth.accessJwt}`
                }
            });

            if (parentResponse.ok) {
                const parentData = await parentResponse.json();
                if (parentData.thread?.post?.record?.text) {
                    threadContext.push({
                        type: 'parent',
                        text: parentData.thread.post.record.text
                    });
                }
            }
        }

        // Add the current post
        threadContext.push({
            type: 'current',
            text: notification.record.text
        });

        return threadContext;
    } catch (error) {
        debug('Error getting thread context:', 'error', error);
        return [];
    }
}

// Generate a reply using OpenAI
async function generateReply(originalPost, replyContent, threadContext = []) {
    try {
        if (!originalPost || !replyContent) {
            debug('Missing required content for reply generation', 'error', {
                hasOriginalPost: !!originalPost,
                hasReplyContent: !!replyContent
            });
            return null;
        }

        debug('Generating reply with OpenAI', 'info', {
            originalPost: originalPost?.substring(0, 100),
            replyContent: replyContent?.substring(0, 100),
            hasThreadContext: threadContext.length > 0
        });

        // Clean up the posts
        const cleanOriginal = originalPost
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/@[\w]+/g, '') // Remove user mentions
            .trim();

        const cleanReply = replyContent
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .replace(/@[\w]+/g, '')
            .trim();

        // Construct thread context string if available
        let contextString = '';
        if (threadContext.length > 0) {
            contextString = 'Thread context:\n' + threadContext
                .map(post => `${post.type === 'root' ? 'Original post' : post.type === 'parent' ? 'Previous reply' : 'Current reply'}: ${post.text}`)
                .join('\n');
        }

        const systemPrompt = `You are a witty and engaging social media bot. Your responses should be:
1. Relevant to the conversation
2. Engaging but not confrontational
3. Brief (max 300 characters)
4. Natural and conversational
5. Free of @mentions
6. Avoiding controversial topics
7. Free of quotation marks - do not wrap your response in quotes

${contextString ? 'Use the thread context to maintain conversation relevance.\n' : ''}
Respond to the user's reply while maintaining context of the original post.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Original post: "${cleanOriginal}"${contextString ? '\n\n' + contextString : ''}\n\nUser's reply: "${cleanReply}"\n\nGenerate a witty response:` }
                ],
                max_tokens: 150,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            debug('OpenAI API error:', 'error', errorData);
            throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        const reply = data.choices[0].message.content
            .trim()
            .replace(/^["']|["']$/g, ''); // Remove leading/trailing quotes
        debug('Generated reply', 'info', { reply });

        return reply;
    } catch (error) {
        debug('Error generating reply:', 'error', error);
        return null;
    }
}

// Track rate limit state for OpenAI
const _rateLimitState = {
    lastError: null,
    backoffMinutes: 5,
    maxBackoffMinutes: 60,
    resetTime: null
};

// Fallback responses when rate limited
const fallbackResponses = [
    'Hmm, I need a moment to think about that one...',
    'My circuits are a bit overloaded right now...',
    'Give me a minute to process that...',
    'Taking a quick break to cool my processors...',
    'Sometimes even bots need a moment to reflect...',
    'Processing... please stand by...'
];

// Get a random fallback response
function _getFallbackResponse() {
    const index = Math.floor(Math.random() * fallbackResponses.length);
    return fallbackResponses[index];
}

// Handle a reply on Mastodon
async function handleMastodonReply(notification) {
    const replyKey = `mastodon:replied:${notification.status.id}`;
        
    try {
        // Check if we've already replied to this post
        const hasReplied = await getKVNamespace().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this Mastodon post', 'info', { replyKey });
            return;
        }
            
        // Get the original post content
        const originalPost = await fetchPostContent(notification.status.url);
        if (!originalPost) {
            debug('Could not fetch original Mastodon post', 'error', { id: notification.status.id });
            return;
        }
            
        // Generate the reply
        const reply = await generateReply(originalPost, notification.status.content);
        if (!reply) {
            debug('Failed to generate reply for Mastodon post', 'error', { id: notification.status.id });
            return;
        }
            
        // Add the mention
        const replyWithMention = `@${notification.account.acct} ${reply}`;
            
        // Post the reply
        const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: replyWithMention,
                in_reply_to_id: notification.status.id,
                visibility: 'public'
            })
        });
            
        if (!response.ok) {
            const errorData = await response.text();
            debug('Error posting Mastodon reply:', 'error', {
                status: response.status,
                statusText: response.statusText,
                error: errorData
            });
            throw new Error(`Failed to post Mastodon reply: ${errorData}`);
        }

        const postedReply = await response.json();
        await storeRecentPost('mastodon', postedReply.id, replyWithMention, true);  // Set isReply to true
            
        // Mark as replied to prevent duplicate replies
        await getKVNamespace().put(replyKey, 'true', { expirationTtl: 86400 }); // 24 hours
        debug('Successfully replied to Mastodon post', 'info', { 
            replyKey,
            originalId: notification.status.id,
            replyId: postedReply.id
        });
            
    } catch (error) {
        debug('Error handling Mastodon reply:', 'error', error);
    }
}

// Handle replies on Bluesky
async function handleBlueskyReply(notification) {
    const replyKey = `bluesky:replied:${notification.uri}`;

    try {
        // Check if we've already replied to this post
        const hasReplied = await getKVNamespace().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this Bluesky post', 'info', { replyKey });
            return;
        }

        // Get auth token first
        const auth = await getBlueskyAuth();
        if (!auth || !auth.accessJwt) {
            throw new Error('Failed to authenticate with Bluesky');
        }

        // Get thread context for better replies
        const threadContext = await getThreadContext(notification, auth);

        // Get the original post content
        const originalPost = notification.record.text || '';
        if (!originalPost) {
            debug('No content in Bluesky post', 'error', { notification });
            return;
        }

        // Generate the reply
        const generatedReply = await generateReply(originalPost, notification.record.text, threadContext);
        if (!generatedReply) {
            debug('Failed to generate reply for Bluesky post', 'error', { notification });
            return;
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
                        root: {
                            uri: notification.record.reply?.root?.uri || notification.reasonSubject,
                            cid: notification.record.reply?.root?.cid
                        },
                        parent: {
                            uri: notification.uri,
                            cid: notification.cid
                        }
                    },
                    createdAt: new Date().toISOString()
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            debug('Error response from Bluesky:', 'error', {
                status: response.status,
                statusText: response.statusText,
                error: errorData,
                notification
            });
            throw new Error(`Failed to post reply: ${errorData}`);
        }

        // Get the response data which contains our post URI
        const responseData = await response.json();
        const postUri = responseData.uri;
            
        // Store our reply in KV for future reference
        await storeRecentPost('bluesky', postUri, generatedReply, true);  // Set isReply to true
            
        // Mark this post as replied to with 24-hour expiration
        await getKVNamespace().put(replyKey, 'true', { expirationTtl: 86400 });
        debug('Successfully replied to Bluesky post', 'info', { 
            replyKey,
            postUri,
            reply: generatedReply
        });

    } catch (error) {
        debug('Error handling Bluesky reply:', 'error', error);
    }
}

// Export all functions
export {
    handleMastodonReply,
    handleBlueskyReply,
    getOriginalPost,
    generateReply,
    getThreadContext,
    storeRecentPost,
    initializeKV,
    fetchPostContent,
    loadRecentPostsFromKV
};
