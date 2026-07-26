import { debug } from './log.js';

// KV operations for source tweets
const SOURCE_TWEETS_KEY = 'source_tweets';
// KV values cap at 25MB; at ~150 bytes/entry this keeps a 45k-entry corpus to
// ~9 batches instead of ~352, cutting reads/writes and subrequests ~39x.
// Reads use the stored _count, so existing data keeps working.
const BATCH_SIZE = 5000;

// In-memory KV shim used as a fallback for local development and tests. Exposes
// the subset of the Cloudflare KV API this project relies on.
export class LocalStorage {
    constructor() {
        this.store = new Map();
    }

    async put(key, value) {
        this.store.set(key, value);
    }

    async get(key) {
        return this.store.get(key);
    }

    async delete(key) {
        this.store.delete(key);
    }

    async list({ prefix }) {
        return {
            keys: Array.from(this.store.keys())
                .filter(key => key.startsWith(prefix))
                .map(name => ({ name }))
        };
    }
}

async function storeSourceTweets(env, tweets, append = false) {
    try {
        let existingTweets = [];
        if (append) {
            existingTweets = await getSourceTweets(env);
            debug('Appending to existing tweets', 'info', {
                existingCount: existingTweets.length,
                newCount: tweets.length
            });
        }

        // Combine existing and new tweets if appending
        const allTweets = append ? [...existingTweets, ...tweets] : tweets;
        
        // Split tweets into batches to handle KV size limits
        const batches = [];
        for (let i = 0; i < allTweets.length; i += BATCH_SIZE) {
            batches.push(allTweets.slice(i, i + BATCH_SIZE));
        }

        // Store each batch with a unique key
        const promises = batches.map((batch, index) => 
            env.SOURCE_TWEETS.put(`${SOURCE_TWEETS_KEY}_${index}`, JSON.stringify(batch))
        );

        // Store the number of batches for later retrieval
        await env.SOURCE_TWEETS.put(`${SOURCE_TWEETS_KEY}_count`, batches.length.toString());
        await env.SOURCE_TWEETS.put(`${SOURCE_TWEETS_KEY}_total`, allTweets.length.toString());

        await Promise.all(promises);
        return true;
    } catch (error) {
        debug('Failed to store source tweets:', 'error', error);
        return false;
    }
}

export async function getSourceTweets(env) {
    try {
        // Get the number of batches
        const countStr = await env.SOURCE_TWEETS.get(`${SOURCE_TWEETS_KEY}_count`);
        if (!countStr) {
            return [];
        }

        const count = parseInt(countStr, 10);
        const promises = [];

        // Fetch all batches
        for (let i = 0; i < count; i++) {
            promises.push(env.SOURCE_TWEETS.get(`${SOURCE_TWEETS_KEY}_${i}`));
        }

        // Combine all batches
        const results = await Promise.all(promises);
        return results
            .filter(batch => batch !== null)
            .map(batch => JSON.parse(batch))
            .flat();
    } catch (error) {
        debug('Failed to retrieve source tweets:', 'error', error);
        return [];
    }
}

export async function uploadSourceTweetsFromText(env, text, append = true) {
    const tweets = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    return await storeSourceTweets(env, tweets, append);
}

// Get the total count of stored tweets
export async function getTweetCount(env) {
    try {
        const totalStr = await env.SOURCE_TWEETS.get(`${SOURCE_TWEETS_KEY}_total`);
        return totalStr ? parseInt(totalStr, 10) : 0;
    } catch (error) {
        debug('Failed to get tweet count:', 'error', error);
        return 0;
    }
}
