import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { MarkovChain, loadConfig } from '../bot.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MarkovChain', () => {
    let originalEnv;
    let markov;

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
        await loadConfig();
        markov = new MarkovChain(2);
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.resetModules();
    });

    test('should create instance with correct state size', () => {
        expect(markov.stateSize).toBe(2);
        expect(markov.chain).toBeInstanceOf(Map);
        expect(markov.startStates).toBeInstanceOf(Array);
    });

    test('should add data and generate text', async () => {
        const testData = [
            'This is a test tweet.',
            'Another test tweet.',
            'Testing tweet generation.'
        ];

        await markov.addData(testData);

        const generated = await markov.generate({
            minChars: 10,
            maxChars: 50,
            maxTries: 100
        });

        expect(generated).toBeDefined();
        expect(generated).toHaveProperty('string');
        expect(typeof generated.string).toBe('string');
        expect(generated.string.length).toBeGreaterThanOrEqual(10);
        expect(generated.string.length).toBeLessThanOrEqual(50);
    });

    test('should generate text within length constraints', async () => {
        const testData = [
            'This is a test tweet with some more words to work with.',
            'Another test tweet with additional content for better generation.',
            'A third test tweet to provide more context and vocabulary.',
            'Adding more sample text to improve generation quality.',
            'The more varied content we have, the better the output will be.',
            'Including different sentence structures helps create natural text.',
            'Using more words and phrases improves the generation quality.',
            'Final test sentence with good length and natural patterns.'
        ];

        await markov.addData(testData);

        const options = {
            minChars: 30,
            maxChars: 100,
            maxTries: 100
        };

        const generated = await markov.generate(options);
        expect(generated.string.length).toBeGreaterThanOrEqual(options.minChars);
        expect(generated.string.length).toBeLessThanOrEqual(options.maxChars);
    });

    test('should throw error when no valid text can be generated', async () => {
        const testData = [
            'This is a test tweet with some more words to work with.',
            'Another test tweet with additional content for better generation.',
            'A third test tweet to provide more context and vocabulary.',
            'Adding more sample text to improve generation quality.',
            'The more varied content we have, the better the output will be.',
            'Including different sentence structures helps create natural text.',
            'Using more words and phrases improves the generation quality.',
            'Final test sentence with good length and natural patterns.'
        ];
        await markov.addData(testData);

        const options = {
            minChars: 1000,  
            maxChars: 1500,
            maxTries: 10
        };

        await expect(markov.generate(options)).rejects.toThrow(
            `Failed to generate text between ${options.minChars} and ${options.maxChars} characters after ${options.maxTries} attempts`
        );
    });

    test('should generate valid text from test data', async () => {
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

        console.log('\nLoaded', testTweets.length, 'tweets for testing');

        await markov.addData(testTweets);

        console.log('\nGenerated text:');
        console.log('-'.repeat(50));
        const generated = await markov.generate({
            minChars: 30,
            maxChars: 280,
            maxTries: 100
        });
        console.log(generated.string);
        console.log('-'.repeat(50));
        console.log(`Length: ${generated.string.length} characters\n`);

        expect(generated).toBeDefined();
        expect(generated).toHaveProperty('string');
        expect(typeof generated.string).toBe('string');
        expect(generated.string.length).toBeGreaterThanOrEqual(30);
        expect(generated.string.length).toBeLessThanOrEqual(280);
    });
});
