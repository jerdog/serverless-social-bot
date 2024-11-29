// Import only the necessary functions
import { main, debug } from './bot.js';
import { getSourceTweets, uploadSourceTweetsFromText, getTweetCount } from './kv.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

export default {
    // Handle HTTP requests
    async fetch(request, env) {
        try {
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
            }

            // Handle bot execution
            if (url.pathname === '/run') {
                await main(env);
                return new Response('Bot execution completed', { status: 200 });
            }

            return new Response('Not found', { status: 404 });
        } catch (error) {
            debug('Worker error:', 'error', error);
            return new Response('Internal error', { status: 500 });
        }
    },

    // Handle scheduled events
    async scheduled(event, env, ctx) {
        ctx.waitUntil(main(env));
    }
};
