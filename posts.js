// Storage for the bot's own recent posts: the POSTS_KV binding plus an in-memory
// cache of what we published, keyed `<platform>:<id>`.
//
// This lives apart from bot.js (which writes posts) and replies.js (which reads
// them to decide whether an incoming reply is on one of our posts) so neither has
// to import the other — those two modules used to form an import cycle.
import { debug } from './log.js';
import { LocalStorage } from './kv.js';

// Cache of our bot's recent posts.
const recentPosts = new Map();

// POSTS_KV binding, injected by the Worker at request/cron time.
let postsKV = null;
const localFallback = new LocalStorage();

function initPostsKV(namespace) {
    if (!namespace) {
        debug('No KV namespace provided, using local storage', 'warn');
    }
    postsKV = namespace || localFallback;
}

// The POSTS_KV namespace. replies.js also uses it for `replied:*` markers.
function getPostsKV() {
    return postsKV;
}

// Load every stored post into the memory cache.
async function loadRecentPostsFromKV() {
    if (!postsKV) {
        throw new Error('Cannot load posts - KV not initialized');
    }

    try {
        debug('Loading posts from storage...', 'info');
        const { keys } = await postsKV.list({ prefix: 'post:' });
        const posts = await Promise.all(keys.map(key => postsKV.get(key.name)));

        recentPosts.clear();
        keys.forEach((key, i) => {
            const post = posts[i];
            if (post) {
                // Keep everything after "post:" verbatim: Bluesky ids are AT URIs
                // (at://did:plc:.../...) that themselves contain colons, so a naive
                // split(':') would truncate them to "bluesky:at" and collide.
                recentPosts.set(key.name.slice('post:'.length), JSON.parse(post));
            }
        });

        debug('Loaded posts from storage', 'info', { count: recentPosts.size });
    } catch (error) {
        debug('Error loading posts from storage:', 'error', error);
        throw error;
    }
}

// Populate the cache once per isolate, only if it is empty.
async function warmRecentPosts() {
    if (recentPosts.size === 0) {
        await loadRecentPostsFromKV();
    }
}

// Cache keys, for diagnostics only.
function recentPostKeys() {
    return Array.from(recentPosts.keys());
}

// Record a post the bot just published.
async function storeRecentPost(platform, postId, content) {
    const key = `${platform}:${postId}`;
    debug('Storing recent post', 'info', { key, cacheSize: recentPosts.size });

    const post = { content, timestamp: Date.now() };
    recentPosts.set(key, post);

    try {
        if (!postsKV) {
            throw new Error('Storage not initialized');
        }
        await postsKV.put(`post:${key}`, JSON.stringify(post));

        // Drop posts older than 24h from both the cache and KV.
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const expired = [];
        for (const [existingKey, existingPost] of recentPosts.entries()) {
            if (existingPost.timestamp < cutoff) {
                expired.push(existingKey);
            }
        }
        expired.forEach(oldKey => recentPosts.delete(oldKey));
        await Promise.all(expired.map(oldKey => postsKV.delete(`post:${oldKey}`)));

        debug('Stored post', 'info', { key, removed: expired.length, remaining: recentPosts.size });
    } catch (error) {
        debug('Error in post storage:', 'error', { error: error.message });
        throw error;
    }
}

// Return the content of one of our posts, or null if it isn't ours / is unknown.
async function getOriginalPost(platform, postId) {
    const key = `${platform}:${postId}`;
    debug('Getting original post', 'info', { key, exists: recentPosts.has(key) });

    let post = recentPosts.get(key);

    if (!post) {
        try {
            const stored = await postsKV.get(`post:${key}`);
            if (stored) {
                post = JSON.parse(stored);
                recentPosts.set(key, post);
                debug('Loaded post from storage', 'info', { key });
            } else {
                debug('Post not found in storage', 'info', { key });
            }
        } catch (error) {
            debug('Error loading post from storage:', 'error', error);
        }
    }

    if (!post || !post.content) {
        debug('Post not found in cache or storage', 'info', { key });
        return null;
    }
    return post.content;
}

export {
    initPostsKV,
    getPostsKV,
    loadRecentPostsFromKV,
    warmRecentPosts,
    recentPostKeys,
    storeRecentPost,
    getOriginalPost
};
