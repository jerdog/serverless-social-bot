// Import only the necessary functions
import { main, debug, getBlueskyAuth } from './bot.js';
import { uploadSourceTweetsFromText, getTweetCount } from './kv.js';
import { handleMastodonReply, handleBlueskyReply, generateReply, fetchPostContent, initializeKV, loadRecentPostsFromKV } from './replies.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

// Helper function to setup environment variables
async function setupEnvironment(env) {
    try {
        debug('Setting up environment with:', 'info', { 
            hasPostsKV: !!env.POSTS_KV,
            envKeys: Object.keys(env),
            kvBindings: Object.keys(env).filter(key => key.endsWith('_KV'))
        });

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
            OPENAI_API_KEY: env.OPENAI_API_KEY || ''
        };
        
        // Initialize KV namespace
        if (env.POSTS_KV) {
            debug('Found POSTS_KV binding, attempting to initialize', 'info', {
                type: typeof env.POSTS_KV,
                methods: Object.keys(env.POSTS_KV)
            });

            // Initialize KV first
            await initializeKV(env.POSTS_KV);
            debug('KV initialization complete');
            
            // Then load existing posts
            debug('Loading posts from KV...');
            await loadRecentPostsFromKV();
            debug('Posts loaded successfully');
        } else {
            debug('No POSTS_KV found in env', 'warn', { 
                availableBindings: Object.keys(env).filter(key => key.includes('KV')),
                envType: typeof env,
                envIsNull: env === null,
                envIsUndefined: env === undefined
            });
        }

        debug('Environment setup complete', 'info', {
            env: Object.fromEntries(
                Object.entries(process.env).filter(([key]) => !key.includes('TOKEN') && !key.includes('PASSWORD'))
            )
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
async function checkNotifications(_env) {
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
        debug('Retrieved Mastodon notifications', 'info', {
            totalCount: mastodonNotifications.length,
            firstNotification: mastodonNotifications[0]
        });

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

            debug('Retrieved Bluesky notifications', 'info', {
                totalCount: notifications.length,
                firstNotification: notifications[0]
            });

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
                    
                    return new Response(JSON.stringify({ 
                        success,
                        totalTweets,
                        mode: append ? 'append' : 'replace'
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } else if (request.method === 'GET') {
                    const count = await getTweetCount(env);
                    return new Response(JSON.stringify({ count }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return new Response('Method not allowed', { status: 405 });
            }

            // Test reply generation
            if (url.pathname === '/test-reply') {
                if (request.method === 'POST') {
                    const { postUrl, replyContent } = await request.json();
                    if (!postUrl || !replyContent) {
                        return new Response('Missing postUrl or replyContent in request body', { 
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    debug('Testing reply generation...', 'info', { postUrl, replyContent });
                    
                    // Fetch the original post content
                    const originalPost = await fetchPostContent(postUrl);
                    if (!originalPost) {
                        return new Response('Failed to fetch post content', { 
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    const generatedReply = await generateReply(originalPost, replyContent);
                    
                    return new Response(JSON.stringify({ 
                        postUrl,
                        originalPost,
                        replyContent,
                        generatedReply
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return new Response('Method not allowed', { status: 405 });
            }

            // Handle bot execution
            if (url.pathname === '/run') {
                if (request.method === 'POST') {
                    debug('Starting bot execution...');
                    await main(env);
                    debug('Bot execution completed');
                    return new Response('Bot execution completed', { status: 200 });
                }
                return new Response('Method not allowed', { status: 405 });
            }

            // Handle checking notifications
            if (url.pathname === '/check-replies') {
                if (request.method === 'POST') {
                    debug('Checking for replies...');
                    await checkNotifications(env);
                    return new Response('Notifications checked', { status: 200 });
                }
                return new Response('Method not allowed', { status: 405 });
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
            await ctx.waitUntil(main(env));
            debug('Main execution completed');

            // Check for and handle replies
            await ctx.waitUntil(checkNotifications(env));
            debug('Notification check completed');
            
            debug('Scheduled execution completed');
        } catch (error) {
            debug('Scheduled execution error:', 'error', error);
        }
    }
};
