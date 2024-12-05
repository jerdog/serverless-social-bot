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
const localStorage = new LocalStorage();

// Initialize KV namespace
export function initializeKV(kv) {
    if (!kv) {
        debug('No KV namespace provided, using local storage', 'warn');
        postsKV = localStorage;
        return;
    }
    
    try {
        // Test if the KV binding is working
        kv.list({ prefix: 'test' }).then(() => {
            postsKV = kv;
            debug('Successfully initialized KV namespace', 'info');
        }).catch(error => {
            debug('KV namespace not available, using local storage', 'warn', error);
            postsKV = localStorage;
        });
    } catch (error) {
        debug('Error during KV initialization, using local storage', 'warn', error);
        postsKV = localStorage;
    }
}

// Helper to get storage
function getStorage() {
    if (!postsKV) {
        debug('No storage available, initializing local storage', 'warn');
        postsKV = localStorage;
    }
    return postsKV;
}

// Helper to get KV namespace
function getKVNamespace() {
    return getStorage();
}

async function loadRecentPostsFromKV() {
    try {
        const kv = getStorage();
        if (!kv) {
            debug('No storage available', 'warn');
            return;
        }

        const { keys } = await kv.list({ prefix: 'post:' });
        for (const key of keys) {
            const post = await kv.get(key.name);
            if (post) {
                const [platform, postId] = key.name.replace('post:', '').split(':');
                recentPosts.set(`${platform}:${postId}`, JSON.parse(post));
            }
        }
        
        debug('Loaded posts from storage', 'info', {
            count: recentPosts.size,
            keys: Array.from(recentPosts.keys())
        });
    } catch (error) {
        debug('Error loading posts from storage:', 'error', error);
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
export async function fetchPostContent(postUrl) {
    if (postUrl.includes('mastodon') || postUrl.includes('hachyderm.io')) {
        return await fetchMastodonPost(postUrl);
    } else if (postUrl.includes('bsky.app')) {
        return await fetchBlueskyPost(postUrl);
    } else {
        throw new Error('Unsupported platform URL');
    }
}

// Store a new post from our bot
export async function storeRecentPost(platform, postId, content) {
    debug('Storing recent post', 'info', {
        platform,
        postId,
        content,
        cacheSize: recentPosts.size
    });

    const key = `${platform}:${postId}`;
    const post = { content, timestamp: Date.now() };
    
    // Store in memory
    recentPosts.set(key, post);

    // Store in storage
    try {
        const kv = getStorage();
        if (kv) {
            await kv.put(`post:${key}`, JSON.stringify(post));
            debug('Stored post in storage', 'info', { key });
        }
    } catch (error) {
        debug('Error storing post in storage:', 'error', error);
    }

    // Clean up old posts (older than 24 hours)
    const now = Date.now();
    for (const [key, post] of recentPosts.entries()) {
        if (now - post.timestamp > 24 * 60 * 60 * 1000) {
            debug('Removing old post from cache', 'info', { key });
            recentPosts.delete(key);
            
            // Remove from storage
            try {
                const kv = getStorage();
                if (kv) {
                    await kv.delete(`post:${key}`);
                    debug('Removed old post from storage', 'info', { key });
                }
            } catch (error) {
                debug('Error removing post from storage:', 'error', error);
            }
        }
    }
}

// Get the original post content
export async function getOriginalPost(platform, postId) {
    // First try memory cache
    const key = `${platform}:${postId}`;
    let post = recentPosts.get(key);
    
    // If not in memory, try storage
    if (!post) {
        try {
            const kv = getStorage();
            if (kv) {
                const kvPost = await kv.get(`post:${key}`);
                if (kvPost) {
                    post = JSON.parse(kvPost);
                    // Add to memory cache
                    recentPosts.set(key, post);
                }
            }
        } catch (error) {
            debug('Error getting post from storage:', 'error', error);
        }
    }

    debug('Getting original post', 'info', {
        platform,
        postId,
        key,
        exists: !!post,
        cacheSize: recentPosts.size,
        cacheKeys: Array.from(recentPosts.keys())
    });

    return post;
}

// Track rate limit state
const rateLimitState = {
    lastError: null,
    backoffMinutes: 5,
    maxBackoffMinutes: 60
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
export async function generateReply(originalPost, replyContent) {
    try {
        debug('Generating reply with OpenAI', 'info', {
            originalPost,
            replyContent
        });

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a witty social media bot that generates clever and engaging replies. Your responses should be concise, humorous, and relevant to the conversation. Avoid being controversial or offensive.'
                    },
                    {
                        role: 'user',
                        content: `Generate a witty reply to this social media conversation.\n\nOriginal post: "${originalPost}"\n\nReply to respond to: "${replyContent}"\n\nMake it clever and engaging, but keep it under 280 characters.`
                    }
                ],
                max_tokens: 150,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        let reply = data.choices[0].message.content;
        
        // Remove surrounding quotes if they exist
        reply = reply.trim();
        if (reply.startsWith('"') && reply.endsWith('"')) {
            reply = reply.slice(1, -1);
        }
        
        debug('Generated reply', 'info', { reply });
        return reply;
    } catch (error) {
        debug('Error generating reply:', 'error', error);
        
        // If we hit rate limits, use a fallback response
        if (error.message?.includes('rate limit')) {
            return getFallbackResponse();
        }
        
        throw error;
    }
}

// Handle a reply on Mastodon
export async function handleMastodonReply(notification) {
    try {
        debug('Processing Mastodon reply...', 'info', notification);

        // Check if this is a reply to our post
        const originalPost = await getOriginalPost('mastodon', notification.status.in_reply_to_id);
        if (!originalPost) {
            debug('Not a reply to our post', 'info', {
                replyToId: notification.status.in_reply_to_id,
                recentPostsCount: recentPosts.size,
                recentPostKeys: Array.from(recentPosts.keys())
            });
            return;
        }

        // Check if we've already replied to this post
        const replyKey = `replied:mastodon:${notification.status.id}`;
        const hasReplied = await getStorage().get(replyKey);
        if (hasReplied) {
            debug('Already replied to this post', 'info', { replyKey });
            return;
        }

        // Generate the reply
        const generatedReply = await generateReply(originalPost.content, notification.status.content);
        if (!generatedReply) {
            debug('Failed to generate reply');
            return;
        }

        // In debug mode, just log what would have been posted
        if (process.env.DEBUG_MODE === 'true') {
            debug('Debug mode: Would reply to Mastodon post', 'info', {
                originalPost: originalPost.content,
                replyTo: notification.status.content,
                generatedReply,
                notification
            });
            // Still store that we "replied" to prevent duplicate debug logs
            await getStorage().put(replyKey, 'true');
            debug('Marked post as replied to (debug mode)', 'info', { replyKey });
            return;
        }

        // Post the reply
        const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: generatedReply,
                in_reply_to_id: notification.status.id,
                visibility: 'public'
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to post reply: ${response.status} ${response.statusText}`);
        }

        // Mark this post as replied to
        await getStorage().put(replyKey, 'true');
        debug('Successfully replied to Mastodon post', 'info', { replyKey });

    } catch (error) {
        debug('Error handling Mastodon reply:', 'error', error);
    }
}

// Handle replies on Bluesky
export async function handleBlueskyReply(notification) {
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

// Initialize posts from storage when module loads
loadRecentPostsFromKV().catch(error => {
    debug('Error initializing posts from storage:', 'error', error);
});
