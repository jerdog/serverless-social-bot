// Import only the necessary functions
import { debug, generatePost, postToMastodon, postToBluesky, main } from './bot.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

export default {
    // Handle HTTP requests
    async fetch(request, env, _ctx) {
        try {
            // Set environment variables
            process.env.CLOUDFLARE_WORKER = 'true';
            Object.assign(process.env, env);

            // Log environment state
            debug('Environment variables in fetch:', 'verbose', {
                CLOUDFLARE_WORKER: process.env.CLOUDFLARE_WORKER,
                DEBUG_MODE: process.env.DEBUG_MODE,
                DEBUG_LEVEL: process.env.DEBUG_LEVEL
            });

            // Only allow POST requests to trigger the bot
            if (request.method === 'POST') {
                await main();
                return new Response('Bot execution completed successfully', { status: 200 });
            }

            // Return a simple status for GET requests
            return new Response('Bot is running. Use POST to trigger execution.', { status: 200 });
        } catch (error) {
            console.error('Error executing bot:', error);
            return new Response('Bot execution failed: ' + error.message, { status: 500 });
        }
    },

    // Handle scheduled events
    async scheduled(event, env, _ctx) {
        try {
            // Set environment variables
            process.env.CLOUDFLARE_WORKER = 'true';
            Object.assign(process.env, env);

            // Log environment state
            debug('Environment variables in scheduled:', 'verbose', {
                CLOUDFLARE_WORKER: process.env.CLOUDFLARE_WORKER,
                DEBUG_MODE: process.env.DEBUG_MODE,
                DEBUG_LEVEL: process.env.DEBUG_LEVEL
            });

            await main();
        } catch (error) {
            console.error('Error in scheduled execution:', error);
            throw error;
        }
    }
};
