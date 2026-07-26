// Feedback storage: records the bot's generated posts and replies so they can be
// upvoted/downvoted from the dashboard and used to tune the model over time.
//
// Records persist in POSTS_KV under a `feedback:` prefix, independent of the
// short-lived `post:` cache in replies.js, so labels survive for training.
//
// Posts are deduplicated by content: the same generated text sent to both
// Mastodon and Bluesky is one logical post (stored once, with a `platforms`
// list). Replies are unique per platform+id (each is a distinct response).
import { debug } from './log.js';
import { LocalStorage } from './kv.js';

const FEEDBACK_PREFIX = 'feedback:';
const VALID_TYPES = ['post', 'reply'];
const VALID_VOTES = [-1, 0, 1];

let feedbackKV = null;

// Initialize the feedback store. Falls back to in-memory storage when no KV
// namespace is provided (local dev / tests).
function initFeedback(namespace) {
    feedbackKV = namespace || new LocalStorage();
    if (!namespace) {
        debug('No KV namespace for feedback, using local storage', 'warn');
    }
}

// Stable, dependency-free content hash (djb2) used to dedupe posts by content.
function hashContent(content) {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
        hash = (((hash << 5) + hash) + content.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
}

// Key scheme: posts by content hash (deduped across platforms); replies per
// platform+id. For posts, `id` IS the content hash (also stored on the record),
// so the dashboard can vote by that id without knowing the content.
// Single place the type -> key mapping is stated. Posts are keyed by content
// hash (deduped across platforms), replies by platform + id.
function feedbackKey(type, platform, id) {
    return type === 'post'
        ? `${FEEDBACK_PREFIX}post:${id}`
        : `${FEEDBACK_PREFIX}reply:${platform}:${id}`;
}

// List all feedback keys, following KV pagination so nothing is dropped.
async function listAllKeys() {
    const keys = [];
    let cursor;
    let complete = false;
    while (!complete) {
        const res = await feedbackKV.list({ prefix: FEEDBACK_PREFIX, cursor });
        for (const k of res.keys) keys.push(k);
        // LocalStorage returns no list_complete (=> undefined => treat as done).
        complete = res.list_complete !== false;
        cursor = res.cursor;
    }
    return keys;
}

// Record a generated item so it can be rated. Posts dedupe by content, merging
// the platform into an existing record; existing votes are preserved.
async function recordContent({ type, platform, id, content, context = null, model = null }) {
    if (!feedbackKV) {
        debug('Feedback storage not initialized, skipping record', 'warn');
        return null;
    }
    if (!VALID_TYPES.includes(type) || !platform || !content || (type === 'reply' && !id)) {
        debug('Invalid feedback content, skipping', 'warn', { type, platform, hasId: !!id });
        return null;
    }

    const recordId = type === 'post' ? hashContent(content) : String(id);
    const key = feedbackKey(type, platform, recordId);

    try {
        const existing = await feedbackKV.get(key);
        if (existing) {
            // Merge this platform into the record (back-compat: old records had a
            // singular `platform`). Preserve the vote; only write if it changed.
            const record = JSON.parse(existing);
            const platforms = record.platforms || (record.platform ? [record.platform] : []);
            if (!platforms.includes(platform)) {
                platforms.push(platform);
                record.platforms = platforms;
                delete record.platform;
                await feedbackKV.put(key, JSON.stringify(record));
                debug('Merged platform into feedback record', 'info', { key, platform });
            }
            return record;
        }

        const record = {
            id: recordId,
            type,
            platforms: [platform],
            content,
            context,
            model,
            createdAt: new Date().toISOString(),
            vote: 0
        };
        await feedbackKV.put(key, JSON.stringify(record));
        debug('Recorded content for feedback', 'info', { key });
        return record;
    } catch (error) {
        debug('Error recording feedback content:', 'error', error);
        return null;
    }
}

// Set the vote (-1 down, 0 none, 1 up) on a recorded item. For posts, `id` is the
// content hash; for replies, `platform`+`id` identify it. Returns the updated
// record, or null if it does not exist.
async function recordVote({ type, platform, id, vote }) {
    if (!feedbackKV) {
        throw new Error('Feedback storage not initialized');
    }
    if (!VALID_TYPES.includes(type) || !id || (type === 'reply' && !platform)) {
        throw new Error('Invalid vote target');
    }
    if (!VALID_VOTES.includes(vote)) {
        throw new Error('Vote must be -1, 0, or 1');
    }

    const key = feedbackKey(type, platform, id);
    const existing = await feedbackKV.get(key);
    if (!existing) {
        return null;
    }

    const record = JSON.parse(existing);
    record.vote = vote;
    record.votedAt = new Date().toISOString();
    await feedbackKV.put(key, JSON.stringify(record));
    debug('Recorded vote', 'info', { key, vote });
    return record;
}

// List feedback records, newest first, optionally filtered by type.
async function listFeedback({ type = null } = {}) {
    if (!feedbackKV) {
        return [];
    }

    try {
        const keys = await listAllKeys();
        const raws = await Promise.all(keys.map(key => feedbackKV.get(key.name)));

        const records = [];
        raws.forEach((raw, i) => {
            if (!raw) {
                return;
            }
            try {
                const record = JSON.parse(raw);
                if (!type || record.type === type) {
                    records.push(record);
                }
            } catch (parseError) {
                debug('Skipping unparseable feedback record', 'warn', { key: keys[i].name });
            }
        });
        records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return records;
    } catch (error) {
        debug('Error listing feedback:', 'error', error);
        return [];
    }
}

// Delete every feedback record. Returns the number removed.
async function clearFeedback() {
    if (!feedbackKV) {
        return 0;
    }
    try {
        const keys = await listAllKeys();
        await Promise.all(keys.map(key => feedbackKV.delete(key.name)));
        debug('Cleared feedback records', 'info', { removed: keys.length });
        return keys.length;
    } catch (error) {
        debug('Error clearing feedback:', 'error', error);
        return 0;
    }
}

// Summary tallies for the dashboard header.
function summarizeFeedback(records) {
    return records.reduce((acc, r) => {
        acc.total += 1;
        if (r.vote === 1) acc.up += 1;
        else if (r.vote === -1) acc.down += 1;
        else acc.unrated += 1;
        return acc;
    }, { total: 0, up: 0, down: 0, unrated: 0 });
}

export { initFeedback, recordContent, recordVote, listFeedback, clearFeedback, summarizeFeedback };
