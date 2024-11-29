import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { generatePost, loadConfig } from '../bot.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Load test environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.test') });

describe('Bot', () => {
    let envBackup;
    let sampleTweets;

    beforeAll(async () => {
        const tweetsPath = path.join(__dirname, '../assets/tweets.txt');
        const tweetsContent = await fs.readFile(tweetsPath, 'utf-8');
        sampleTweets = tweetsContent.split('\n').filter(line => line.trim());
    });

    beforeEach(() => {
        envBackup = { ...process.env };
    });

    afterEach(() => {
        process.env = envBackup;
    });

    describe('loadConfig', () => {
        test('loads configuration from environment variables', async () => {
            // Set up test environment
            process.env = {
                DEBUG_MODE: 'true',
                MASTODON_API_URL: 'https://mastodon.social',
                MASTODON_ACCESS_TOKEN: 'test_token',
                BLUESKY_API_URL: 'https://bsky.social',
                BLUESKY_USERNAME: 'test.user',
                BLUESKY_PASSWORD: 'test_password',
                MARKOV_STATE_SIZE: '2',
                MARKOV_MIN_CHARS: '30',
                MARKOV_MAX_CHARS: '280',
                MARKOV_MAX_TRIES: '100',
                MASTODON_SOURCE_ACCOUNTS: 'account1,account2',
                BLUESKY_SOURCE_ACCOUNTS: 'account3,account4'
            };

            const config = await loadConfig();
            
            expect(config).toHaveProperty('mastodon.url', 'https://mastodon.social');
            expect(config).toHaveProperty('mastodon.token', 'test_token');
            expect(config).toHaveProperty('bluesky.service', 'https://bsky.social');
            expect(config).toHaveProperty('bluesky.identifier', 'test.user');
            expect(config).toHaveProperty('bluesky.password', 'test_password');
            expect(config).toHaveProperty('markovStateSize', 2);
            expect(config).toHaveProperty('markovMinChars', 30);
            expect(config).toHaveProperty('markovMaxChars', 280);
            expect(config).toHaveProperty('markovMaxTries', 100);
            expect(config.mastodonSourceAccounts).toEqual(['account1', 'account2']);
            expect(config.blueskySourceAccounts).toEqual(['account3', 'account4']);
        });

        test('throws error when required variables are missing', async () => {
            // Set up test environment with missing required variable
            process.env = {
                DEBUG_MODE: 'true',
                MASTODON_ACCESS_TOKEN: 'test_token',
                BLUESKY_API_URL: 'https://bsky.social',
                BLUESKY_USERNAME: 'test.user',
                BLUESKY_PASSWORD: 'test_password'
            };

            await expect(loadConfig()).rejects.toThrow('Missing required environment variables: MASTODON_API_URL');
        });

        test('uses default values for optional parameters', async () => {
            // Set up test environment with only required variables
            process.env = {
                DEBUG_MODE: 'true',
                MASTODON_API_URL: 'https://mastodon.social',
                MASTODON_ACCESS_TOKEN: 'test_token',
                BLUESKY_API_URL: 'https://bsky.social',
                BLUESKY_USERNAME: 'test.user',
                BLUESKY_PASSWORD: 'test_password'
            };

            const config = await loadConfig();
            expect(config.markovStateSize).toBe(2);
            expect(config.markovMinChars).toBe(30);
            expect(config.markovMaxChars).toBe(280);
            expect(config.markovMaxTries).toBe(100);
            expect(config.mastodonSourceAccounts).toEqual(['Mastodon.social']);
            expect(config.blueskySourceAccounts).toEqual(['bsky.social']);
        });
    });

    describe('generatePost', () => {
        beforeEach(async () => {
            // Set up test environment for generatePost tests
            process.env = {
                DEBUG_MODE: 'true',
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
        });

        test('generates valid post from content array', async () => {
            console.log('\nTesting post generation:');
            console.log('-'.repeat(50));
            
            const result = await generatePost(sampleTweets);
            
            console.log('Generated post:', result.string);
            console.log(`Length: ${result.string.length} characters`);
            console.log('-'.repeat(50));

            expect(result).toHaveProperty('string');
            expect(typeof result.string).toBe('string');
            expect(result.string.length).toBeGreaterThanOrEqual(30);
            expect(result.string.length).toBeLessThanOrEqual(280);
        });

        test('handles empty content array', async () => {
            await expect(generatePost([])).rejects.toThrow('Content array is empty');
        });

        test('handles invalid content', async () => {
            await expect(generatePost([null, undefined, '', ' '])).rejects.toThrow('Content array is empty');
        });

        test('generates different posts on multiple calls', async () => {
            console.log('\nTesting post variation:');
            console.log('-'.repeat(50));

            const results = await Promise.all([
                generatePost(sampleTweets),
                generatePost(sampleTweets),
                generatePost(sampleTweets)
            ]);

            results.forEach((result, i) => {
                console.log(`Post ${i + 1}:`, result.string);
                console.log(`Length: ${result.string.length} characters`);
                console.log('-'.repeat(50));
            });

            const uniqueTexts = new Set(results.map(r => r.string));
            expect(uniqueTexts.size).toBeGreaterThan(1);
        });
    });
});
