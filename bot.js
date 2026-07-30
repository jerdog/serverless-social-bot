import fetch from 'node-fetch';
import { debug } from './log.js';
import { getSourceTweets } from './kv.js';
import { storeRecentPost } from './replies.js';
import { recordContent } from './feedback.js';
import { postMastodonStatus, createBlueskyRecord, getBlueskyAuth } from './social.js';

// Generate a unique id for content created in debug mode (no real post id).
function debugId() {
    return `debug-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// HTML processing functions
// Static entity map, defined once at module scope (cleanText runs it over every
// fetched post and source tweet).
const HTML_ENTITIES = {
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

function decodeHtmlEntities(text) {
    return text.replace(/&[^;]+;/g, entity => HTML_ENTITIES[entity] || '');
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
    const markovMinChars = parseInt(process.env.MARKOV_MIN_CHARS || '100', 10);
    const markovMaxChars = parseInt(process.env.MARKOV_MAX_CHARS || '280', 10);
    const markovMaxTries = parseInt(process.env.MARKOV_MAX_TRIES || '100', 10);

    // Probability (0-1) that a /run or scheduled tick actually posts. Default 0.3.
    // Set to 1 to always post (useful for testing with DEBUG_MODE on).
    let postProbability = parseFloat(process.env.POST_PROBABILITY);
    if (!Number.isFinite(postProbability) || postProbability < 0 || postProbability > 1) {
        postProbability = 0.3;
    }

    // Parse optional array parameters
    const mastodonSourceAccounts = process.env.MASTODON_SOURCE_ACCOUNTS
        ? process.env.MASTODON_SOURCE_ACCOUNTS.split(',').map(a => a.trim())
        : ['Mastodon.social'];
    
    const blueskySourceAccounts = process.env.BLUESKY_SOURCE_ACCOUNTS
        ? process.env.BLUESKY_SOURCE_ACCOUNTS.split(',').map(a => a.trim())
        : ['bsky.social'];

    // Parse optional string parameters
    const excludedWords = process.env.EXCLUDED_WORDS
        ? process.env.EXCLUDED_WORDS.split(',').map(w => w.trim()).filter(w => w.length > 0)
        : [];

    // Precompile the excluded-words matcher once (regex metacharacters escaped so
    // words like "c++" are matched literally). Reused by cleanText on every call.
    const excludedWordsRegex = excludedWords.length > 0
        ? new RegExp(`\\b(${excludedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
        : null;

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
        postProbability,
        mastodonSourceAccounts,
        blueskySourceAccounts,
        excludedWords,
        excludedWordsRegex
    };

    return CONFIG;
}

// Global config object
let CONFIG = null;

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
        // Leading RT marker. (Any "@name" it used to also strip is already gone:
        // the mention pass above removes every mention in the string.)
        .replace(/^RT\b[^a-zA-Z]*/, '')
        // Clean up punctuation and whitespace, including leading dots
        .replace(/[:\s]+/g, ' ')
        .replace(/^\.\s+/, '')
        .trim();

    // Remove excluded words (matcher precompiled once in loadConfig)
    if (CONFIG && CONFIG.excludedWordsRegex) {
        text = text.replace(CONFIG.excludedWordsRegex, '').replace(/\s+/g, ' ').trim();
    }

    // No trailing control-char/whitespace pass here: the URL and mention
    // passes only delete characters, so they cannot reintroduce what the
    // normalization above already stripped.
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

                // Single Map lookup instead of has/set/get (three hashes of the
                // same key) — this loop runs ~855k times for a 45k-entry corpus.
                let transitions = this.chain.get(state);
                if (!transitions) {
                    transitions = [];
                    this.chain.set(state, transitions);
                }
                if (nextWord) {
                    transitions.push(nextWord);
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
        // Keep the words as an array: deriving the next state from the accumulated
        // string meant re-splitting it for every candidate word (O(n^2) per post).
        const resultWords = startState.split(/\s+/);
        const tailSize = this.stateSize - 1;
        let currentState = startState;
        const usedStates = new Set([startState]);
        let possibleNextWords = this.chain.get(currentState);

        while (possibleNextWords && possibleNextWords.length > 0) {
            const tail = resultWords.slice(-tailSize);
            const count = possibleNextWords.length;
            // Walk the candidates from a random offset instead of copying and
            // sorting the whole list — popular states hold thousands of words and
            // the first unused candidate almost always wins.
            const offset = Math.floor(Math.random() * count);
            let nextWord = null;
            let nextState = null;

            for (let i = 0; i < count; i++) {
                const candidate = possibleNextWords[(offset + i) % count];
                const candidateState = tail.concat(candidate).join(' ');
                if (!usedStates.has(candidateState)) {
                    nextWord = candidate;
                    nextState = candidateState;
                    break;
                }
            }

            if (nextWord === null) break;

            resultWords.push(nextWord);
            currentState = nextState;
            usedStates.add(nextState);
            possibleNextWords = this.chain.get(currentState);
        }

        return resultWords.join(' ');
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
                const sourceTweetsResponse = await fetch('assets/tweets.txt');
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
                const mastodonPosts = mastodonData
                    .filter(post => post && post.content)
                    .map(post => cleanText(post.content))
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
            const blueskyAuth = await getBlueskyAuth();
            if (!blueskyAuth || !blueskyAuth.accessJwt) {
                debug('Skipping Bluesky fetch due to authentication failure', 'error');
            } else {
                // Fetch from Bluesky
                const blueskyResponse = await fetch(`${CONFIG.bluesky.service}/xrpc/app.bsky.feed.getTimeline`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${blueskyAuth.accessJwt}`
                    }
                });

                const blueskyData = await blueskyResponse.json();
                
                if (blueskyData && blueskyData.feed && Array.isArray(blueskyData.feed)) {
                    const blueskyPosts = blueskyData.feed
                        .filter(item => item && item.post && item.post.record && item.post.record.text)
                        .map(item => cleanText(item.post.record.text))
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
        // Check if we're in debug mode
        if (process.env.DEBUG_MODE === 'true') {
            debug('Debug mode: Would post to Mastodon:', 'info', {
                content,
                platform: 'mastodon'
            });
            await recordContent({ type: 'post', platform: 'mastodon', id: debugId(), content, model: 'markov' });
            return true;
        }

        const response = await postMastodonStatus({ status: content, visibility: 'public' });

        if (!response.ok) {
            const errorData = await response.text();
            debug('Failed to post to Mastodon', 'error', {
                status: response.status,
                statusText: response.statusText,
                error: errorData
            });
            throw new Error(`Failed to post to Mastodon: ${errorData}`);
        }

        const data = await response.json();
        debug('Post created successfully', 'info', { 
            id: data.id,
            url: data.url
        });

        // Store the post in our cache using the numeric ID
        try {
            await storeRecentPost('mastodon', data.id, content);
            await recordContent({ type: 'post', platform: 'mastodon', id: data.id, content, model: 'markov' });
            debug('Post stored in cache', 'info', {
                id: data.id,
                content: content.substring(0, 50) + '...'
            });
        } catch (error) {
            debug('Error storing post:', 'error', error);
            // Continue even if storage fails - we don't want to fail the post
        }

        return true;
    } catch (error) {
        debug('Error posting to Mastodon:', 'error', error);
        return false;
    }
}

async function postToBluesky(content) {
    try {
        // Check if we're in debug mode
        if (process.env.DEBUG_MODE === 'true') {
            debug('Debug mode: Would post to Bluesky:', 'info', {
                content,
                platform: 'bluesky'
            });
            await recordContent({ type: 'post', platform: 'bluesky', id: debugId(), content, model: 'markov' });
            return true;
        }

        // Get auth token
        const auth = await getBlueskyAuth();
        if (!auth || !auth.accessJwt || !auth.did) {
            throw new Error('Failed to authenticate with Bluesky');
        }

        debug('Posting to Bluesky', 'info', {
            authenticated: true,
            did: auth.did
        });

        const response = await createBlueskyRecord(auth, {
            text: content,
            createdAt: new Date().toISOString()
        });

        if (!response.ok) {
            const errorData = await response.text();
            debug('Failed to post to Bluesky', 'error', {
                status: response.status,
                statusText: response.statusText,
                error: errorData
            });
            throw new Error(`Failed to post to Bluesky: ${errorData}`);
        }

        const data = await response.json();
        debug('Post created successfully', 'info', { uri: data.uri });
        
        // Store the post in our cache
        try {
            await storeRecentPost('bluesky', data.uri, content);
            await recordContent({ type: 'post', platform: 'bluesky', id: data.uri, content, model: 'markov' });
            debug('Post stored in cache', 'info', { uri: data.uri });
        } catch (error) {
            debug('Error storing post:', 'error', error);
            // Continue even if storage fails - we don't want to fail the post
        }

        return true;
    } catch (error) {
        debug('Error posting to Bluesky:', 'error', error);
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
        // Load configuration (loadConfig sets the module-level CONFIG).
        await loadConfig();
        // Log only non-sensitive config (never tokens/passwords).
        debug('Configuration loaded', 'info', {
            markovConfig: {
                stateSize: CONFIG.markovStateSize,
                minChars: CONFIG.markovMinChars,
                maxChars: CONFIG.markovMaxChars,
                maxTries: CONFIG.markovMaxTries
            },
            postProbability: CONFIG.postProbability,
            mastodonAccounts: CONFIG.mastodonSourceAccounts,
            blueskyAccounts: CONFIG.blueskySourceAccounts,
            excludedWords: CONFIG.excludedWords
        });

        // Post only some of the time (POST_PROBABILITY, default 0.3).
        const threshold = CONFIG.postProbability;
        const randomValue = Math.random();
        debug(`Random value generated: ${(randomValue * 100).toFixed(2)}% (post threshold: ${(threshold * 100).toFixed(0)}%)`, 'info');

        if (randomValue > threshold) {
            debug('Skipping post based on random chance', 'info');
            return;
        }

        debug('Proceeding with post', 'info');

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
export { main, MarkovChain, generatePost, loadConfig, cleanText, debugId };
