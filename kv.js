// KV operations for source tweets
const SOURCE_TWEETS_KEY = 'source_tweets';
const BATCH_SIZE = 128; // KV has a limit on value size, so we'll split data into batches

export async function storeSourceTweets(env, tweets, append = false) {
    try {
        let existingTweets = [];
        if (append) {
            existingTweets = await getSourceTweets(env);
            console.log('Appending to existing tweets:', 'info', { 
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
        console.error('Failed to store source tweets:', error);
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
        console.error('Failed to retrieve source tweets:', error);
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
        console.error('Failed to get tweet count:', error);
        return 0;
    }
}
