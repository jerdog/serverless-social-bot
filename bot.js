// Essential imports only
import fetch from 'node-fetch';
import { getSourceTweets } from './kv.js';
import { storeRecentPost } from './replies.js';

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
    const logMessage = `[${timestamp}] ${message}`;
    
    // Always log to console
    if (data) {
        console.log(logMessage, data);
    } else {
        console.log(logMessage);
    }

    // Additional debug logging if enabled
    if (process.env.DEBUG_MODE === 'true') {
        if (level === 'error') {
            console.error(logMessage, data || '');
        } else if (level === 'warn') {
            console.warn(logMessage, data || '');
        }
    }
}

// Configuration loader
async function loadConfig() {
    const requiredVars = [
        'MASTODON_API_URL',
        'MASTODON_ACCESS_TOKEN',
        'BLUESKY_API_URL',
        'BLUESKY_USERNAME',
        'BLUESKY_PASSWORD'
    ];

    // Check for required environment variables
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Parse optional numeric parameters
    const markovStateSize = parseInt(process.env.MARKOV_STATE_SIZE || '2', 10);
    const markovMinChars = parseInt(process.env.MARKOV_MIN_CHARS || '30', 10);
    const markovMaxChars = parseInt(process.env.MARKOV_MAX_CHARS || '280', 10);
    const markovMaxTries = parseInt(process.env.MARKOV_MAX_TRIES || '100', 10);

    // Parse optional array parameters
    const mastodonSourceAccounts = process.env.MASTODON_SOURCE_ACCOUNTS
        ? process.env.MASTODON_SOURCE_ACCOUNTS.split(',').map(a => a.trim())
        : ['Mastodon.social'];
    
    const blueskySourceAccounts = process.env.BLUESKY_SOURCE_ACCOUNTS
        ? process.env.BLUESKY_SOURCE_ACCOUNTS.split(',').map(a => a.trim())
        : ['bsky.social'];

    // Parse optional string parameters
    const excludedWords = process.env.EXCLUDED_WORDS
        ? process.env.EXCLUDED_WORDS.split(',').map(w => w.trim())
        : [];

    // Create configuration object
    CONFIG = {
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
        markovStateSize,
        markovMinChars,
        markovMaxChars,
        markovMaxTries,
        mastodonSourceAccounts,
        blueskySourceAccounts,
        excludedWords
    };

    // Duplicate logging
    // debug('Configuration loaded', 'info', {
    //     markovConfig: {
    //         stateSize: CONFIG.markovStateSize,
    //         minChars: CONFIG.markovMinChars,
    //         maxChars: CONFIG.markovMaxChars,
    //         maxTries: CONFIG.markovMaxTries
    //     },
    //     mastodonAccounts: CONFIG.mastodonSourceAccounts,
    //     blueskyAccounts: CONFIG.blueskySourceAccounts,
    //     excludedWords: CONFIG.excludedWords
    // });

    return CONFIG;
}

// Global config object
let CONFIG = null;

// Utility Functions
function validateBlueskyUsername(username) {
    if (!username) {
        debug('Username is empty', 'error');
        return false;
    }
    
    // debug(`Validating Bluesky username: ${username}`, 'verbose');
    
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
    if (!text || typeof text !== 'string') {
        return '';
    }

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

    // Enhanced URL and mention removal
    text = text
        // Remove all common URL patterns including bare domains
        .replace(/(?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi, '')
        // Remove any remaining URLs that might have unusual characters
        .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
        // Remove bare domains (e.g., example.com)
        .replace(/\b[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}\b/gi, '')
        // Remove mentions (@username) - handle various formats including dots and Unicode
        .replace(/@[a-zA-Z0-9_\u0080-\uFFFF](?:[a-zA-Z0-9_\u0080-\uFFFF.-]*[a-zA-Z0-9_\u0080-\uFFFF])?/g, '')
        // Remove mention prefixes (e.g., ".@username" or ". @username")
        .replace(/(?:^|\s)\.\s*@\w+/g, '')
        // Remove RT pattern and any following mentions
        .replace(/^RT\b[^a-zA-Z]*(?:@\w+[^a-zA-Z]*)*/, '')
        // Remove any remaining colons after mentions
        .replace(/(?:^|\s)@\w+:\s*/g, ' ')
        // Clean up punctuation and whitespace, including leading dots
        .replace(/[:\s]+/g, ' ')
        .replace(/^\.\s+/, '')
        .trim();

    // Remove excluded words
    if (CONFIG && CONFIG.excludedWords && CONFIG.excludedWords.length > 0) {
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
        let attempt = 0;
        while (attempt < maxTries) {
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
            }
            attempt++;
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
        let shouldContinue = true;

        while (shouldContinue) {
            const possibleNextWords = this.chain.get(currentState);
            if (!possibleNextWords || possibleNextWords.length === 0) {
                shouldContinue = false;
                continue;
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
async function fetchSourceTweets(env) {
    try {
        if (env && env.SOURCE_TWEETS) {
            // In worker environment, fetch from KV
            const tweets = await getSourceTweets(env);
            if (tweets.length > 0) {
                return tweets.map(cleanText);
            }
            debug('No tweets found in KV storage', 'warn');
            return [];
        } else {
            // Local development: try to fetch from file
            try {
                const sourceTweetsResponse = await fetch('assets/source-tweets.txt');
                if (!sourceTweetsResponse.ok) {
                    debug('Failed to fetch source tweets from file', 'error');
                    return [];
                }
                const content = await sourceTweetsResponse.text();
                return content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map(cleanText);
            } catch (error) {
                debug('Error reading source tweets file:', 'error', error);
                return [];
            }
        }
    } catch (error) {
        debug('Error in fetchSourceTweets:', 'error', error);
        return [];
    }
}

async function fetchTextContent(env) {
    // Fetch both recent posts and source tweets
    const [posts, sourceTweets] = await Promise.all([
        fetchRecentPosts(),
        fetchSourceTweets(env)
    ]);

    // debug(`Fetched ${posts.length} posts from social media`, 'info');
    debug(`Fetched ${sourceTweets.length} tweets from source file`, 'info');

    return [...posts, ...sourceTweets];
}

async function fetchRecentPosts() {
    try {
        const posts = [];
        
        // Log source accounts
        debug(`Fetching posts from Bluesky accounts:\n ${CONFIG.blueskySourceAccounts.join('\n  - ')}`, 'info');
        debug(`Fetching posts from Mastodon accounts:\n ${CONFIG.mastodonSourceAccounts.join('\n  - ')}`, 'info');

        try {
            // Fetch from Mastodon
            const mastodonResponse = await fetch(`${CONFIG.mastodon.url}/api/v1/timelines/public`, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.mastodon.token}`,
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
                // debug(`Retrieved ${mastodonData.length} posts from Mastodon`, 'verbose');
                const mastodonPosts = mastodonData
                    .filter(post => post && post.content)
                    .map(post => {
                        const cleanedText = cleanText(post.content);
                        // debug(`Mastodon post: ${cleanedText}`, 'verbose');
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
                const blueskyResponse = await fetch(`${CONFIG.bluesky.service}/xrpc/app.bsky.feed.getTimeline`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${blueskyToken}`
                    }
                });

                const blueskyData = await blueskyResponse.json();
                
                if (blueskyData && blueskyData.feed && Array.isArray(blueskyData.feed)) {
                    // debug(`Retrieved ${blueskyData.feed.length} posts from Bluesky`, 'verbose');
                    const blueskyPosts = blueskyData.feed
                        .filter(item => item && item.post && item.post.record && item.post.record.text)
                        .map(item => {
                            const cleanedText = cleanText(item.post.record.text);
                            // debug(`Bluesky post: ${cleanedText}`, 'verbose');
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
        debug(`Successfully fetched ${validPosts.length} total posts from social media`, 'info');
        
        // Add fallback content if no posts were fetched
        if (validPosts.length === 0) {
            debug('No posts fetched, using fallback content', 'info');
            validPosts.push(
                'Hello world! This is a test post.',
                'The quick brown fox jumps over the lazy dog.',
                'To be, or not to be, that is the question.',
                'All that glitters is not gold.',
                'A journey of a thousand miles begins with a single step.'
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
        debug(`Authenticating with Bluesky using: ${CONFIG.bluesky.identifier}`, 'verbose');
        
        // Validate credentials
        if (!CONFIG.bluesky.identifier || !CONFIG.bluesky.password) {
            throw new Error('Missing Bluesky credentials');
        }
        
        if (!validateBlueskyUsername(CONFIG.bluesky.identifier)) {
            throw new Error('Invalid Bluesky username format. Should be handle.bsky.social or handle.domain.tld');
        }

        const authData = {
            'identifier': CONFIG.bluesky.identifier,
            'password': CONFIG.bluesky.password
        };

        debug('Sending Bluesky auth request...', 'verbose', authData);

        const response = await fetch(`${CONFIG.bluesky.service}/xrpc/com.atproto.server.createSession`, {
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
        const response = await fetch(`${CONFIG.bluesky.service}/xrpc/com.atproto.identity.resolveHandle?handle=${CONFIG.bluesky.identifier}`, {
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

        debug(`Resolved DID for ${CONFIG.bluesky.identifier}: ${data.did}`, 'info');
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
    try {
        const response = await fetch(`${process.env.MASTODON_API_URL}/api/v1/statuses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: content })
        });

        if (!response.ok) {
            throw new Error(`Failed to post to Mastodon: ${response.statusText}`);
        }

        const data = await response.json();
        storeRecentPost('mastodon', data.id, content);
        debug('Posted to Mastodon successfully');
        return true;
    } catch (error) {
        debug('Error posting to Mastodon:', 'error', error);
        return false;
    }
}

async function postToBluesky(content) {
    try {
        // Get existing auth if available
        let auth = blueskyAuth;
        
        // If no auth or expired, create new session
        if (!auth) {
            auth = await getBlueskyAuth();
            if (!auth) {
                throw new Error('Failed to authenticate with Bluesky');
            }
            blueskyAuth = auth;
        }

        const response = await fetch(`${process.env.BLUESKY_API_URL}/xrpc/com.atproto.repo.createRecord`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.accessJwt}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repo: auth.did,
                collection: 'app.bsky.feed.post',
                record: {
                    text: content,
                    createdAt: new Date().toISOString()
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to post to Bluesky: ${response.statusText}`);
        }

        const data = await response.json();
        storeRecentPost('bluesky', data.uri, content);
        debug('Posted to Bluesky successfully');
        return true;
    } catch (error) {
        debug('Error posting to Bluesky:', 'error', error);
        blueskyAuth = null; // Clear auth on error
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
async function main(env) {
    try {
        // Load configuration
        CONFIG = await loadConfig();
        debug('Configuration loaded', 'info', CONFIG);

        // 30% chance to post
        const randomValue = Math.random();
        debug(`Random value generated: ${(randomValue * 100).toFixed(2)}%`, 'info');
        
        if (randomValue > 0.3) {
            debug('Skipping post based on random chance (above 30% threshold)', 'info');
            return;
        }

        debug('Proceeding with post (within 30% threshold)', 'info');

        // Fetch content for generation
        const content = await fetchTextContent(env);
        if (!content || content.length === 0) {
            debug('No content available for generation', 'error');
            return;
        }

        // Generate and post content
        const post = await generatePost(content);
        if (post) {
            await postToSocialMedia(post.string);
        }
    } catch (error) {
        debug('Error in main execution:', 'error', error);
    }
}

// Export for worker
export { debug, main, MarkovChain, generatePost, loadConfig, cleanText, getBlueskyAuth };
