// Import only the necessary functions
import { main, debug } from './bot.js';
import { uploadSourceTweetsFromText, getTweetCount } from './kv.js';
import { handleMastodonReply, handleBlueskyReply, generateReply, fetchPostContent } from './replies.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

// Helper function to setup environment variables
function setupEnvironment(env) {
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

        // Check Bluesky notifications (to be implemented)
        // await handleBlueskyReply();

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
