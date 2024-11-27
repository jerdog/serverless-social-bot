// Import only the necessary functions
import { debug, main } from './bot.js';

// Create a global process.env if it doesn't exist
if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    globalThis.process = { env: {} };
}

// Mock data for testing
const mockReplies = {
    mastodon: [
        {
            id: 'mock1',
            content: 'This is a test reply to your interesting post about AI',
            account: 'tester@mastodon.social',
            inReplyToId: 'original1'
        }
    ],
    bluesky: [
        {
            id: 'mock2',
            content: 'Fascinating thoughts about machine learning! What do you think about neural networks?',
            author: 'tester.bsky.social',
            uri: 'at://mock/post/1',
            replyTo: 'at://original/post/1'
        }
    ]
};

export default {
    // Handle HTTP requests
    async fetch(request, env, ctx) {
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

            // Development routes for testing
            if (env.DEBUG_MODE === 'true' && request.method === 'POST') {
                const url = new URL(request.url);
                
                // Test specific functionality
                switch (url.pathname) {
                    case '/test/replies':
                        debug('Testing reply functionality...', 'info');
                        await main({ type: 'test', action: 'checkReplies' });
                        return new Response('Reply check completed', { status: 200 });
                    
                    case '/test/post':
                        debug('Testing post generation...', 'info');
                        await main({ type: 'test', action: 'generatePost' });
                        return new Response('Post generation completed', { status: 200 });

                    case '/test/simulate/reply':
                        debug('Simulating incoming replies...', 'info');
                        await main({ 
                            type: 'test', 
                            action: 'simulateReplies',
                            mockData: mockReplies 
                        });
                        return new Response('Reply simulation completed', { status: 200 });

                    case '/test/simulate/interaction':
                        try {
                            const body = await request.json();
                            const mockInteraction = {
                                platform: body.platform || 'mastodon',
                                content: body.content || 'Test interaction message',
                                author: body.author || 'tester@social.network',
                                replyTo: body.replyTo || 'original-post-id'
                            };
                            
                            debug('Simulating custom interaction...', 'info', mockInteraction);
                            await main({
                                type: 'test',
                                action: 'simulateInteraction',
                                mockData: mockInteraction
                            });
                            return new Response('Custom interaction simulation completed', { status: 200 });
                        } catch (error) {
                            return new Response('Invalid simulation request: ' + error.message, { status: 400 });
                        }
                    
                    default:
                        // Regular execution
                        await main();
                        return new Response('Execution completed', { status: 200 });
                }
            }

            // Production scheduled execution
            if (request.method === 'POST') {
                await main();
                return new Response('Execution completed', { status: 200 });
            }

            return new Response('Method not allowed', { status: 405 });
        } catch (error) {
            console.error('Error executing bot:', error);
            return new Response('Bot execution failed: ' + error.message, { status: 500 });
        }
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

            await main(event);
        } catch (error) {
            console.error('Error in scheduled execution:', error);
            throw error;
        }
    }
};
