import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { debug, generatePost, loadConfig } from '../bot.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Bot Utilities', () => {
    let consoleLogSpy;
    let consoleErrorSpy;
    let originalEnv;
    let originalConsoleLog;

    beforeEach(async () => {
        originalEnv = process.env;
        process.env = {
            ...originalEnv,
            MASTODON_API_URL: 'https://mastodon.social',
            MASTODON_ACCESS_TOKEN: 'test_token',
            BLUESKY_API_URL: 'https://bsky.social',
            BLUESKY_USERNAME: 'test.user',
            BLUESKY_PASSWORD: 'test_password',
            MARKOV_STATE_SIZE: '2',
            MARKOV_MIN_CHARS: '30',
            MARKOV_MAX_CHARS: '280',
            MARKOV_MAX_TRIES: '100'
        };
        originalConsoleLog = console.log;
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await loadConfig();
    });

    afterEach(() => {
        process.env = originalEnv;
        console.log = originalConsoleLog;
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        jest.resetModules();
    });

    describe('debug', () => {
        test('should log message with verbose level when debug mode is enabled', () => {
            process.env.DEBUG_MODE = 'true';
            debug('test message', 'verbose');
            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0];
            expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[VERBOSE\] test message/);
        });

        test('should not log verbose message when debug mode is disabled', () => {
            process.env.DEBUG_MODE = 'false';
            debug('test message', 'verbose');
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        test('should log info message regardless of debug mode', () => {
            process.env.DEBUG_MODE = 'false';
            debug('info message', 'info');
            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0];
            expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] {2}info message/);
        });

        test('should log error message with ERROR prefix', () => {
            debug('error message', 'error');
            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0];
            expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\] error message/);
        });

        test('should log additional data when provided', () => {
            const data = { key: 'value' };
            debug('message with data', 'info', data);
            expect(consoleLogSpy).toHaveBeenCalledTimes(2);
            expect(consoleLogSpy.mock.calls[1][0]).toBe(data);
        });
    });

    describe('generatePost', () => {
        test('generatePost should generate valid post from test data', async () => {
            console.log('\nGenerating test post...');
            console.log('-'.repeat(50));

            const testTweets = [
                'This is a test tweet with #hashtag and some interesting content',
                'Another test tweet with @mention and more words to work with',
                'A third test tweet with https://example.com and additional text for context',
                'Testing multiple elements @user #topic https://test.com with expanded vocabulary',
                'Adding more sample tweets to improve Markov chain generation quality',
                'The more varied content we have, the better the output will be',
                'Including different sentence structures helps create natural text',
                'Using hashtags #testing #quality improves the authenticity',
                'Mentioning @users and sharing https://links.com makes it realistic',
                'Final test tweet with good length and natural language patterns'
            ];

            const post = await generatePost(testTweets);

            console.log('\nGenerated post:');
            console.log('-'.repeat(50));
            console.log(post.string);
            console.log('-'.repeat(50));
            console.log(`Length: ${post.string.length} characters\n`);

            expect(post).toHaveProperty('string');
            expect(typeof post.string).toBe('string');
            expect(post.string.length).toBeGreaterThanOrEqual(30);
            expect(post.string.length).toBeLessThanOrEqual(280);
        });
    });
});
