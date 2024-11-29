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
async function loadConfig() {
    try {
        debug('Loading configuration...', 'verbose');

        // Load configuration from environment variables
        const envConfig = {
            debug: process.env.DEBUG_MODE === 'true',
            mastodon: {
                url: process.env.MASTODON_API_URL,
                token: process.env.MASTODON_ACCESS_TOKEN
            },
            bluesky: {
                service: process.env.BLUESKY_API_URL,
                identifier: process.env.BLUESKY_USERNAME,
                password: process.env.BLUESKY_PASSWORD
            },
            markovStateSize: parseInt(process.env.MARKOV_STATE_SIZE || '2', 10),
            markovMinChars: parseInt(process.env.MARKOV_MIN_CHARS || '30', 10),
            markovMaxChars: parseInt(process.env.MARKOV_MAX_CHARS || '280', 10),
            markovMaxTries: parseInt(process.env.MARKOV_MAX_TRIES || '100', 10),
            // Add source accounts with defaults
            mastodonSourceAccounts: (process.env.MASTODON_SOURCE_ACCOUNTS || '').split(',').filter(Boolean),
            blueskySourceAccounts: (process.env.BLUESKY_SOURCE_ACCOUNTS || '').split(',').filter(Boolean),
            // Add default source accounts if none provided
            excludedWords: (process.env.EXCLUDED_WORDS || '').split(',').filter(Boolean)
        };

        // If no source accounts provided, use some defaults
        if (envConfig.mastodonSourceAccounts.length === 0) {
            envConfig.mastodonSourceAccounts = ['Mastodon.social'];
        }
        if (envConfig.blueskySourceAccounts.length === 0) {
            envConfig.blueskySourceAccounts = ['bsky.social'];
        }

        // Log loaded configuration (excluding sensitive data)
        debug('Loaded configuration:', 'verbose', {
            debug: envConfig.debug,
            mastodon: {
                url: envConfig.mastodon.url
            },
            bluesky: {
                service: envConfig.bluesky.service,
                identifier: envConfig.bluesky.identifier
            },
            markovStateSize: envConfig.markovStateSize,
            markovMinChars: envConfig.markovMinChars,
            markovMaxChars: envConfig.markovMaxChars,
            markovMaxTries: envConfig.markovMaxTries
        });

        // Validate required configuration
        const requiredVars = [
            ['MASTODON_API_URL', envConfig.mastodon.url],
            ['MASTODON_ACCESS_TOKEN', envConfig.mastodon.token],
            ['BLUESKY_API_URL', envConfig.bluesky.service],
            ['BLUESKY_USERNAME', envConfig.bluesky.identifier],
            ['BLUESKY_PASSWORD', envConfig.bluesky.password]
        ];

        const missingVars = requiredVars
            .filter(([_name, value]) => !value)
            .map(([name]) => name);

        if (missingVars.length > 0) {
            const error = new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
            debug(error.message, 'error');
            throw error;
        }

        CONFIG = envConfig;
        return envConfig;
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

    // Remove control characters and normalize whitespace
    text = text
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
        .replace(/\s+/g, ' ')
        .trim();

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
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
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
    }

    async addData(texts) {
        if (!Array.isArray(texts) || texts.length === 0) {
            throw new Error('No valid training data found');
        }

        const validTexts = texts.filter(text => typeof text === 'string' && text.trim().length > 0);
        if (validTexts.length === 0) {
            throw new Error('No valid training data found');
        }

        for (const text of validTexts) {
            const words = text.trim().split(/\s+/);
            if (words.length < this.stateSize) continue;

            for (let i = 0; i <= words.length - this.stateSize; i++) {
                const state = words.slice(i, i + this.stateSize).join(' ');
                const nextWord = words[i + this.stateSize];

                if (!this.chain.has(state)) {
                    this.chain.set(state, []);
                }

                if (nextWord) {
                    this.chain.get(state).push(nextWord);
                }

                if (i === 0) {
                    this.startStates.push(state);
                }
            }
        }

        if (this.startStates.length === 0) {
            throw new Error('No valid training data found');
        }
    }

    async generate({ minChars = 100, maxChars = 280, maxTries = 100 } = {}) {
        for (let attempt = 0; attempt < maxTries; attempt++) {
            try {
                const result = await this._generateOnce();
                if (result.length >= minChars && result.length <= maxChars) {
                    return { string: result };
                }
            } catch (error) {
                if (error.message === 'No training data available') {
                    throw error;
                }
                // Continue trying if it's just a generation issue
                continue;
            }
        }
        throw new Error('Failed to generate valid text within constraints');
    }

    _generateOnce() {
        if (this.startStates.length === 0) {
            throw new Error('No training data available');
        }

        const startState = this.startStates[Math.floor(Math.random() * this.startStates.length)];
        let currentState = startState;
        let result = startState;
        let usedStates = new Set([startState]);

        while (true) {
            const possibleNextWords = this.chain.get(currentState);
            if (!possibleNextWords || possibleNextWords.length === 0) {
                break;
            }

            // Shuffle possible next words to increase variation
            const shuffledWords = [...possibleNextWords].sort(() => Math.random() - 0.5);
            let foundNew = false;

            for (const nextWord of shuffledWords) {
                const newState = result.split(/\s+/).slice(-(this.stateSize - 1)).concat(nextWord).join(' ');
                if (!usedStates.has(newState)) {
                    result += ' ' + nextWord;
                    currentState = newState;
                    usedStates.add(newState);
                    foundNew = true;
                    break;
                }
            }

            if (!foundNew) break;
        }

        return result;
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
        
        // Add fallback content if no posts were fetched
        if (validPosts.length === 0) {
            debug('No posts fetched, using fallback content', 'info');
            validPosts.push(
                "Hello world! This is a test post.",
                "The quick brown fox jumps over the lazy dog.",
                "To be, or not to be, that is the question.",
                "All that glitters is not gold.",
                "A journey of a thousand miles begins with a single step."
            );
        }
        
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
            'identifier': CONFIG.blueskyUsername,
            'password': CONFIG.blueskyPassword
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

// Post Generation
async function generatePost(content) {
    if (!Array.isArray(content) || content.length === 0) {
        throw new Error('Content array is empty');
    }

    const validContent = content.filter(text => typeof text === 'string' && text.trim().length > 0);
    if (validContent.length === 0) {
        throw new Error('Content array is empty');
    }

    try {
        const markov = new MarkovChain(CONFIG.markovStateSize);
        await markov.addData(validContent);
        return await markov.generate({
            minChars: CONFIG.markovMinChars,
            maxChars: CONFIG.markovMaxChars,
            maxTries: CONFIG.markovMaxTries
        });
    } catch (error) {
        debug(`Error generating Markov chain: ${error.message}`, 'error');
        throw new Error(error.message);
    }
}

// Social Media Integration
async function postToMastodon(content) {
    const response = await fetch(`${CONFIG.mastodonApiUrl}/api/v1/statuses`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.mastodonAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: content })
    });
    return await response.json();
}

async function postToBluesky(content) {
    try {
        // Get auth token
        const token = await getBlueskyAuth();
        if (!token) {
            debug('Failed to authenticate with Bluesky', 'error');
            return false;
        }

        // Get DID
        const did = await getBlueskyDid();
        if (!did) {
            debug('Failed to resolve Bluesky DID', 'error');
            return false;
        }

        debug('Creating Bluesky post record...', 'info');
        const createRecordResponse = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/com.atproto.repo.createRecord`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repo: did,
                collection: 'app.bsky.feed.post',
                record: {
                    text: content,
                    createdAt: new Date().toISOString(),
                    $type: 'app.bsky.feed.post'
                }
            })
        });

        const createRecordData = await createRecordResponse.json();
        
        if (createRecordData.error) {
            debug(`Bluesky posting failed: ${createRecordData.error}`, 'error', createRecordData);
            return false;
        }

        debug('Successfully posted to Bluesky', 'info');
        return true;
    } catch (error) {
        debug(`Error posting to Bluesky: ${error.message}`, 'error');
        return false;
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
async function main() {
    try {
        // Load configuration
        CONFIG = await loadConfig();
        
        debug('Bot started', 'essential');
        
        if (CONFIG.excludedWords.length > 0) {
            debug(`Excluding words: ${CONFIG.excludedWords.join(', ')}`, 'info');
        }

        // 30% chance to proceed with post generation
        const shouldProceed = Math.random() < 0.3;
        if (!shouldProceed) {
            debug('Random check failed - skipping this run (70% probability)', 'essential');
            return;
        }

        debug('Random check passed - proceeding with generation (30% probability)', 'essential');
        
        // Get source content
        const sourceContent = await fetchTextContent();
        if (!sourceContent || sourceContent.length === 0) {
            debug('No source content available', 'error');
            return;
        }

        // Generate post
        const post = await generatePost(sourceContent);
        if (!post) {
            debug('Failed to generate valid post', 'error');
            return;
        }

        // Post to social media
        await postToSocialMedia(post.string);
    } catch (error) {
        debug(`Error in main execution: ${error.message}`, 'error');
        throw error;
    }
}

// Export for worker
export { debug, main, MarkovChain, generatePost, loadConfig };
