// Essential imports only
import 'dotenv/config';
import fetch from 'node-fetch';
import { promises as fs } from 'fs';

// Configuration
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const DEBUG_LEVEL = process.env.DEBUG_LEVEL || 'info';

const CONFIG = {
    mastodonAccessToken: process.env.MASTODON_ACCESS_TOKEN,
    blueskyUsername: process.env.BLUESKY_USERNAME,
    blueskyPassword: process.env.BLUESKY_PASSWORD,
    mastodonInstanceUrl: process.env.MASTODON_API_URL,
    blueskyApiUrl: process.env.BLUESKY_API_URL,
    markovOptions: {
        stateSize: parseInt(process.env.MARKOV_STATE_SIZE) || 2,
        maxTries: parseInt(process.env.MARKOV_MAX_TRIES) || 100,
        minChars: 100,
        maxChars: 280
    }
};

// Utility Functions
function debug(message, level = 'info', data = null) {
    if (!DEBUG_MODE && level !== 'error') return;
    if (DEBUG_LEVEL === 'info' && level === 'verbose') return;

    const timestamp = new Date().toISOString();
    const logLevel = level.toUpperCase();
    console.log(`[${timestamp}] [${logLevel}] ${message}`);
    
    if (data && (DEBUG_LEVEL === 'verbose' || level === 'error')) {
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

async function fetchRecentPosts() {
    const posts = [];
    
    try {
        // Fetch from Mastodon
        const mastodonResponse = await fetch(`${CONFIG.mastodonInstanceUrl}/api/v1/timelines/home`, {
            headers: {
                'Authorization': `Bearer ${CONFIG.mastodonAccessToken}`
            }
        });
        const mastodonPosts = await mastodonResponse.json();
        posts.push(...mastodonPosts.map(post => cleanText(post.content)));
    } catch (error) {
        debug(`Error fetching Mastodon posts: ${error.message}`, 'error');
    }
    
    try {
        // Fetch from Bluesky
        const blueskyResponse = await fetch(`${CONFIG.blueskyApiUrl}/xrpc/app.bsky.feed.getTimeline`, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${CONFIG.blueskyUsername}:${CONFIG.blueskyPassword}`).toString('base64')}`
            }
        });
        const blueskyPosts = await blueskyResponse.json();
        posts.push(...blueskyPosts.feed.map(post => cleanText(post.post.text)));
    } catch (error) {
        debug(`Error fetching Bluesky posts: ${error.message}`, 'error');
    }
    
    return posts.filter(text => text.length > 0);
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
        const markov = new MarkovChain(CONFIG.markovOptions.stateSize);
        markov.addData(cleanContent);

        const options = {
            maxTries: CONFIG.markovOptions.maxTries,
            minChars: CONFIG.markovOptions.minChars,
            maxChars: CONFIG.markovOptions.maxChars
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
    const response = await fetch(`${CONFIG.mastodonInstanceUrl}/api/v1/statuses`, {
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
        
        if (DEBUG_MODE) {
            debug('Generated post:', 'info');
            console.log('\n---Generated Post Start---');
            console.log(generatedPost);
            console.log('---Generated Post End---\n');
        }
        
        if (!DEBUG_MODE) {
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
