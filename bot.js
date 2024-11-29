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
        const envConfig = {
            debug: process.env.DEBUG_MODE === 'true',
            mastodon: {
                url: process.env.MASTODON_URL,
                token: process.env.MASTODON_ACCESS_TOKEN
            },
            bluesky: {
                service: process.env.BLUESKY_SERVICE,
                identifier: process.env.BLUESKY_IDENTIFIER,
                password: process.env.BLUESKY_APP_PASSWORD
            }
        };

        // Log loaded configuration (excluding sensitive data)
        debug('Loaded configuration:', 'verbose', {
            debug: envConfig.debug,
            mastodon: {
                url: envConfig.mastodon.url
            },
            bluesky: {
                service: envConfig.bluesky.service,
                identifier: envConfig.bluesky.identifier
            }
        });

        // Validate required configuration
        const requiredVars = [
            ['MASTODON_URL', envConfig.mastodon.url],
            ['MASTODON_ACCESS_TOKEN', envConfig.mastodon.token],
            ['BLUESKY_SERVICE', envConfig.bluesky.service],
            ['BLUESKY_IDENTIFIER', envConfig.bluesky.identifier],
            ['BLUESKY_APP_PASSWORD', envConfig.bluesky.password]
        ];

        const missingVars = requiredVars
            .filter(([_name, value]) => !value)
            .map(([name]) => name);

        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

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
        await postToSocialMedia(post);
    } catch (error) {
        debug(`Error in main execution: ${error.message}`, 'error');
        throw error;
    }
}

// Export for worker
export { debug, main, MarkovChain };
