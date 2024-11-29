import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { generatePost, loadConfig, cleanText } from '../bot.js';
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
        // Load sample tweets from assets
        try {
            const tweetsPath = path.join(__dirname, '../assets/source-tweets.txt');
            const tweetsContent = await fs.readFile(tweetsPath, 'utf-8');
            sampleTweets = tweetsContent.split('\n').filter(line => line.trim());
        } catch (error) {
            console.warn('Warning: source-tweets.txt not found or empty, using empty array');
            sampleTweets = [];
        }
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
            
            // Test Mastodon configuration
            expect(config.mastodon).toEqual({
                url: 'https://mastodon.social',
                token: 'test_token'
            });

            // Test Bluesky configuration
            expect(config.bluesky).toEqual({
                service: 'https://bsky.social',
                identifier: 'test.user',
                password: 'test_password'
            });

            // Test Markov chain parameters
            expect(config.markovStateSize).toBe(2);
            expect(config.markovMinChars).toBe(30);
            expect(config.markovMaxChars).toBe(280);
            expect(config.markovMaxTries).toBe(100);

            // Test source accounts
            expect(config.mastodonSourceAccounts).toEqual(['account1', 'account2']);
            expect(config.blueskySourceAccounts).toEqual(['account3', 'account4']);
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
            
            // Test default values
            expect(config.markovStateSize).toBe(2);
            expect(config.markovMinChars).toBe(30);
            expect(config.markovMaxChars).toBe(280);
            expect(config.markovMaxTries).toBe(100);
            expect(config.mastodonSourceAccounts).toEqual(['Mastodon.social']);
            expect(config.blueskySourceAccounts).toEqual(['bsky.social']);
            expect(config.excludedWords).toEqual([]);
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
    });

    describe('cleanText', () => {
        test('strips URLs from text', async () => {
            const testCases = [
                {
                    input: 'Check out this link https://example.com',
                    expected: 'Check out this link'
                },
                {
                    input: 'Visit www.example.com for more info',
                    expected: 'Visit for more info'
                },
                {
                    input: 'Multiple links: http://site1.com and https://site2.com/path?param=value',
                    expected: 'Multiple links and'
                },
                {
                    input: 'Complex URL https://sub.domain.example.co.uk/path/to/page?param=value#section',
                    expected: 'Complex URL'
                },
                {
                    input: 'Bare domain example.com/path with content',
                    expected: 'Bare domain with content'
                },
                {
                    input: 'URL with special chars http://example.com/~user/file(1).html',
                    expected: 'URL with special chars'
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
                    input: 'Hey @username check this out',
                    expected: 'Hey check this out'
                },
                {
                    input: '@user1 @user2 @user3 multiple mentions',
                    expected: 'multiple mentions'
                },
                {
                    input: 'Complex @user.name with dots',
                    expected: 'Complex with dots'
                },
                {
                    input: 'RT @original_user: Great content here',
                    expected: 'Great content here'
                },
                {
                    input: '.@username starting with dot',
                    expected: 'starting with dot'
                },
                {
                    input: 'RT @user1: @user2 @user3 chain of mentions',
                    expected: 'chain of mentions'
                },
                {
                    input: '@user_name with underscore',
                    expected: 'with underscore'
                },
                {
                    input: '@user123 with numbers',
                    expected: 'with numbers'
                },
                {
                    input: '@user1: Content with colon',
                    expected: 'Content with colon'
                },
                {
                    input: 'RT @user1 @user2: Content with multiple mentions',
                    expected: 'Content with multiple mentions'
                }
            ];

            for (const { input, expected } of testCases) {
                const result = cleanText(input);
                expect(result.trim()).toBe(expected.trim());
            }
        });

        test('handles invalid input gracefully', async () => {
            expect(cleanText(null)).toBe('');
            expect(cleanText(undefined)).toBe('');
            expect(cleanText('')).toBe('');
            expect(cleanText(' ')).toBe('');
        });
    });

    describe('generatePost', () => {
        beforeEach(async () => {
            // Set up test environment for generatePost tests
            process.env = {
                DEBUG_MODE: 'true',
                DEBUG_LEVEL: 'verbose',
                MARKOV_STATE_SIZE: '2',
                MARKOV_MAX_TRIES: '100',
                MARKOV_MIN_CHARS: '30',
                MARKOV_MAX_CHARS: '280'
            };
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
