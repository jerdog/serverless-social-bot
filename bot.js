// No imports needed - fetch is built into Cloudflare Workers

// HTML processing functions
function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' ',
        '&ndash;': '-',
        '&mdash;': '--',
        '&hellip;': '...',
        '&trade;': 'TM',
        '&copy;': '(c)',
        '&reg;': '(R)',
        '&deg;': 'degrees',
        '&plusmn;': '+/-',
        '&para;': '(P)',
        '&sect;': '(S)',
        '&ldquo;': '"',
        '&rdquo;': '"',
        '&lsquo;': "'",
        '&rsquo;': "'",
        '&laquo;': '<<',
        '&raquo;': '>>',
        '&times;': 'x',
        '&divide;': '/',
        '&cent;': 'c',
        '&pound;': 'GBP',
        '&euro;': 'EUR',
        '&bull;': '*'
    };
    return text.replace(/&[^;]+;/g, entity => entities[entity] || '');
}

function stripHtmlTags(text) {
    // First replace common block elements with space for better sentence separation
    text = text
        .replace(/<\/(p|div|br|h[1-6]|li)>/gi, ' ')
        .replace(/<(p|div|br|h[1-6]|li)[^>]*>/gi, ' ');
    
    // Then remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');
    
    // Clean up excessive whitespace
    return text.replace(/\s+/g, ' ').trim();
}

// Utility Functions
function debug(message, level = 'info', data = null) {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '[ERROR]' : level === 'verbose' ? '[VERBOSE]' : '';
    
    // Only log verbose messages if debug mode is enabled
    if (level === 'verbose' && process.env.DEBUG_MODE !== 'true') {
        return;
    }
    
    console.log(`[${timestamp}] ${prefix} ${message}`);
    if (data) {
        console.log(data);
    }
}

// Configuration loader
async function loadConfig() {
    try {
        const config = {
            DEBUG_MODE: process.env.DEBUG_MODE || 'false',
            DEBUG_LEVEL: process.env.DEBUG_LEVEL || 'info',
            
            // API URLs
            MASTODON_API_URL: process.env.MASTODON_API_URL || 'https://mastodon.social',
            BLUESKY_API_URL: process.env.BLUESKY_API_URL || 'https://bsky.social',
            
            // Credentials
            MASTODON_ACCESS_TOKEN: process.env.MASTODON_ACCESS_TOKEN,
            BLUESKY_USERNAME: process.env.BLUESKY_USERNAME,
            BLUESKY_PASSWORD: process.env.BLUESKY_PASSWORD,
            
            // Bot Configuration
            POST_MIN_LENGTH: parseInt(process.env.POST_MIN_LENGTH || '10', 10),
            POST_MAX_LENGTH: parseInt(process.env.POST_MAX_LENGTH || '280', 10),
            MARKOV_STATE_SIZE: parseInt(process.env.MARKOV_STATE_SIZE || '2', 10),
            MAX_GENERATION_ATTEMPTS: parseInt(process.env.MAX_GENERATION_ATTEMPTS || '100', 10)
        };

        // Log configuration in debug mode
        if (config.DEBUG_MODE === 'true') {
            debug('Configuration loaded:', 'verbose', {
                ...config,
                MASTODON_ACCESS_TOKEN: config.MASTODON_ACCESS_TOKEN ? '[REDACTED]' : undefined,
                BLUESKY_PASSWORD: config.BLUESKY_PASSWORD ? '[REDACTED]' : undefined
            });
        }

        return config;
    } catch (error) {
        debug(`Error loading configuration: ${error.message}`, 'error');
        throw error;
    }
}

// Global config object
let CONFIG = null;

// Utility Functions
function validateBlueskyUsername(username) {
    if (!username) {
        debug('Username is empty', 'error');
        return false;
    }
    
    debug(`Validating Bluesky username: ${username}`, 'verbose');
    
    // Remove any leading @ if present
    username = username.replace(/^@/, '');
    
    // Allow any username that contains at least one dot
    // This covers handle.bsky.social, handle.domain.tld, etc.
    if (username.includes('.')) {
        const handle = username.split('.')[0];
        // Basic handle validation - allow letters, numbers, underscores, and hyphens
        if (handle.match(/^[a-zA-Z0-9_-]+$/)) {
            return true;
        }
    }
    
    debug(`Invalid username format: ${username}`, 'error');
    return false;
}

function cleanText(text) {
    if (!text || typeof text !== 'string') return '';

    // First strip HTML tags
    text = stripHtmlTags(text);

    // Then decode HTML entities
    text = decodeHtmlEntities(text);

    // Basic cleaning
    text = text
        // Remove URLs
        .replace(/(https?:\/\/[^\s]+)|(www\.[^\s]+)/g, '')
        // Remove mentions (@username)
        .replace(/@[\w.-]+/g, '')
        // Remove RT prefix
        .replace(/^RT\s+/i, '')
        // Remove multiple spaces and trim
        .replace(/\s+/g, ' ')
        .trim();

    // Remove excluded words
    if (CONFIG.excludedWords.length > 0) {
        const excludedWordsRegex = new RegExp(`\\b(${CONFIG.excludedWords.join('|')})\\b`, 'gi');
        text = text.replace(excludedWordsRegex, '').replace(/\s+/g, ' ').trim();
    }

    // Final cleanup of any remaining special characters
    text = text
        // Replace smart quotes with regular quotes
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        // Remove any remaining control characters
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        // Clean up multiple spaces again
        .replace(/\s+/g, ' ')
        .trim();

    return text;
}

// Markov Chain Implementation
class MarkovChain {
    constructor(stateSize = 2) {
        this.stateSize = stateSize;
        this.chain = new Map();
        this.startStates = [];
        this.contextChain = new Map(); // For contextual responses
    }

    addData(texts, context = null) {
        for (const text of texts) {
            if (typeof text !== 'string' || !text.trim()) continue;
            
            const words = text.trim().split(/\s+/);
            if (words.length < this.stateSize + 1) continue;

            const startState = words.slice(0, this.stateSize).join(' ');
            this.startStates.push(startState);

            // Build regular chain
            for (let i = 0; i <= words.length - this.stateSize; i++) {
                const state = words.slice(i, i + this.stateSize).join(' ');
                const nextWord = words[i + this.stateSize] || null;

                if (!this.chain.has(state)) {
                    this.chain.set(state, []);
                }
                if (nextWord) {
                    this.chain.get(state).push(nextWord);
                }
            }

            // Build context chain if context is provided
            if (context) {
                const contextKey = context.toLowerCase();
                if (!this.contextChain.has(contextKey)) {
                    this.contextChain.set(contextKey, new Set());
                }
                // Store word pairs that might be relevant to this context
                const contextSet = this.contextChain.get(contextKey);
                for (let i = 0; i < words.length - 1; i++) {
                    contextSet.add(words[i] + ' ' + words[i + 1]);
                }
            }
        }
    }

    generate(options = {}) {
        const {
            maxTries = 100,
            minChars = 100,
            maxChars = 280,
            context = null
        } = options;

        for (let attempt = 0; attempt < maxTries; attempt++) {
            try {
                let startState;
                
                // If we have context, try to start with a relevant word pair
                if (context) {
                    const contextKey = context.toLowerCase();
                    const contextPairs = this.contextChain.get(contextKey);
                    if (contextPairs && contextPairs.size > 0) {
                        // Convert Set to Array for random selection
                        const pairs = Array.from(contextPairs);
                        const randomPair = pairs[Math.floor(Math.random() * pairs.length)];
                        // Find a start state that contains this pair
                        const relevantStarts = this.startStates.filter(state => 
                            state.toLowerCase().includes(randomPair));
                        if (relevantStarts.length > 0) {
                            startState = relevantStarts[Math.floor(Math.random() * relevantStarts.length)];
                        }
                    }
                }

                // Fall back to random start state if no context match
                if (!startState) {
                    const startIdx = Math.floor(Math.random() * this.startStates.length);
                    startState = this.startStates[startIdx];
                }

                let currentState = startState;
                let result = currentState.split(/\s+/);
                let currentLength = currentState.length;

                while (currentLength < maxChars) {
                    const nextWords = this.chain.get(currentState);
                    if (!nextWords || nextWords.length === 0) break;

                    const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];
                    if (!nextWord) break;

                    const newLength = currentLength + 1 + nextWord.length;
                    if (newLength > maxChars) break;

                    result.push(nextWord);
                    currentLength = newLength;
                    const words = result.slice(-this.stateSize);
                    currentState = words.join(' ');
                }

                const generatedText = result.join(' ');
                if (generatedText.length >= minChars && generatedText.length <= maxChars) {
                    debug(`Generated text length: ${generatedText.length} characters`, 'verbose');
                    return { string: generatedText };
                }
                debug(`Attempt ${attempt + 1}: Generated text (${generatedText.length} chars) outside bounds [${minChars}, ${maxChars}]`, 'verbose');
            } catch (error) {
                debug(`Generation attempt ${attempt + 1} failed: ${error.message}`, 'verbose');
                continue;
            }
        }
        throw new Error(`Failed to generate text between ${minChars} and ${maxChars} characters after ${maxTries} attempts`);
    }
}

// Mock content for development
const mockContent = [
    "Artificial Intelligence is transforming how we interact with technology.",
    "Machine learning models are becoming increasingly sophisticated.",
    "The future of computing lies in quantum technologies and AI.",
    "Data science and analytics drive modern decision making.",
    "Cloud computing enables scalable and efficient solutions.",
    "Edge computing brings processing closer to data sources.",
    "Neural networks excel at pattern recognition tasks.",
    "Blockchain technology ensures transparent transactions.",
    "Cybersecurity is crucial in our connected world.",
    "The Internet of Things connects our daily devices."
];

// Content Management
async function fetchTextContent() {
    try {
        if (CONFIG.DEBUG_MODE === 'true') {
            debug('Using mock content in development mode', 'info');
            return mockContent;
        }

        const replies = {
            mastodon: [],
            bluesky: []
        };

        // Fetch Mastodon content
        if (CONFIG.MASTODON_ACCESS_TOKEN) {
            const mastodonResponse = await fetch(
                `${CONFIG.MASTODON_API_URL}/api/v1/timelines/home`,
                {
                    headers: {
                        'Authorization': `Bearer ${CONFIG.MASTODON_ACCESS_TOKEN}`
                    }
                }
            );
            
            if (mastodonResponse.ok) {
                const posts = await mastodonResponse.json();
                for (const post of posts) {
                    if (post.content) {
                        replies.mastodon.push(cleanText(post.content));
                    }
                }
            }
        }

        // Fetch Bluesky content
        if (CONFIG.BLUESKY_USERNAME && CONFIG.BLUESKY_PASSWORD) {
            const auth = await getBlueskyAuth();
            const did = await getBlueskyDid();
            
            const feedResponse = await fetch(
                `${CONFIG.BLUESKY_API_URL}/xrpc/app.bsky.feed.getTimeline`,
                {
                    headers: {
                        'Authorization': `Bearer ${auth.accessJwt}`
                    }
                }
            );

            if (feedResponse.ok) {
                const feed = await feedResponse.json();
                for (const post of feed.feed) {
                    if (post.post?.record?.text) {
                        replies.bluesky.push(cleanText(post.post.record.text));
                    }
                }
            }
        }

        // Combine and return all content
        return [
            ...replies.mastodon,
            ...replies.bluesky
        ];
    } catch (error) {
        debug(`Error fetching content: ${error.message}`, 'error');
        return [];
    }
}

// Fetch and process replies
async function fetchReplies() {
    try {
        if (CONFIG.DEBUG_MODE === 'true') {
            debug('Using mock replies in development mode', 'info');
            return {
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
        }

        const replies = {
            mastodon: [],
            bluesky: []
        };

        // Fetch Mastodon replies
        if (CONFIG.MASTODON_ACCESS_TOKEN) {
            try {
                const mastodonResponse = await fetch(
                    `${CONFIG.MASTODON_API_URL}/api/v1/notifications?types[]=mention`,
                    {
                        headers: {
                            'Authorization': `Bearer ${CONFIG.MASTODON_ACCESS_TOKEN}`
                        }
                    }
                );

                if (mastodonResponse.ok) {
                    const mentions = await mastodonResponse.json();
                    replies.mastodon = mentions
                        .filter(mention => mention.type === 'mention')
                        .map(mention => ({
                            id: mention.status.id,
                            content: mention.status.content,
                            account: mention.account.acct,
                            inReplyToId: mention.status.in_reply_to_id
                        }));
                }
            } catch (error) {
                debug(`Error fetching Mastodon replies: ${error.message}`, 'error');
            }
        }

        // Fetch Bluesky replies
        if (CONFIG.BLUESKY_USERNAME && CONFIG.BLUESKY_PASSWORD) {
            try {
                const auth = await getBlueskyAuth();
                if (auth && auth.accessJwt) {
                    const notificationsResponse = await fetch(
                        `${CONFIG.BLUESKY_API_URL}/xrpc/app.bsky.notification.listNotifications`,
                        {
                            headers: {
                                'Authorization': `Bearer ${auth.accessJwt}`
                            }
                        }
                    );

                    if (notificationsResponse.ok) {
                        const notifications = await notificationsResponse.json();
                        replies.bluesky = notifications.notifications
                            .filter(notif => notif.reason === 'reply')
                            .map(notif => ({
                                id: notif.cid,
                                content: notif.record.text,
                                author: notif.author.handle,
                                uri: notif.uri,
                                replyTo: notif.record.reply?.parent.uri
                            }));
                    }
                }
            } catch (error) {
                debug(`Error fetching Bluesky replies: ${error.message}`, 'error');
            }
        }

        return replies;
    } catch (error) {
        debug(`Error fetching replies: ${error.message}`, 'error');
        return {
            mastodon: [],
            bluesky: []
        };
    }
}

// Generate and post replies
async function handleReplies(markovChain) {
    try {
        const replies = await fetchReplies();
        
        // Handle Mastodon replies
        for (const reply of replies.mastodon) {
            try {
                const response = markovChain.generate({
                    minChars: 10,
                    maxChars: 280,
                    context: reply.content
                });

                await postToMastodon(response.string, reply.id);
                debug(`Posted Mastodon reply to ${reply.account}`, 'info');
            } catch (error) {
                debug(`Error posting Mastodon reply: ${error.message}`, 'error');
            }
        }

        // Handle Bluesky replies
        for (const reply of replies.bluesky) {
            try {
                const response = markovChain.generate({
                    minChars: 10,
                    maxChars: 280,
                    context: reply.content
                });

                await postToBluesky(response.string, reply.replyTo);
                debug(`Posted Bluesky reply to ${reply.author}`, 'info');
            } catch (error) {
                debug(`Error posting Bluesky reply: ${error.message}`, 'error');
            }
        }
    } catch (error) {
        debug(`Error handling replies: ${error.message}`, 'error');
    }
}

// Post Generation
async function generatePost(contentArray) {
    if (!contentArray || contentArray.length === 0) {
        throw new Error('Content array is empty. Cannot generate Markov chain.');
    }

    const cleanContent = contentArray.filter(content => 
        typeof content === 'string' && content.trim().length > 0
    ).map(content => content.trim());

    debug(`Processing ${cleanContent.length} content items`, 'verbose');

    try {
        const markov = new MarkovChain(CONFIG.MARKOV_STATE_SIZE);
        markov.addData(cleanContent);

        const options = {
            maxTries: CONFIG.MAX_GENERATION_ATTEMPTS,
            minChars: CONFIG.POST_MIN_LENGTH,
            maxChars: CONFIG.POST_MAX_LENGTH
        };

        const result = markov.generate(options);
        debug(`Generated post length: ${result.string.length} characters`, 'verbose');
        
        if (!result || !result.string) {
            throw new Error('Failed to generate valid post');
        }

        return result.string;
    } catch (error) {
        debug(`Error generating Markov chain: ${error.message}`, 'error');
        throw new Error(`Failed to generate post: ${error.message}`);
    }
}

// Social Media Integration
async function postToMastodon(content, replyToId = null) {
    try {
        const response = await fetch(`${CONFIG.MASTODON_API_URL}/api/v1/statuses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.MASTODON_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: content,
                ...(replyToId ? { in_reply_to_id: replyToId } : {})
            })
        });

        if (!response.ok) {
            throw new Error(`Mastodon API error: ${response.status}`);
        }

        const data = await response.json();
        debug(`Posted to Mastodon: ${data.url}`, 'info');
        return data;
    } catch (error) {
        debug(`Error posting to Mastodon: ${error.message}`, 'error');
        throw error;
    }
}

async function postToBluesky(content, replyTo = null) {
    try {
        const auth = await getBlueskyAuth();
        
        const post = {
            text: content,
            createdAt: new Date().toISOString(),
            ...(replyTo ? {
                reply: {
                    parent: { uri: replyTo },
                    root: { uri: replyTo }
                }
            } : {})
        };

        const response = await fetch(`${CONFIG.BLUESKY_API_URL}/xrpc/com.atproto.repo.createRecord`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.accessJwt}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repo: auth.did,
                collection: 'app.bsky.feed.post',
                record: post
            })
        });

        if (!response.ok) {
            throw new Error(`Bluesky API error: ${response.status}`);
        }

        const data = await response.json();
        debug(`Posted to Bluesky: ${data.uri}`, 'info');
        return data;
    } catch (error) {
        debug(`Error posting to Bluesky: ${error.message}`, 'error');
        throw error;
    }
}

async function postToSocialMedia(content) {
    try {
        const results = await Promise.allSettled([
            postToMastodon(content),
            postToBluesky(content)
        ]);

        let success = false;
        
        // Check Mastodon result
        if (results[0].status === 'fulfilled' && results[0].value) {
            debug('Successfully posted to Mastodon', 'essential');
            success = true;
        } else {
            const error = results[0].reason || 'Unknown error';
            debug(`Failed to post to Mastodon: ${error}`, 'error');
        }

        // Check Bluesky result
        if (results[1].status === 'fulfilled' && results[1].value) {
            debug('Successfully posted to Bluesky', 'essential');
            success = true;
        } else {
            const error = results[1].reason || 'Unknown error';
            debug(`Failed to post to Bluesky: ${error}`, 'error');
        }

        if (!success) {
            debug('Failed to post to any platform', 'error');
            return false;
        }

        return true;
    } catch (error) {
        debug(`Error in postToSocialMedia: ${error.message}`, 'error');
        return false;
    }
}

// Bluesky Authentication
async function getBlueskyAuth() {
    try {
        debug('Authenticating with Bluesky...', 'verbose');
        
        // Validate credentials
        if (!CONFIG.BLUESKY_USERNAME || !CONFIG.BLUESKY_PASSWORD) {
            throw new Error('Missing Bluesky credentials');
        }
        
        if (!validateBlueskyUsername(CONFIG.BLUESKY_USERNAME)) {
            throw new Error('Invalid Bluesky username format. Should be handle.bsky.social or handle.domain.tld');
        }

        const authData = {
            "identifier": CONFIG.BLUESKY_USERNAME,
            "password": CONFIG.BLUESKY_PASSWORD
        };

        debug('Sending Bluesky auth request...', 'verbose');

        const response = await fetch(`${CONFIG.BLUESKY_API_URL}/xrpc/com.atproto.server.createSession`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(authData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            debug('Bluesky authentication failed', 'error', errorData);
            throw new Error(`Bluesky authentication error: ${errorData.message || 'Unknown error'}`);
        }

        const data = await response.json();
        if (!data || !data.accessJwt) {
            debug('Bluesky authentication response missing access token', 'error', data);
            return null;
        }

        debug('Successfully authenticated with Bluesky', 'verbose');
        return data;
    } catch (error) {
        debug(`Bluesky authentication error: ${error.message}`, 'error');
        return null;
    }
}

async function getBlueskyDid() {
    try {
        if (!CONFIG.BLUESKY_USERNAME) {
            throw new Error('Missing Bluesky username');
        }

        const response = await fetch(
            `${CONFIG.BLUESKY_API_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${CONFIG.BLUESKY_USERNAME}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            debug('Failed to resolve Bluesky DID', 'error', errorData);
            throw new Error(`Failed to resolve Bluesky DID: ${errorData.message || 'Unknown error'}`);
        }

        const data = await response.json();
        debug(`Resolved DID for ${CONFIG.BLUESKY_USERNAME}: ${data.did}`, 'info');
        return data.did;
    } catch (error) {
        debug(`Error resolving Bluesky DID: ${error.message}`, 'error');
        return null;
    }
}

// Main Execution
async function main(event = {}) {
    try {
        CONFIG = await loadConfig();
        const contentArray = await fetchTextContent();
        
        // Initialize Markov chain with existing content
        const markovChain = new MarkovChain(CONFIG.MARKOV_STATE_SIZE);
        markovChain.addData(contentArray);

        // Handle test events
        if (event.type === 'test') {
            switch (event.action) {
                case 'checkReplies':
                    debug('Test mode: Checking replies only', 'info');
                    await handleReplies(markovChain);
                    return;
                
                case 'generatePost':
                    debug('Test mode: Generating post', 'info');
                    const post = await generatePost(contentArray);
                    await postToSocialMedia(post);
                    return;
            }
        }

        // Regular scheduled execution
        const currentMinute = new Date().getMinutes();
        const isHourlyCheck = currentMinute % 15 === 0;
        const isTwoHourCheck = currentMinute === 0 && new Date().getHours() % 2 === 0;

        // Always check for and handle replies
        await handleReplies(markovChain);
        
        // Only generate new posts on the two-hour schedule
        if (isTwoHourCheck && Math.random() < 0.3) {
            debug('Two-hour check: Attempting to generate new post', 'info');
            const post = await generatePost(contentArray);
            await postToSocialMedia(post);
        } else if (isTwoHourCheck) {
            debug('Two-hour check: Skipping post generation this time', 'info');
        } else {
            debug('15-minute check: Checked for replies only', 'info');
        }
    } catch (error) {
        debug(`Error in main execution: ${error.message}`, 'error');
        throw error;
    }
}

// Export for worker
export { debug, main };
