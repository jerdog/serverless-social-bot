import { debug } from './log.js';
import { main, getBlueskyAuth } from './bot.js';
import { uploadSourceTweetsFromText, getTweetCount } from './kv.js';
import { handleMastodonReply, handleBlueskyReply, generateReply, fetchPostContent, initializeKV, initAI } from './replies.js';
import { initFeedback, recordVote, listFeedback, clearFeedback, summarizeFeedback } from './feedback.js';
import { renderDashboard } from './dashboard.js';

// Small response helpers — every route below returns JSON or a 405.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});
const methodNotAllowed = () => new Response('Method not allowed', { status: 405 });

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

// Helper function to setup environment variables
async function setupEnvironment(env) {
    try {
        debug('Setting up environment', 'info', { hasPostsKV: !!env.POSTS_KV, hasAI: !!env.AI });

        process.env = {
            ...process.env,
            MASTODON_API_URL: env.MASTODON_API_URL || '',
            MASTODON_ACCESS_TOKEN: env.MASTODON_ACCESS_TOKEN || '',
            BLUESKY_API_URL: env.BLUESKY_API_URL || '',
            BLUESKY_USERNAME: env.BLUESKY_USERNAME || '',
            BLUESKY_PASSWORD: env.BLUESKY_PASSWORD || '',
            MASTODON_SOURCE_ACCOUNTS: env.MASTODON_SOURCE_ACCOUNTS || '',
            BLUESKY_SOURCE_ACCOUNTS: env.BLUESKY_SOURCE_ACCOUNTS || '',
            EXCLUDED_WORDS: env.EXCLUDED_WORDS || '',
            DEBUG_MODE: env.DEBUG_MODE || 'false',
            DEBUG_LEVEL: env.DEBUG_LEVEL || 'info',
            MARKOV_STATE_SIZE: env.MARKOV_STATE_SIZE || '2',
            MARKOV_MIN_CHARS: env.MARKOV_MIN_CHARS || '100',
            MARKOV_MAX_CHARS: env.MARKOV_MAX_CHARS || '280',
            MARKOV_MAX_TRIES: env.MARKOV_MAX_TRIES || '100',
            POST_PROBABILITY: env.POST_PROBABILITY || '',
            REPLY_MAX_AGE_HOURS: env.REPLY_MAX_AGE_HOURS || '',
            WORKERS_AI_MODEL: env.WORKERS_AI_MODEL || '',
            AI_MAX_TOKENS: env.AI_MAX_TOKENS || '',
            AI_TEMPERATURE: env.AI_TEMPERATURE || ''
        };

        // Workers AI is accessed via the `AI` binding, not process.env.
        initAI(env.AI);
        if (!env.AI) {
            debug('No AI binding found in env; reply generation will be disabled', 'warn');
        }
        
        // Initialize KV namespace. The recent-posts cache is intentionally NOT
        // warmed here: it cost a KV list + N gets on every request (including
        // /dashboard, which never reads it). handleBlueskyReply loads it lazily
        // and getOriginalPost falls back to a direct KV get on a miss.
        if (env.POSTS_KV) {
            initializeKV(env.POSTS_KV);
            initFeedback(env.POSTS_KV);
            debug('KV initialized', 'info');
        } else {
            initFeedback(null);
            debug('No POSTS_KV found in env; using local storage', 'warn');
        }

        // Surface the effective posting-safety flag so its resolved value is
        // never ambiguous (DEBUG_MODE=true means nothing is actually posted).
        debug('Environment setup complete', 'info', {
            debugMode: process.env.DEBUG_MODE,
            willActuallyPost: process.env.DEBUG_MODE !== 'true'
        });
    } catch (error) {
        debug('Error during environment setup:', 'error', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Check for notifications on both platforms
async function checkNotifications() {
    try {
        debug('Checking for notifications...');
        debug('Fetching Mastodon notifications...', 'info');

        // Check Mastodon notifications
        const mastodonResponse = await fetch(`${process.env.MASTODON_API_URL}/api/v1/notifications?types[]=mention`, {
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`
            }
        });

        debug('Mastodon notifications response status:', 'info', {
            status: mastodonResponse.status,
            statusText: mastodonResponse.statusText
        });

        if (!mastodonResponse.ok) {
            debug('Failed to fetch Mastodon notifications', 'error', {
                status: mastodonResponse.status,
                statusText: mastodonResponse.statusText
            });
            return;
        }

        const mastodonNotifications = await mastodonResponse.json();
        debug('Retrieved Mastodon notifications', 'info', { totalCount: mastodonNotifications.length });

        // Process each Mastodon notification
        for (const notification of mastodonNotifications) {
            debug('Processing Mastodon notification', 'info', {
                type: notification.type,
                id: notification.id,
                status: notification.status?.content
            });

            if (notification.type === 'mention') {
                await handleMastodonReply(notification);
            }
        }

        // Check Bluesky notifications if configured
        if (process.env.BLUESKY_USERNAME && process.env.BLUESKY_PASSWORD) {
            debug('Fetching Bluesky notifications...', 'info');
            
            // Get Bluesky auth
            const auth = await getBlueskyAuth();
            if (!auth || !auth.accessJwt) {
                debug('Failed to authenticate with Bluesky - missing access token', 'error');
                return;
            }

            // Fetch notifications using the ATP API
            const notificationsResponse = await fetch(`${process.env.BLUESKY_API_URL}/xrpc/app.bsky.notification.listNotifications`, {
                headers: {
                    'Authorization': `Bearer ${auth.accessJwt}`,
                    'Accept': 'application/json'
                }
            });

            if (!notificationsResponse.ok) {
                debug('Failed to fetch Bluesky notifications', 'error', {
                    status: notificationsResponse.status,
                    statusText: notificationsResponse.statusText
                });
                return;
            }

            const blueskyData = await notificationsResponse.json();
            const notifications = blueskyData.notifications || [];

            debug('Retrieved Bluesky notifications', 'info', { totalCount: notifications.length });

            // Process each Bluesky notification
            for (const notification of notifications) {
                debug('Processing Bluesky notification', 'info', {
                    reason: notification.reason,
                    author: notification.author?.handle,
                    cid: notification.cid
                });

                if (notification.reason === 'reply') {
                    await handleBlueskyReply(notification);
                }
            }

            // Mark notifications as read
            if (notifications.length > 0) {
                const seenAt = new Date().toISOString();
                await fetch(`${process.env.BLUESKY_API_URL}/xrpc/app.bsky.notification.updateSeen`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${auth.accessJwt}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ seenAt })
                });
            }
        }
    } catch (error) {
        debug('Error checking notifications:', 'error', error);
    }
}

export default {
    // Handle HTTP requests
    async fetch(request, env) {
        try {
            // Initialize environment first
            await setupEnvironment(env);
            debug('Starting HTTP request handler...');

            const url = new URL(request.url);
            
            // Handle source tweets operations
            if (url.pathname === '/upload-tweets') {
                if (request.method === 'POST') {
                    const text = await request.text();
                    const append = request.headers.get('X-Append') !== 'false'; // Default to append
                    const success = await uploadSourceTweetsFromText(env, text, append);
                    const totalTweets = await getTweetCount(env);
                    
                    return json({ 
                        success,
                        totalTweets,
                        mode: append ? 'append' : 'replace'
                    });
                } else if (request.method === 'GET') {
                    const count = await getTweetCount(env);
                    return json({ count });
                }
                return methodNotAllowed();
            }

            // Test reply generation
            if (url.pathname === '/test-reply') {
                if (request.method === 'POST') {
                    const { postUrl, replyContent } = await request.json();
                    if (!postUrl || !replyContent) {
                        return json({ error: 'Missing postUrl or replyContent in request body' }, 400);
                    }

                    debug('Testing reply generation...', 'info', { postUrl, replyContent });
                    
                    // Fetch the original post content
                    const originalPost = await fetchPostContent(postUrl);
                    if (!originalPost) {
                        return json({ error: 'Failed to fetch post content' }, 400);
                    }

                    const generatedReply = await generateReply(originalPost, replyContent);
                    
                    return json({ 
                        postUrl,
                        originalPost,
                        replyContent,
                        generatedReply
                    });
                }
                return methodNotAllowed();
            }

            // Serve the feedback dashboard
            if (url.pathname === '/dashboard') {
                if (request.method === 'GET') {
                    return new Response(renderDashboard(), {
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    });
                }
                return methodNotAllowed();
            }

            // Feedback data for the dashboard
            if (url.pathname === '/api/feedback') {
                if (request.method === 'GET') {
                    const type = url.searchParams.get('type');
                    const items = await listFeedback({ type: type || null });
                    return json({
                        items,
                        stats: summarizeFeedback(items)
                    });
                }
                return methodNotAllowed();
            }

            // Delete all feedback records (wipe test/junk data)
            if (url.pathname === '/api/feedback/clear') {
                if (request.method === 'POST') {
                    const removed = await clearFeedback();
                    return json({ success: true, removed });
                }
                return methodNotAllowed();
            }

            // Record an up/down vote
            if (url.pathname === '/api/vote') {
                if (request.method === 'POST') {
                    let payload;
                    try {
                        payload = await request.json();
                    } catch (parseError) {
                        return json({ error: 'Invalid JSON body' }, 400);
                    }

                    const { type, platform, id, vote } = payload;
                    try {
                        const record = await recordVote({ type, platform, id, vote });
                        if (!record) {
                            return json({ error: 'Item not found' }, 404);
                        }
                        return json({ success: true, record });
                    } catch (voteError) {
                        return json({ error: voteError.message }, 400);
                    }
                }
                return methodNotAllowed();
            }

            // Handle bot execution
            if (url.pathname === '/run') {
                if (request.method === 'POST') {
                    debug('Starting bot execution...');
                    await main(env);
                    debug('Bot execution completed');
                    return new Response('Bot execution completed', { status: 200 });
                }
                return methodNotAllowed();
            }

            // Handle checking notifications
            if (url.pathname === '/check-replies') {
                if (request.method === 'POST') {
                    debug('Checking for replies...');
                    await checkNotifications();
                    return new Response('Notifications checked', { status: 200 });
                }
                return methodNotAllowed();
            }

            return new Response('Not found', { status: 404 });
        } catch (error) {
            debug('Worker error:', 'error', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    },

    // Handle scheduled events
    async scheduled(event, env, ctx) {
        try {
            // Initialize environment first
            await setupEnvironment(env);
            debug('Starting scheduled execution...');
            
            // Run the main bot
            ctx.waitUntil(main(env));
            debug('Main execution completed');

            // Check for and handle replies
            ctx.waitUntil(checkNotifications());
            debug('Notification check completed');
            
            debug('Scheduled execution completed');
        } catch (error) {
            debug('Scheduled execution error:', 'error', error);
        }
    }
};
