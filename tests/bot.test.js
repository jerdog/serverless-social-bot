import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { generatePost, loadConfig, cleanText } from '../bot.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Test environment configuration
const TEST_ENV = {
    DEBUG_MODE: 'true',
    DEBUG_LEVEL: 'verbose',
    MARKOV_STATE_SIZE: '2',
    MARKOV_MIN_CHARS: '30',
    MARKOV_MAX_CHARS: '280',
    MARKOV_MAX_TRIES: '100',
    MASTODON_API_URL: 'https://mastodon.social',
    MASTODON_ACCESS_TOKEN: 'test_token',
    MASTODON_SOURCE_ACCOUNTS: 'account1,account2',
    BLUESKY_API_URL: 'https://bsky.social',
    BLUESKY_USERNAME: 'test.user',
    BLUESKY_PASSWORD: 'test_password',
    BLUESKY_SOURCE_ACCOUNTS: 'account3,account4',
    EXCLUDED_WORDS: ''
};

describe('Bot', () => {
    let envBackup;
    let sampleTweets;

    beforeAll(async () => {
        // Backup original environment
        envBackup = { ...process.env };
        
        // Set up test environment
        Object.assign(process.env, TEST_ENV);

        // Load sample tweets from assets
        try {
            const __dirname = path.dirname(fileURLToPath(import.meta.url));
            const tweetsPath = path.join(__dirname, '../assets/source-tweets.txt');
            const tweetsContent = await fs.readFile(tweetsPath, 'utf-8');
            sampleTweets = tweetsContent.split('\n').filter(line => line.trim());
        } catch (error) {
            console.log('No sample tweets file found, using fallback data');
            sampleTweets = [];
        }
    });

    afterEach(() => {
        // Restore original environment after each test
        process.env = { ...envBackup };
    });

    describe('loadConfig', () => {
        test('loads configuration from environment variables', async () => {
            const config = await loadConfig();
            expect(config).toBeTruthy();
            expect(config.markovStateSize).toBe(2);
            expect(config.markovMinChars).toBe(30);
            expect(config.markovMaxChars).toBe(280);
            expect(config.markovMaxTries).toBe(100);
            expect(config.mastodonSourceAccounts).toEqual(['account1', 'account2']);
            expect(config.blueskySourceAccounts).toEqual(['account3', 'account4']);
        });

        test('uses default values for optional parameters', async () => {
            const testEnv = { ...TEST_ENV };
            delete testEnv.MARKOV_STATE_SIZE;
            delete testEnv.MARKOV_MIN_CHARS;
            delete testEnv.MARKOV_MAX_CHARS;
            delete testEnv.MARKOV_MAX_TRIES;
            Object.assign(process.env, testEnv);

            const config = await loadConfig();
            expect(config).toBeTruthy();
            expect(config.markovStateSize).toBe(2); // default value
            expect(config.markovMinChars).toBe(30); // default value
            expect(config.markovMaxChars).toBe(280); // default value
            expect(config.markovMaxTries).toBe(100); // default value
        });

        test('throws error when required variables are missing', async () => {
            process.env = {}; // Clear all environment variables
            await expect(loadConfig()).rejects.toThrow('Missing required environment variables');
        });
    });

    describe('cleanText', () => {
        beforeEach(async () => {
            Object.assign(process.env, TEST_ENV);
            await loadConfig();
        });

        test('strips URLs from text', async () => {
            const testCases = [
                {
                    input: 'Check out this link https://example.com',
                    expected: 'Check out this link'
                },
                {
                    input: 'Visit www.example.com for more',
                    expected: 'Visit for more'
                },
                {
                    input: 'Multiple links https://test.com and http://example.org here',
                    expected: 'Multiple links and here'
                }
            ];

            for (const { input, expected } of testCases) {
                const result = cleanText(input);
                expect(result.trim()).toBe(expected.trim());
            }
        });

        test('strips mentions from text', async () => {
            const testCases = [
                {
                    input: '@username hello world',
                    expected: 'hello world'
                },
                {
                    input: 'hello @user.name world',
                    expected: 'hello world'
                },
                {
                    input: '.@username starting with dot',
                    expected: 'starting with dot'
                }
            ];

            for (const { input, expected } of testCases) {
                const result = cleanText(input);
                expect(result.trim()).toBe(expected.trim());
            }
        });

        test('handles invalid input gracefully', async () => {
            const testCases = [
                { input: null, expected: '' },
                { input: undefined, expected: '' },
                { input: '', expected: '' },
                { input: '   ', expected: '' }
            ];

            for (const { input, expected } of testCases) {
                const result = cleanText(input);
                expect(result.trim()).toBe(expected);
            }
        });
    });

    describe('generatePost', () => {
        beforeEach(async () => {
            Object.assign(process.env, TEST_ENV);
            await loadConfig();
        });

        test('generates text within constraints', async () => {
            console.log('\nTesting text generation within constraints:');
            console.log('--------------------------------------------------');

            // Use sample tweets for generation if available
            const testContent = sampleTweets?.length > 0 ? 
                sampleTweets : [
                    'Mentioning @users and sharing https://links.com makes it realistic',
                    'Including different sentence structures helps create natural text',
                    'A third test tweet with https://example.com and additional text for context',
                    'Using hashtags #testing #quality improves the authenticity'
                ];

            const result = await generatePost(testContent);
            expect(result).toBeTruthy();
            if (result) {
                console.log(`Generated: ${result.string}`);
                console.log(`Length: ${result.string.length} characters`);
                console.log('--------------------------------------------------');
                expect(result.string.length).toBeGreaterThanOrEqual(30);
                expect(result.string.length).toBeLessThanOrEqual(280);
            }
        });

        test('generates different text each time', async () => {
            console.log('\nTesting text variation:');
            console.log('--------------------------------------------------');

            // Use sample tweets for generation if available
            const testContent = sampleTweets?.length > 0 ? 
                sampleTweets : [
                    'Testing multiple elements @user #topic https://test.com with expanded vocabulary',
                    'Using hashtags #testing #quality improves the authenticity',
                    'A third test tweet with @mention and more words to work with'
                ];

            const generations = [];
            for (let i = 0; i < 3; i++) {
                const result = await generatePost(testContent);
                if (result) {
                    generations.push(result.string);
                    console.log(`Generation ${i + 1}: ${result.string}`);
                    console.log(`Length: ${result.string.length} characters`);
                    console.log('--------------------------------------------------');
                }
            }

            // Check that we have unique generations
            const uniqueGenerations = new Set(generations);
            expect(uniqueGenerations.size).toBeGreaterThan(1);
        });
    });
});
