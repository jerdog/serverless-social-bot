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

// Generate a reply using ChatGPT
export async function generateReply(originalPost, replyContent) {
    try {
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
                        content: `Original post: "${originalPost}"\nSomeone replied with: "${replyContent}"\nGenerate a witty and funny response:`
                    }
                ],
                max_tokens: 100,
                temperature: 0.9
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            debug('ChatGPT API error:', 'error', errorText);
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
        return null;
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
        // Implement Bluesky reply handling here
        // This will be similar to Mastodon but use Bluesky's API
        debug('Bluesky reply handling not yet implemented', 'warn');
    } catch (error) {
        debug('Error handling Bluesky reply:', 'error', error);
    }
}
