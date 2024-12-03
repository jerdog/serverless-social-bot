// Import only the necessary functions
import { main, debug } from './bot.js';
import { uploadSourceTweetsFromText, getTweetCount } from './kv.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

export default {
    // Handle HTTP requests
    async fetch(request, env) {
        try {
            debug('Variables loaded:', 'info', env);
            
            // Copy environment variables from env to process.env
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
                MARKOV_MAX_TRIES: env.MARKOV_MAX_TRIES || '100'
            };

            // debug('Environment variables loaded:', 'info', process.env);

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

            return new Response('Not found', { status: 404 });
        } catch (error) {
            debug('Worker error:', 'error', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    },

    // Handle scheduled events
    async scheduled(event, env, ctx) {
        ctx.waitUntil(main(env));
    }
};
