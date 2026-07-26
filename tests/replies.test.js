import { describe, test, expect, beforeAll } from '@jest/globals';
import { generateReply, initAI, initializeKV, loadRecentPostsFromKV, getOriginalPost } from '../replies.js';
import { LocalStorage } from '../kv.js';

describe('generateReply (Workers AI)', () => {
    beforeAll(() => {
        // Silence info/warn logging during tests.
        process.env.DEBUG_LEVEL = 'error';
    });

    test('returns the model reply text', async () => {
        initAI({ run: async () => ({ response: 'Nice thought!' }) });
        const reply = await generateReply('Original post', 'A user reply');
        expect(reply).toBe('Nice thought!');
    });

    test('reads OpenAI-style chat completions (Gemma 4 shape)', async () => {
        // Gemma 4 on Workers AI returns { choices: [{ message: { content } }] }
        // rather than { response }; both must work.
        initAI({
            run: async () => ({
                object: 'chat.completion',
                choices: [{ message: { role: 'assistant', content: 'Witty comeback!' }, finish_reason: 'stop' }],
                usage: { completion_tokens: 12 }
            })
        });
        expect(await generateReply('orig', 'reply')).toBe('Witty comeback!');
    });

    test('strips <think> blocks from thinking-mode output', async () => {
        initAI({ run: async () => ({ choices: [{ message: { content: '<think>Let me consider tone...</think>Sharp and short.' } }] }) });
        expect(await generateReply('orig', 'reply')).toBe('Sharp and short.');
    });

    test('reads a legacy choices[].text completion shape', async () => {
        initAI({ run: async () => ({ choices: [{ text: '  spaced out  ' }] }) });
        expect(await generateReply('orig', 'reply')).toBe('spaced out');
    });

    test('returns null when the model returns no usable content', async () => {
        initAI({ run: async () => ({ choices: [{ message: { content: null } }] }) });
        expect(await generateReply('orig', 'reply')).toBeNull();
    });

    test('passes the default model and efficient params to the binding', async () => {
        let captured;
        initAI({
            run: async (model, opts) => {
                captured = { model, opts };
                return { response: 'ok' };
            }
        });
        await generateReply('orig', 'reply');
        expect(captured.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
        expect(captured.opts.max_tokens).toBe(200);
        expect(captured.opts.temperature).toBeCloseTo(0.7);
        expect(Array.isArray(captured.opts.messages)).toBe(true);
        expect(captured.opts.messages[0].role).toBe('system');
    });

    test('strips mentions and wrapping quotes from the output', async () => {
        initAI({ run: async () => ({ response: '"@someone hello there"' }) });
        const reply = await generateReply('orig', 'reply');
        expect(reply).toBe('hello there');
    });

    test('returns null when required content is missing', async () => {
        initAI({ run: async () => ({ response: 'x' }) });
        expect(await generateReply('', 'reply')).toBeNull();
        expect(await generateReply('orig', '')).toBeNull();
    });

    test('returns null when the AI binding is not initialized', async () => {
        initAI(null);
        expect(await generateReply('orig', 'reply')).toBeNull();
    });

    test('falls back and backs off when the model call fails', async () => {
        let calls = 0;
        initAI({
            run: async () => {
                calls++;
                throw new Error('capacity');
            }
        });
        const first = await generateReply('orig', 'reply');
        expect(typeof first).toBe('string');
        expect(first.length).toBeGreaterThan(0);
        expect(calls).toBe(1);

        // Second call stays within the backoff window: no model call, still a fallback.
        const second = await generateReply('orig', 'reply');
        expect(typeof second).toBe('string');
        expect(calls).toBe(1);
    });
});

describe('loadRecentPostsFromKV', () => {
    test('preserves AT URIs (which contain colons) as cache keys', async () => {
        process.env.DEBUG_LEVEL = 'error';
        const kv = new LocalStorage();
        const uri = 'at://did:plc:abc123/app.bsky.feed.post/3mrk4rk5u7e24';
        await kv.put(`post:bluesky:${uri}`, JSON.stringify({ content: 'hello', timestamp: Date.now() }));
        await kv.put('post:mastodon:12345', JSON.stringify({ content: 'toot', timestamp: Date.now() }));

        await initializeKV(kv);
        await loadRecentPostsFromKV();

        // A naive split(':') would have stored this as "bluesky:at".
        expect(await getOriginalPost('bluesky', uri)).toBe('hello');
        expect(await getOriginalPost('mastodon', '12345')).toBe('toot');
    });
});
