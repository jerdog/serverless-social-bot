// Feedback storage: records the bot's generated posts and replies so they can be
// upvoted/downvoted from the dashboard and used to tune the model over time.
//
// Records persist in POSTS_KV under a `feedback:` prefix, independent of the
// short-lived `post:` cache in replies.js, so labels survive for training.
import { debug } from './bot.js';
import { LocalStorage } from './replies.js';

const FEEDBACK_PREFIX = 'feedback:';
const VALID_TYPES = ['post', 'reply'];
const VALID_VOTES = [-1, 0, 1];

let feedbackKV = null;

// Initialize the feedback store. Falls back to in-memory storage (shared with
// replies.js's LocalStorage implementation) when no KV namespace is provided.
function initFeedback(namespace) {
    feedbackKV = namespace || new LocalStorage();
    if (!namespace) {
        debug('No KV namespace for feedback, using local storage', 'warn');
    }
}

function feedbackKey(type, platform, id) {
    return `${FEEDBACK_PREFIX}${type}:${platform}:${id}`;
}

// Record a generated item so it can be rated. Idempotent: re-recording the same
// id preserves any existing vote rather than resetting it.
async function recordContent({ type, platform, id, content, context = null }) {
    if (!feedbackKV) {
        debug('Feedback storage not initialized, skipping record', 'warn');
        return null;
    }
    if (!VALID_TYPES.includes(type) || !platform || !id || !content) {
        debug('Invalid feedback content, skipping', 'warn', { type, platform, hasId: !!id });
        return null;
    }

    const key = feedbackKey(type, platform, id);
    try {
        const existing = await feedbackKV.get(key);
        if (existing) {
            return JSON.parse(existing);
        }

        const record = {
            id: String(id),
            platform,
            type,
            content,
            context,
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

// Set the vote (-1 down, 0 none, 1 up) on a recorded item. Returns the updated
// record, or null if the item does not exist.
async function recordVote({ type, platform, id, vote }) {
    if (!feedbackKV) {
        throw new Error('Feedback storage not initialized');
    }
    if (!VALID_TYPES.includes(type) || !platform || !id) {
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
        const { keys } = await feedbackKV.list({ prefix: FEEDBACK_PREFIX });
        const records = [];
        for (const key of keys) {
            const raw = await feedbackKV.get(key.name);
            if (!raw) {
                continue;
            }
            try {
                const record = JSON.parse(raw);
                if (!type || record.type === type) {
                    records.push(record);
                }
            } catch (parseError) {
                debug('Skipping unparseable feedback record', 'warn', { key: key.name });
            }
        }
        records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return records;
    } catch (error) {
        debug('Error listing feedback:', 'error', error);
        return [];
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

export { initFeedback, recordContent, recordVote, listFeedback, summarizeFeedback };
