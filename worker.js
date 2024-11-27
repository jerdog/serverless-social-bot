// Import only the necessary functions
import { debug, main } from './bot.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

export default {
    // Handle HTTP requests
    async fetch(request, env, ctx) {
        try {
            // Set environment variables
            process.env.CLOUDFLARE_WORKER = 'true';
            Object.assign(process.env, env);

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
    async scheduled(event, env, ctx) {
        try {
            // Set environment variables from worker environment
            process.env.CLOUDFLARE_WORKER = 'true';
            Object.assign(process.env, env);

            await main();
            return new Response('Bot execution completed successfully', { status: 200 });
        } catch (error) {
            console.error('Error executing bot:', error);
            return new Response('Bot execution failed: ' + error.message, { status: 500 });
        }
    },
};
