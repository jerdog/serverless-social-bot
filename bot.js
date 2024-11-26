// Essential imports only
import 'dotenv/config';
import fetch from 'node-fetch';
import { promises as fs } from 'fs';

// Configuration
const CONFIG = {
    debug: process.env.DEBUG_MODE === 'true',
    debugLevel: process.env.DEBUG_LEVEL || 'info',
    
    // Markov Chain settings
    markovStateSize: parseInt(process.env.MARKOV_STATE_SIZE) || 2,
    markovMaxTries: parseInt(process.env.MARKOV_MAX_TRIES) || 100,
    markovMinChars: parseInt(process.env.MARKOV_MIN_CHARS) || 100,
    markovMaxChars: parseInt(process.env.MARKOV_MAX_CHARS) || 280,
    
    // Bluesky settings
    blueskyUsername: process.env.BLUESKY_USERNAME,
    blueskyPassword: process.env.BLUESKY_PASSWORD,
    blueskyApiUrl: process.env.BLUESKY_API_URL,
    blueskySourceAccounts: JSON.parse(process.env.BLUESKY_SOURCE_ACCOUNTS || '[]'),
    
    // Mastodon settings
    mastodonAccessToken: process.env.MASTODON_ACCESS_TOKEN,
    mastodonApiUrl: process.env.MASTODON_API_URL,
    mastodonSourceAccounts: JSON.parse(process.env.MASTODON_SOURCE_ACCOUNTS || '[]')
};

// Utility Functions
function debug(message, level = 'info', data = null) {
    if (!CONFIG.debug && level !== 'error') return;
    if (CONFIG.debugLevel === 'info' && level === 'verbose') return;

    const timestamp = new Date().toISOString();
    const logLevel = level.toUpperCase();
    console.log(`[${timestamp}] [${logLevel}] ${message}`);
    
    if (data && (CONFIG.debugLevel === 'verbose' || level === 'error')) {
        console.log(data);
    }
}

function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&#x2F;': '/',
        '&#x2f;': '/',
        '&#x5C;': '\\',
        '&#x5c;': '\\',
        '&nbsp;': ' '
    };
    
    return text.replace(/&[#\w]+;/g, entity => entities[entity] || entity);
}

function cleanText(text) {
    if (!text || typeof text !== 'string') return '';

    // First decode HTML entities
    text = decodeHtmlEntities(text);

    return text
        // Remove URLs
        .replace(/(https?:\/\/[^\s]+)|(www\.[^\s]+)/g, '')
        // Remove mentions (@username)
        .replace(/@[\w.-]+/g, '')
        // Remove RT prefix
        .replace(/^RT\s+/i, '')
        // Remove multiple spaces and trim
        .replace(/\s+/g, ' ')
        .trim();
}

// Markov Chain Implementation
class MarkovChain {
    constructor(stateSize = 2) {
        this.stateSize = stateSize;
        this.chain = new Map();
        this.startStates = [];
    }

    addData(texts) {
        for (const text of texts) {
            if (typeof text !== 'string' || !text.trim()) continue;
            
            const words = text.trim().split(/\s+/);
            if (words.length < this.stateSize + 1) continue;

            const startState = words.slice(0, this.stateSize).join(' ');
            this.startStates.push(startState);

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
        }
    }

    generate(options = {}) {
        const {
            maxTries = 100,
            minChars = 100,
            maxChars = 280
        } = options;

        for (let attempt = 0; attempt < maxTries; attempt++) {
            try {
                const startIdx = Math.floor(Math.random() * this.startStates.length);
                let currentState = this.startStates[startIdx];
                let result = currentState.split(/\s+/);
                let currentLength = currentState.length;

                // Generate text until we hit maxChars or can't generate more
                while (currentLength < maxChars) {
                    const nextWords = this.chain.get(currentState);
                    if (!nextWords || nextWords.length === 0) break;

                    const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];
                    if (!nextWord) break;

                    // Check if adding the next word would exceed maxChars
                    const newLength = currentLength + 1 + nextWord.length; // +1 for space
                    if (newLength > maxChars) break;

                    result.push(nextWord);
                    currentLength = newLength;
                    const words = result.slice(-this.stateSize);
                    currentState = words.join(' ');
                }

                const generatedText = result.join(' ');
                // Check if the generated text meets our length criteria
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
    const textData = await fs.readFile('tweets.txt', 'utf8');
    return textData.split('\n').map(cleanText).filter(text => text.length > 0);
}

async function getBlueskyAuth() {
    try {
        const response = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/com.atproto.server.createSession`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                identifier: CONFIG.blueskyUsername,
                password: CONFIG.blueskyPassword
            })
        });

        const data = await response.json();
        if (data.error) {
            debug('Bluesky authentication failed', 'error', data);
            return null;
        }

        return data.accessJwt;
    } catch (error) {
        debug(`Error getting Bluesky auth token: ${error.message}`, 'error');
        return null;
    }
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
            const mastodonResponse = await fetch(`${CONFIG.mastodonApiUrl}/api/v1/timelines/home`, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.mastodonAccessToken}`
                }
            });
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
    const response = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${CONFIG.blueskyUsername}:${CONFIG.blueskyPassword}`).toString('base64')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            repo: CONFIG.blueskyUsername,
            collection: 'app.bsky.feed.post',
            record: {
                text: content,
                createdAt: new Date().toISOString()
            }
        })
    });
    return await response.json();
}

async function postToSocialMedia(content) {
    const mastodonResponse = await postToMastodon(content);
    const blueskyResponse = await postToBluesky(content);
    return { mastodonResponse, blueskyResponse };
}

// Main Execution
async function main() {
    try {
        debug('Starting bot execution', 'info');

        // 30% chance to proceed with post generation
        const shouldProceed = Math.random() < 0.3;
        if (!shouldProceed) {
            debug('Random check failed - skipping this run (70% probability)', 'info');
            return;
        }

        debug('Random check passed - proceeding with generation (30% probability)', 'info');
        
        const fileContent = await fetchTextContent();
        debug(`Loaded ${fileContent.length} lines from text file`, 'info');
        
        const recentPosts = await fetchRecentPosts();
        debug(`Fetched ${recentPosts.length} recent posts`, 'info');
        
        const allContent = [...fileContent, ...recentPosts];
        debug(`Total content items for processing: ${allContent.length}`, 'info');
        
        const generatedPost = await generatePost(allContent);
        
        if (CONFIG.debug) {
            debug('Generated post:', 'info');
            console.log('\n---Generated Post Start---');
            console.log(generatedPost);
            console.log('---Generated Post End---\n');
        }
        
        if (!CONFIG.debug) {
            debug('Posting to social media platforms', 'info');
            await postToSocialMedia(generatedPost);
            debug('Successfully posted to all platforms', 'info');
        } else {
            debug('Debug mode enabled - skipping actual posting', 'info');
        }
        
    } catch (error) {
        debug(`Error in main execution: ${error.message}`, 'error');
        throw error;
    }
}

// Start the bot if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
