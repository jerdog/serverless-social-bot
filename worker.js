// Import only the necessary functions
import { main, debug, getBlueskyAuth } from './bot.js';
import { uploadSourceTweetsFromText, getTweetCount } from './kv.js';
import { handleMastodonReply, handleBlueskyReply, generateReply, fetchPostContent, initializeKV } from './replies.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

// Helper function to setup environment variables
function setupEnvironment(env) {
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
        initializeKV(env.POSTS_KV);
    } else {
        debug('No POSTS_KV found in env', 'warn', { 
            availableBindings: Object.keys(env).filter(key => key.includes('KV')),
            envType: typeof env,
            envIsNull: env === null,
            envIsUndefined: env === undefined
        });
    }
}

// Check for notifications on both platforms
async function checkNotifications(env) {
    try {
        debug('Checking for notifications...');

        // Check Mastodon notifications
        const mastodonResponse = await fetch(`${process.env.MASTODON_API_URL}/api/v1/notifications?types[]=mention`, {
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`
            }
        });

        if (mastodonResponse.ok) {
            const notifications = await mastodonResponse.json();
            for (const notification of notifications) {
                await handleMastodonReply(notification);
            }
        }

        // Check Bluesky notifications
        const auth = await getBlueskyAuth();
        if (auth && auth.accessJwt) {
            debug('Fetching Bluesky notifications...', 'info', {
                authenticated: true,
                hasAccessToken: !!auth.accessJwt
            });

            const blueskyResponse = await fetch(`${process.env.BLUESKY_API_URL}/xrpc/app.bsky.notification.listNotifications?limit=50`, {
                headers: {
                    'Authorization': `Bearer ${auth.accessJwt}`,
                    'Accept': 'application/json'
                }
            });

            debug('Bluesky notifications response status:', 'info', {
                status: blueskyResponse.status,
                statusText: blueskyResponse.statusText
            });

            if (blueskyResponse.ok) {
                const data = await blueskyResponse.json();
                debug('Raw Bluesky response:', 'info', {
                    hasNotifications: !!data.notifications,
                    notificationCount: data.notifications?.length || 0,
                    firstNotification: data.notifications?.[0] ? {
                        reason: data.notifications[0].reason,
                        isRead: data.notifications[0].isRead,
                        author: data.notifications[0].author?.handle,
                        text: data.notifications[0].record?.text?.substring(0, 50) + '...'
                    } : null
                });

                const notifications = data.notifications || [];
                debug('Retrieved Bluesky notifications', 'info', { 
                    totalCount: notifications.length,
                    notificationTypes: notifications.map(n => n.reason).filter((v, i, a) => a.indexOf(v) === i)
                });
                
                // Filter for valid reply notifications
                const replyNotifications = notifications.filter(notif => {
                    debug('Processing notification', 'info', {
                        reason: notif.reason,
                        isRead: notif.isRead,
                        author: notif.author.handle,
                        text: notif.record?.text?.substring(0, 50) + '...',
                        uri: notif.uri,
                        indexedAt: notif.indexedAt
                    });

                    // Must be a reply and either unread or in debug mode
                    const isValidReply = notif.reason === 'reply' && 
                        (!notif.isRead || process.env.DEBUG_MODE === 'true');
                    
                    if (!isValidReply) {
                        debug('Skipping: Not a valid reply or already read', 'info', {
                            reason: notif.reason,
                            isRead: notif.isRead,
                            debugMode: process.env.DEBUG_MODE
                        });
                        return false;
                    }

                    // Don't reply to our own replies
                    if (notif.author.did === auth.did) {
                        debug('Skipping: Own reply', 'info', { authorDid: notif.author.did });
                        return false;
                    }

                    // Don't reply if the post contains certain keywords
                    const excludedWords = (process.env.EXCLUDED_WORDS || '').split(',')
                        .map(word => word.trim().toLowerCase())
                        .filter(word => word.length > 0);
                    
                    const replyText = notif.record?.text?.toLowerCase() || '';
                    if (excludedWords.some(word => replyText.includes(word))) {
                        debug('Skipping: Contains excluded word', 'info', { 
                            replyText,
                            excludedWords 
                        });
                        return false;
                    }

                    // Don't reply to replies older than 24 hours
                    const replyAge = Date.now() - new Date(notif.indexedAt).getTime();
                    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
                    if (replyAge > maxAge) {
                        debug('Skipping: Reply too old', 'info', { 
                            indexedAt: notif.indexedAt,
                            age: Math.round(replyAge / (60 * 60 * 1000)) + ' hours'
                        });
                        return false;
                    }

                    // Check if this is the first reply in the thread
                    const threadParent = notif.reply?.parent?.uri;
                    const threadReplies = notifications
                        .filter(n => n.author.did === auth.did)
                        .filter(n => n.reply?.parent?.uri === threadParent);
                    
                    debug('Thread analysis', 'info', {
                        threadParent,
                        ourRepliesInThread: threadReplies.length,
                        replyText: notif.record?.text?.substring(0, 50) + '...'
                    });

                    const isFirstReply = threadReplies.length === 0;
                    
                    if (isFirstReply) {
                        debug('First reply in thread, will respond', 'info', { 
                            threadParent,
                            replyText: notif.record?.text?.substring(0, 50) + '...'
                        });
                        return true;
                    } else {
                        const replyChance = Math.random() * 100;
                        if (replyChance > 30) {
                            debug('Skipping: Random chance for subsequent reply', 'info', { 
                                replyChance,
                                threadReplies: threadReplies.length
                            });
                            return false;
                        }
                        debug('Responding to subsequent reply', 'info', { 
                            replyChance,
                            threadReplies: threadReplies.length,
                            replyText: notif.record?.text?.substring(0, 50) + '...'
                        });
                        return true;
                    }
                });

                debug('Reply notifications filtered', 'info', { 
                    totalNotifications: notifications.length,
                    validReplies: replyNotifications.length
                });

                for (const notification of replyNotifications) {
                    debug('Processing reply notification', 'info', {
                        author: notification.author.handle,
                        text: notification.record?.text?.substring(0, 50) + '...',
                        uri: notification.uri
                    });
                    await handleBlueskyReply(notification);
                }

                // Mark notifications as read
                if (replyNotifications.length > 0) {
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
        }

        debug('Finished checking notifications');
    } catch (error) {
        debug('Error checking notifications:', 'error', error);
    }
}

export default {
    // Handle HTTP requests
    async fetch(request, env) {
        try {
            setupEnvironment(env);
            debug('Variables loaded:', 'info', env);

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
            setupEnvironment(env);
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
