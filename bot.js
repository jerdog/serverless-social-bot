// Essential imports only
import fetch from 'node-fetch';

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
function loadConfig() {
    try {
        debug('Loading configuration...', 'verbose');

        // Load configuration from environment variables
        const config = {
            debug: process.env.DEBUG_MODE === 'true',
            debugLevel: process.env.DEBUG_LEVEL || 'info',
            
            // Markov Chain settings
            markovStateSize: parseInt(process.env.MARKOV_STATE_SIZE) || 2,
            markovMaxTries: parseInt(process.env.MARKOV_MAX_TRIES) || 100,
            markovMinChars: parseInt(process.env.MARKOV_MIN_CHARS) || 100,
            markovMaxChars: parseInt(process.env.MARKOV_MAX_CHARS) || 280,
            
            // Content filtering
            excludedWords: JSON.parse(process.env.EXCLUDED_WORDS || '[]'),
            
            // Bluesky settings
            blueskyUsername: process.env.BLUESKY_USERNAME,
            blueskyPassword: process.env.BLUESKY_PASSWORD,
            blueskyApiUrl: process.env.BLUESKY_API_URL ? process.env.BLUESKY_API_URL.replace(/\/$/, '') : undefined,
            blueskySourceAccounts: JSON.parse(process.env.BLUESKY_SOURCE_ACCOUNTS || '[]'),
            
            // Mastodon settings
            mastodonAccessToken: process.env.MASTODON_ACCESS_TOKEN,
            mastodonApiUrl: process.env.MASTODON_API_URL ? process.env.MASTODON_API_URL.replace(/\/$/, '') : undefined,
            mastodonSourceAccounts: JSON.parse(process.env.MASTODON_SOURCE_ACCOUNTS || '[]')
        };

        // Log loaded configuration (excluding sensitive data)
        debug('Loaded configuration:', 'verbose', {
            debug: config.debug,
            debugLevel: config.debugLevel,
            markovSettings: {
                stateSize: config.markovStateSize,
                maxTries: config.markovMaxTries,
                minChars: config.markovMinChars,
                maxChars: config.markovMaxChars
            },
            blueskyUsername: config.blueskyUsername,
            blueskyApiUrl: config.blueskyApiUrl,
            mastodonApiUrl: config.mastodonApiUrl
        });

        // Validate required configuration
        const requiredVars = [
            ['BLUESKY_USERNAME', config.blueskyUsername],
            ['BLUESKY_PASSWORD', config.blueskyPassword],
            ['BLUESKY_API_URL', config.blueskyApiUrl],
            ['MASTODON_ACCESS_TOKEN', config.mastodonAccessToken],
            ['MASTODON_API_URL', config.mastodonApiUrl]
        ];

        const missingVars = requiredVars
            .filter(([name, value]) => !value)
            .map(([name]) => name);

        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        // Validate Bluesky username
        if (!validateBlueskyUsername(config.blueskyUsername)) {
            const errorMsg = `Invalid Bluesky username format: "${config.blueskyUsername}". ` +
                'Username should be in the format "handle.bsky.social" or "handle.domain.tld". ' +
                'Make sure to include the full domain and check for typos.';
            debug(errorMsg, 'error');
            throw new Error(errorMsg);
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

// Content Management
async function fetchTextContent() {
    // In worker environment, we'll fetch content from the APIs directly
    const posts = await fetchRecentPosts();
    return posts.map(cleanText).filter(text => text.length > 0);
}

async function fetchRecentPosts() {
    try {
        const posts = [];
        
        // Log source accounts
        debug('Fetching posts from Bluesky accounts:', 'info');
        CONFIG.blueskySourceAccounts.forEach(account => debug(`  - ${account}`, 'info'));
        
        debug('Fetching posts from Mastodon accounts:', 'info');
        CONFIG.mastodonSourceAccounts.forEach(account => debug(`  - ${account}`, 'info'));

        try {
            // Fetch from Mastodon
            const mastodonResponse = await fetch(`${CONFIG.mastodonApiUrl}/api/v1/timelines/public`, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.mastodonAccessToken}`,
                    'Accept': 'application/json'
                }
            });
            
            if (!mastodonResponse.ok) {
                const errorData = await mastodonResponse.json();
                debug('Mastodon API error', 'error', errorData);
                throw new Error(`Mastodon API error: ${errorData.error || 'Unknown error'}`);
            }
            
            const mastodonData = await mastodonResponse.json();
            
            if (Array.isArray(mastodonData)) {
                debug(`Retrieved ${mastodonData.length} posts from Mastodon`, 'verbose');
                const mastodonPosts = mastodonData
                    .filter(post => post && post.content)
                    .map(post => {
                        const cleanedText = cleanText(post.content);
                        debug(`Mastodon post: ${cleanedText}`, 'verbose');
                        return cleanedText;
                    })
                    .filter(text => text.length > 0);
                debug(`Processed ${mastodonPosts.length} valid Mastodon posts`, 'verbose');
                posts.push(...mastodonPosts);
            } else {
                debug('Unexpected Mastodon API response format', 'error', mastodonData);
            }
        } catch (error) {
            debug(`Error fetching Mastodon posts: ${error.message}`, 'error');
        }
        
        try {
            // Get Bluesky auth token
            const blueskyToken = await getBlueskyAuth();
            if (!blueskyToken) {
                debug('Skipping Bluesky fetch due to authentication failure', 'error');
            } else {
                // Fetch from Bluesky
                const blueskyResponse = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/app.bsky.feed.getTimeline`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${blueskyToken}`
                    }
                });
                const blueskyData = await blueskyResponse.json();
                
                if (blueskyData && blueskyData.feed && Array.isArray(blueskyData.feed)) {
                    debug(`Retrieved ${blueskyData.feed.length} posts from Bluesky`, 'verbose');
                    const blueskyPosts = blueskyData.feed
                        .filter(item => item && item.post && item.post.record && item.post.record.text)
                        .map(item => {
                            const cleanedText = cleanText(item.post.record.text);
                            debug(`Bluesky post: ${cleanedText}`, 'verbose');
                            return cleanedText;
                        })
                        .filter(text => text.length > 0);
                    debug(`Processed ${blueskyPosts.length} valid Bluesky posts`, 'verbose');
                    posts.push(...blueskyPosts);
                } else {
                    debug('Unexpected Bluesky API response format', 'error', blueskyData);
                }
            }
        } catch (error) {
            debug(`Error fetching Bluesky posts: ${error.message}`, 'error');
        }
        
        const validPosts = posts.filter(text => text && text.length > 0);
        debug(`Successfully fetched ${validPosts.length} total posts`, 'info');
        return validPosts;
        
    } catch (error) {
        debug(`Error in fetchRecentPosts: ${error.message}`, 'error');
        return [];
    }
}

async function getBlueskyAuth() {
    try {
        debug('Authenticating with Bluesky...', 'verbose');
        debug(`Using Bluesky username: ${CONFIG.blueskyUsername}`, 'verbose');
        
        // Validate credentials
        if (!CONFIG.blueskyUsername || !CONFIG.blueskyPassword) {
            throw new Error('Missing Bluesky credentials');
        }
        
        if (!validateBlueskyUsername(CONFIG.blueskyUsername)) {
            throw new Error('Invalid Bluesky username format. Should be handle.bsky.social or handle.domain.tld');
        }

        const authData = {
            "identifier": CONFIG.blueskyUsername,
            "password": CONFIG.blueskyPassword
        };

        debug('Sending Bluesky auth request...', 'verbose', authData);

        const response = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/com.atproto.server.createSession`, {
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
        return data.accessJwt;
    } catch (error) {
        debug(`Bluesky authentication error: ${error.message}`, 'error');
        return null;
    }
}

async function getBlueskyDid() {
    try {
        const response = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${CONFIG.blueskyUsername}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (data.error) {
            debug(`Failed to resolve Bluesky DID: ${data.error}`, 'error', data);
            return null;
        }

        debug(`Resolved DID for ${CONFIG.blueskyUsername}: ${data.did}`, 'info');
        return data.did;
    } catch (error) {
        debug(`Error resolving Bluesky DID: ${error.message}`, 'error');
        return null;
    }
}

// Fetch and process replies
async function fetchReplies() {
    const replies = {
        mastodon: [],
        bluesky: []
    };

    try {
        // Fetch Mastodon replies
        if (CONFIG.mastodonAccessToken) {
            const mastodonResponse = await fetch(
                `${CONFIG.mastodonApiUrl}/api/v1/notifications?types[]=mention`,
                {
                    headers: {
                        'Authorization': `Bearer ${CONFIG.mastodonAccessToken}`
                    }
                }
            );
            
            if (mastodonResponse.ok) {
                const notifications = await mastodonResponse.json();
                for (const notification of notifications) {
                    if (notification.type === 'mention') {
                        replies.mastodon.push({
                            id: notification.status.id,
                            content: cleanText(notification.status.content),
                            account: notification.account.acct,
                            inReplyToId: notification.status.in_reply_to_id
                        });
                    }
                }
            }
        }

        // Fetch Bluesky replies
        if (CONFIG.blueskyUsername && CONFIG.blueskyPassword) {
            const auth = await getBlueskyAuth();
            const did = await getBlueskyDid();
            
            const notificationsResponse = await fetch(
                `${CONFIG.blueskyApiUrl}/xrpc/app.bsky.notification.listNotifications`,
                {
                    headers: {
                        'Authorization': `Bearer ${auth.accessJwt}`
                    }
                }
            );

            if (notificationsResponse.ok) {
                const notifications = await notificationsResponse.json();
                for (const notification of notifications.notifications) {
                    if (notification.reason === 'reply' && notification.record?.text) {
                        replies.bluesky.push({
                            id: notification.cid,
                            content: cleanText(notification.record.text),
                            author: notification.author.handle,
                            uri: notification.uri,
                            replyTo: notification.record.reply?.parent.uri
                        });
                    }
                }
            }
        }
    } catch (error) {
        debug(`Error fetching replies: ${error.message}`, 'error');
    }

    return replies;
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
        const markov = new MarkovChain(CONFIG.markovStateSize);
        markov.addData(cleanContent);

        const options = {
            maxTries: CONFIG.markovMaxTries,
            minChars: CONFIG.markovMinChars,
            maxChars: CONFIG.markovMaxChars
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
        const response = await fetch(`${CONFIG.mastodonApiUrl}/api/v1/statuses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.mastodonAccessToken}`,
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

        const response = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/com.atproto.repo.createRecord`, {
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

// Main Execution
async function main(event = {}) {
    try {
        CONFIG = await loadConfig();
        const contentArray = await fetchTextContent();
        
        // Initialize Markov chain with existing content
        const markovChain = new MarkovChain(CONFIG.markovStateSize);
        markovChain.addData(contentArray);

        // Get the current minute to determine which cron triggered this
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
