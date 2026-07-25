import { describe, test, expect, beforeAll } from '@jest/globals';
import { generateReply, initAI } from '../replies.js';

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

    test('passes the default model and efficient params to the binding', async () => {
        let captured;
        initAI({
            run: async (model, opts) => {
                captured = { model, opts };
                return { response: 'ok' };
            }
        });
        await generateReply('orig', 'reply');
        expect(captured.model).toBe('@cf/google/gemma-4-26b-a4b-it');
        expect(captured.opts.max_tokens).toBe(120);
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
