import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { initFeedback, recordContent, recordVote, listFeedback, summarizeFeedback } from '../feedback.js';
import { LocalStorage } from '../replies.js';

describe('feedback', () => {
    let kv;

    beforeAll(() => {
        // Silence info/warn logging during tests.
        process.env.DEBUG_LEVEL = 'error';
    });

    beforeEach(() => {
        kv = new LocalStorage();
        initFeedback(kv);
    });

    test('recordContent creates a record with a neutral vote', async () => {
        const rec = await recordContent({ type: 'post', platform: 'bluesky', id: 'abc', content: 'hello world' });
        expect(rec).toBeTruthy();
        expect(rec.vote).toBe(0);
        expect(rec.type).toBe('post');
        expect(rec.content).toBe('hello world');
    });

    test('recordContent rejects invalid input', async () => {
        expect(await recordContent({ type: 'bogus', platform: 'x', id: '1', content: 'y' })).toBeNull();
        expect(await recordContent({ type: 'post', platform: '', id: '1', content: 'y' })).toBeNull();
        expect(await recordContent({ type: 'post', platform: 'x', id: '1', content: '' })).toBeNull();
    });

    test('recordContent is idempotent and preserves an existing vote', async () => {
        await recordContent({ type: 'reply', platform: 'mastodon', id: '7', content: 'first' });
        await recordVote({ type: 'reply', platform: 'mastodon', id: '7', vote: 1 });
        const again = await recordContent({ type: 'reply', platform: 'mastodon', id: '7', content: 'first' });
        expect(again.vote).toBe(1);
    });

    test('recordVote sets the vote and returns the record', async () => {
        await recordContent({ type: 'post', platform: 'bluesky', id: 'v', content: 'x' });
        const up = await recordVote({ type: 'post', platform: 'bluesky', id: 'v', vote: 1 });
        expect(up.vote).toBe(1);
        const down = await recordVote({ type: 'post', platform: 'bluesky', id: 'v', vote: -1 });
        expect(down.vote).toBe(-1);
    });

    test('recordVote returns null for unknown items', async () => {
        expect(await recordVote({ type: 'post', platform: 'bluesky', id: 'missing', vote: 1 })).toBeNull();
    });

    test('recordVote rejects invalid vote values', async () => {
        await recordContent({ type: 'post', platform: 'bluesky', id: 'q', content: 'x' });
        await expect(recordVote({ type: 'post', platform: 'bluesky', id: 'q', vote: 5 })).rejects.toThrow();
    });

    test('listFeedback sorts newest first and filters by type', async () => {
        await kv.put('feedback:post:bluesky:old', JSON.stringify({
            id: 'old', type: 'post', platform: 'bluesky', content: 'o',
            createdAt: '2020-01-01T00:00:00.000Z', vote: 0
        }));
        await kv.put('feedback:reply:mastodon:new', JSON.stringify({
            id: 'new', type: 'reply', platform: 'mastodon', content: 'n',
            createdAt: '2024-01-01T00:00:00.000Z', vote: 1
        }));

        const all = await listFeedback();
        expect(all.map(r => r.id)).toEqual(['new', 'old']);

        const replies = await listFeedback({ type: 'reply' });
        expect(replies).toHaveLength(1);
        expect(replies[0].id).toBe('new');
    });

    test('summarizeFeedback tallies votes', () => {
        const stats = summarizeFeedback([{ vote: 1 }, { vote: 1 }, { vote: -1 }, { vote: 0 }]);
        expect(stats).toEqual({ total: 4, up: 2, down: 1, unrated: 1 });
    });
});
