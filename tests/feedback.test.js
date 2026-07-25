import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { initFeedback, recordContent, recordVote, listFeedback, clearFeedback, summarizeFeedback } from '../feedback.js';
import { LocalStorage } from '../kv.js';

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

    test('recordContent creates a post record with a neutral vote and platforms list', async () => {
        const rec = await recordContent({ type: 'post', platform: 'bluesky', id: 'abc', content: 'hello world' });
        expect(rec).toBeTruthy();
        expect(rec.vote).toBe(0);
        expect(rec.type).toBe('post');
        expect(rec.content).toBe('hello world');
        expect(rec.platforms).toEqual(['bluesky']);
    });

    test('posts are deduped by content across platforms', async () => {
        const a = await recordContent({ type: 'post', platform: 'mastodon', id: 'm1', content: 'same text', model: 'markov' });
        const b = await recordContent({ type: 'post', platform: 'bluesky', id: 'b1', content: 'same text', model: 'markov' });
        expect(b.id).toBe(a.id);                       // same content hash
        expect(b.platforms).toEqual(['mastodon', 'bluesky']);

        const posts = await listFeedback({ type: 'post' });
        expect(posts).toHaveLength(1);                 // one card, not two
        expect(posts[0].platforms).toEqual(['mastodon', 'bluesky']);
    });

    test('recordContent stores the model label', async () => {
        const rec = await recordContent({
            type: 'reply', platform: 'bluesky', id: 'm1', content: 'hi',
            model: '@cf/google/gemma-4-26b-a4b-it'
        });
        expect(rec.model).toBe('@cf/google/gemma-4-26b-a4b-it');
        const [listed] = await listFeedback({ type: 'reply' });
        expect(listed.model).toBe('@cf/google/gemma-4-26b-a4b-it');
    });

    test('recordContent rejects invalid input', async () => {
        expect(await recordContent({ type: 'bogus', platform: 'x', id: '1', content: 'y' })).toBeNull();
        expect(await recordContent({ type: 'post', platform: '', id: '1', content: 'y' })).toBeNull();
        expect(await recordContent({ type: 'post', platform: 'x', id: '1', content: '' })).toBeNull();
        expect(await recordContent({ type: 'reply', platform: 'x', content: 'y' })).toBeNull(); // reply needs id
    });

    test('recordContent is idempotent and preserves an existing vote', async () => {
        await recordContent({ type: 'reply', platform: 'mastodon', id: '7', content: 'first' });
        await recordVote({ type: 'reply', platform: 'mastodon', id: '7', vote: 1 });
        const again = await recordContent({ type: 'reply', platform: 'mastodon', id: '7', content: 'first' });
        expect(again.vote).toBe(1);
    });

    test('recordVote sets the vote by post id (content hash)', async () => {
        const rec = await recordContent({ type: 'post', platform: 'bluesky', id: 'v', content: 'vote me' });
        const up = await recordVote({ type: 'post', id: rec.id, vote: 1 });
        expect(up.vote).toBe(1);
        const down = await recordVote({ type: 'post', id: rec.id, vote: -1 });
        expect(down.vote).toBe(-1);
    });

    test('recordVote returns null for unknown items', async () => {
        expect(await recordVote({ type: 'post', id: 'missing', vote: 1 })).toBeNull();
    });

    test('recordVote rejects invalid vote values', async () => {
        const rec = await recordContent({ type: 'post', platform: 'bluesky', id: 'q', content: 'x' });
        await expect(recordVote({ type: 'post', id: rec.id, vote: 5 })).rejects.toThrow();
    });

    test('listFeedback sorts newest first and filters by type', async () => {
        await kv.put('feedback:post:oldhash', JSON.stringify({
            id: 'oldhash', type: 'post', platforms: ['bluesky'], content: 'o',
            createdAt: '2020-01-01T00:00:00.000Z', vote: 0
        }));
        await kv.put('feedback:reply:mastodon:new', JSON.stringify({
            id: 'new', type: 'reply', platforms: ['mastodon'], content: 'n',
            createdAt: '2024-01-01T00:00:00.000Z', vote: 1
        }));

        const all = await listFeedback();
        expect(all.map(r => r.id)).toEqual(['new', 'oldhash']);

        const replies = await listFeedback({ type: 'reply' });
        expect(replies).toHaveLength(1);
        expect(replies[0].id).toBe('new');
    });

    test('clearFeedback removes all records', async () => {
        await recordContent({ type: 'post', platform: 'mastodon', id: 'a', content: 'one' });
        await recordContent({ type: 'reply', platform: 'bluesky', id: 'b', content: 'two' });
        const removed = await clearFeedback();
        expect(removed).toBe(2);
        expect(await listFeedback()).toEqual([]);
    });

    test('summarizeFeedback tallies votes', () => {
        const stats = summarizeFeedback([{ vote: 1 }, { vote: 1 }, { vote: -1 }, { vote: 0 }]);
        expect(stats).toEqual({ total: 4, up: 2, down: 1, unrated: 1 });
    });
});
