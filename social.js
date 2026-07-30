// Thin request helpers for the Mastodon and Bluesky APIs. Centralizes host and
// auth-header construction so callers don't repeat it; each returns the raw
// Response so callers keep their own error handling.
import fetch from 'node-fetch';
import { debug } from './log.js';

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


// GET the bot's mention notifications from Mastodon.
function getMastodonNotifications() {
    return fetch(mastodonUrl('/api/v1/notifications?types[]=mention'), {
        headers: { 'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}` }
    });
}

// GET the bot's notifications from Bluesky.
function listBlueskyNotifications(auth) {
    return fetch(blueskyUrl('/xrpc/app.bsky.notification.listNotifications'), {
        headers: {
            'Authorization': `Bearer ${auth.accessJwt}`,
            'Accept': 'application/json'
        }
    });
}

// Mark Bluesky notifications read up to `seenAt`.
function updateBlueskySeen(auth, seenAt) {
    return fetch(blueskyUrl('/xrpc/app.bsky.notification.updateSeen'), {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${auth.accessJwt}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ seenAt })
    });
}

// Cache a successful Bluesky session so we don't re-authenticate on every call
// within (and across) a short-lived invocation. TTL is kept well under the
// access token's ~2h lifetime; the cache is keyed by identifier so a credential
// change forces a fresh login.
let blueskyAuthCache = null;
let blueskyAuthExpiry = 0;
let blueskyAuthIdentifier = null;
const BLUESKY_AUTH_TTL_MS = 50 * 60 * 1000;

async function getBlueskyAuth() {
    try {
        const username = process.env.BLUESKY_USERNAME;
        const password = process.env.BLUESKY_PASSWORD;

        if (!username || !password) {
            debug('Missing Bluesky credentials', 'error');
            return null;
        }

        // Reuse a cached session while it is still fresh.
        if (blueskyAuthCache && blueskyAuthIdentifier === username && Date.now() < blueskyAuthExpiry) {
            debug('Reusing cached Bluesky session', 'info');
            return blueskyAuthCache;
        }

        debug('Authenticating with Bluesky using:', 'info', username);

        debug('Sending Bluesky auth request...', 'info');
        const response = await fetch(blueskyUrl('/xrpc/com.atproto.server.createSession'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                identifier: username,
                password: password
            })
        });

        debug('Auth response status:', 'info', {
            status: response.status,
            statusText: response.statusText
        });

        if (!response.ok) {
            // Surface Bluesky's error body (e.g. "Invalid identifier or password",
            // "AuthFactorTokenRequired") so credential problems are diagnosable.
            let body;
            try {
                body = await response.text();
            } catch (readError) {
                body = '<unreadable>';
            }
            debug('Bluesky auth failed', 'error', {
                status: response.status,
                statusText: response.statusText,
                identifier: username,
                body
            });
            return null;
        }

        const data = await response.json();
        
        debug('Successfully authenticated with Bluesky', 'info', {
            did: data.did,
            hasAccessJwt: !!data.accessJwt,
            hasRefreshJwt: !!data.refreshJwt
        });

        // Cache the successful session (only successes are cached).
        blueskyAuthCache = {
            did: data.did,
            accessJwt: data.accessJwt,
            refreshJwt: data.refreshJwt
        };
        blueskyAuthExpiry = Date.now() + BLUESKY_AUTH_TTL_MS;
        blueskyAuthIdentifier = username;
        return blueskyAuthCache;
    } catch (error) {
        debug('Error authenticating with Bluesky:', 'error', error);
        return null;
    }
}
export {
    postMastodonStatus,
    getMastodonStatus,
    createBlueskyRecord,
    getMastodonNotifications,
    listBlueskyNotifications,
    updateBlueskySeen,
    getBlueskyAuth
};
