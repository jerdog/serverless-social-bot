import { debug } from './bot.js';

// Cache to store our bot's recent posts
const recentPosts = new Map();

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
export function storeRecentPost(platform, postId, content) {
    recentPosts.set(`${platform}:${postId}`, {
        content,
        timestamp: Date.now()
    });

    // Clean up old posts (older than 24 hours)
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [key, value] of recentPosts.entries()) {
        if (value.timestamp < dayAgo) {
            recentPosts.delete(key);
        }
    }
}

// Get the original post content
export function getOriginalPost(platform, postId) {
    return recentPosts.get(`${platform}:${postId}`);
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

// Generate a reply using ChatGPT
export async function generateReply(originalPost, replyContent) {
    try {
        // Check if we're currently rate limited
        if (rateLimitState.lastError) {
            const timeSinceError = Date.now() - rateLimitState.lastError;
            const backoffMs = rateLimitState.backoffMinutes * 60 * 1000;
            
            if (timeSinceError < backoffMs) {
                const waitMinutes = Math.ceil((backoffMs - timeSinceError) / (60 * 1000));
                debug('Still rate limited, using fallback response', 'info', { 
                    waitMinutes,
                    backoffMinutes: rateLimitState.backoffMinutes
                });
                return getFallbackResponse();
            } else {
                // Reset rate limit state
                rateLimitState.lastError = null;
                rateLimitState.backoffMinutes = 5;
                debug('Rate limit period expired, retrying', 'info');
            }
        }

        debug('Generating reply with ChatGPT...', 'verbose', { originalPost, replyContent });
        debug('Using API key:', 'verbose', process.env.OPENAI_API_KEY ? 'Present' : 'Missing');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are a witty, funny, and slightly off-the-wall social media bot. Your responses should be engaging, humorous, and occasionally absurd, while still being relevant to the conversation. Keep responses under 280 characters."
                    },
                    {
                        role: "user",
                        content: `Original post: "${originalPost}"\nSomeone replied with: "${replyContent}"\nGenerate a witty and funny response that is slightly unhinged, and keep the response under 280 characters:`
                    }
                ],
                max_tokens: 100,
                temperature: 0.9
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            debug('ChatGPT API error:', 'error', errorText);
            
            // Check for rate limit error
            if (errorText.includes('rate limit') || response.status === 429) {
                rateLimitState.lastError = Date.now();
                // Double the backoff time for next attempt, up to max
                rateLimitState.backoffMinutes = Math.min(
                    rateLimitState.backoffMinutes * 2,
                    rateLimitState.maxBackoffMinutes
                );
                debug('Rate limit hit, using fallback response', 'warn', {
                    nextBackoffMinutes: rateLimitState.backoffMinutes
                });
                return getFallbackResponse();
            }
            
            throw new Error(`ChatGPT API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        debug('ChatGPT response:', 'verbose', data);
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content.trim();
        }
        throw new Error('Invalid response from ChatGPT');
    } catch (error) {
        debug('Error generating reply with ChatGPT:', 'error', error);
        // Use fallback response for any errors
        return getFallbackResponse();
    }
}

// Handle replies on Mastodon
export async function handleMastodonReply(notification) {
    try {
        if (notification.type !== 'mention') return;

        const replyToId = notification.status.in_reply_to_id;
        if (!replyToId) return;

        const originalPost = getOriginalPost('mastodon', replyToId);
        if (!originalPost) return;

        const replyContent = notification.status.content;
        const reply = await generateReply(originalPost.content, replyContent);

        if (reply) {
            const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    status: reply,
                    in_reply_to_id: notification.status.id
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to post Mastodon reply: ${response.statusText}`);
            }

            debug('Successfully posted reply to Mastodon', 'info', { reply });
        }
    } catch (error) {
        debug('Error handling Mastodon reply:', 'error', error);
    }
}

// Handle replies on Bluesky
export async function handleBlueskyReply(notification) {
    try {
        debug('Processing Bluesky notification for reply', 'info', {
            author: notification.author.handle,
            text: notification.record?.text?.substring(0, 50) + '...',
            uri: notification.uri,
            replyParent: notification.reply?.parent?.uri
        });

        // Get auth session
        const auth = await getBlueskyAuth();
        if (!auth) {
            debug('Failed to authenticate with Bluesky', 'error');
            throw new Error('Failed to authenticate with Bluesky');
        }

        // Check if this is a reply to our post
        const replyToUri = notification.reply?.parent?.uri;
        if (!replyToUri) {
            debug('Not a reply, skipping', 'info', { notification });
            return;
        }

        debug('Checking if reply is to our post', 'info', { replyToUri });
        const originalPost = getOriginalPost('bluesky', replyToUri);
        if (!originalPost) {
            debug('Not a reply to our post, skipping', 'info', { replyToUri });
            return;
        }

        // Get the reply content
        const replyContent = notification.record?.text;
        if (!replyContent) {
            debug('No reply content found', 'info', { notification });
            return;
        }

        debug('Generating reply', 'info', {
            originalPost: originalPost.content.substring(0, 50) + '...',
            replyContent: replyContent.substring(0, 50) + '...'
        });

        // Generate a witty reply
        const reply = await generateReply(originalPost.content, replyContent);
        if (!reply) {
            debug('Failed to generate reply', 'error');
            return;
        }

        debug('Posting reply to Bluesky', 'info', {
            reply: reply.substring(0, 50) + '...',
            replyTo: notification.uri
        });

        // Post the reply
        const response = await fetch(`${process.env.BLUESKY_API_URL}/xrpc/com.atproto.repo.createRecord`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.accessJwt}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repo: auth.did,
                collection: 'app.bsky.feed.post',
                record: {
                    text: reply,
                    reply: {
                        root: notification.reply.root,
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
            const errorText = await response.text();
            debug('Failed to post Bluesky reply', 'error', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            throw new Error(`Failed to post Bluesky reply: ${errorText}`);
        }

        debug('Successfully posted reply to Bluesky', 'info', {
            reply: reply.substring(0, 50) + '...',
            replyTo: notification.uri
        });
    } catch (error) {
        debug('Error handling Bluesky reply:', 'error', error);
    }
}
