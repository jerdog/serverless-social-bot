// Import only the necessary functions
import { debug, main, generateContent, postToBluesky, postToMastodon } from './bot.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

export default {
    // Handle HTTP requests
    async fetch(request, env, ctx) {
        return new Response('Social Bot Worker Running', { status: 200 });
    },

    // Handle scheduled events
    async scheduled(event, env, ctx) {
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

            const content = await generateContent(env);
            debug(`Generated content: ${content}`, 'verbose');

            if (env.DEBUG_MODE === 'true') {
                debug('Debug mode enabled, skipping actual post', 'info');
                return new Response('Debug mode - post generated but not sent', { status: 200 });
            }

            await Promise.all([
                postToBluesky(content, env),
                postToMastodon(content, env)
            ]);

            return new Response('Posts sent successfully', { status: 200 });
        } catch (error) {
            console.error('Error in scheduled task:', error);
            return new Response('Error in scheduled task: ' + error.message, { status: 500 });
        }
    }
};
