// Thin request helpers for the Mastodon and Bluesky APIs. Centralizes host and
// auth-header construction so callers don't repeat it; each returns the raw
// Response so callers keep their own error handling.
import fetch from 'node-fetch';

function mastodonUrl(path) {
    return `${process.env.MASTODON_API_URL}${path}`;
}

function blueskyUrl(path) {
    return `${process.env.BLUESKY_API_URL || 'https://bsky.social'}${path}`;
}

// POST a new status (or reply) to Mastodon.
function postMastodonStatus(payload) {
    return fetch(mastodonUrl('/api/v1/statuses'), {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}

// GET a single Mastodon status by id.
function getMastodonStatus(id) {
    return fetch(mastodonUrl(`/api/v1/statuses/${id}`), {
        headers: { 'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}` }
    });
}

// Create an app.bsky.feed.post record on Bluesky. `record` is the post value.
function createBlueskyRecord(auth, record) {
    return fetch(blueskyUrl('/xrpc/com.atproto.repo.createRecord'), {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${auth.accessJwt}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            repo: auth.did,
            collection: 'app.bsky.feed.post',
            record
        })
    });
}

export { postMastodonStatus, getMastodonStatus, createBlueskyRecord };
