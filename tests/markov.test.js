import { jest } from '@jest/globals';
import { MarkovChain } from '../bot.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('MarkovChain', () => {
    let sampleTweets;

    beforeAll(async () => {
        const tweetsPath = path.join(__dirname, '../assets/tweets.txt');
        const tweetsContent = await fs.readFile(tweetsPath, 'utf-8');
        sampleTweets = tweetsContent.split('\n').filter(line => line.trim());
    });

    let markov;

    beforeEach(() => {
        markov = new MarkovChain(2);
        markov.addData(sampleTweets);
    });

    describe('constructor', () => {
        test('initializes with default state size', () => {
            const defaultMarkov = new MarkovChain();
            expect(defaultMarkov.stateSize).toBe(2);
        });

        test('initializes with custom state size', () => {
            const customMarkov = new MarkovChain(3);
            expect(customMarkov.stateSize).toBe(3);
        });
    });

    describe('addData', () => {
        test('processes single text input', async () => {
            const text = 'the quick brown fox jumps over the lazy dog';
            await markov.addData([text]);
            expect(markov.startStates.length).toBeGreaterThan(0);
            expect(markov.chain.size).toBeGreaterThan(0);
        });

        test('processes multiple text inputs', async () => {
            const texts = [
                'the quick brown fox jumps over the lazy dog',
                'a quick brown cat sleeps under the warm sun'
            ];
            await markov.addData(texts);
            expect(markov.startStates.length).toBeGreaterThan(1);
            expect(markov.chain.size).toBeGreaterThan(0);
        });

        test('handles empty input gracefully', async () => {
            await expect(markov.addData([])).rejects.toThrow('No valid training data found');
        });

        test('handles invalid input types', async () => {
            await expect(markov.addData([null, undefined, '', ' '])).rejects.toThrow('No valid training data found');
        });
    });

    describe('generate', () => {
        test('generates text within length constraints', async () => {
            console.log('\nTesting text generation within constraints:');
            console.log('-'.repeat(50));

            const result = await markov.generate({
                minChars: 30,
                maxChars: 280,
                maxTries: 100
            });

            console.log('Generated:', result.string);
            console.log(`Length: ${result.string.length} characters`);
            console.log('-'.repeat(50));

            expect(result.string.length).toBeGreaterThanOrEqual(30);
            expect(result.string.length).toBeLessThanOrEqual(280);
        });

        test('handles impossible length constraints', async () => {
            await expect(markov.generate({
                minChars: 1000,
                maxChars: 2000,
                maxTries: 5
            })).rejects.toThrow('Failed to generate valid text within constraints');
        });

        test('handles no training data', async () => {
            const emptyMarkov = new MarkovChain();
            await expect(emptyMarkov.generate()).rejects.toThrow('No training data available');
        });

        test('generates different text on multiple calls', async () => {
            const markov = new MarkovChain(2);
            await markov.addData(sampleTweets);

            console.log('\nTesting text variation:');
            console.log('-'.repeat(50));

            // Generate multiple texts with more relaxed constraints
            const results = [];
            for (let i = 0; i < 3; i++) {
                try {
                    const result = await markov.generate({
                        minChars: 10,  // More lenient minimum length
                        maxChars: 280,
                        maxTries: 100
                    });
                    results.push(result);
                } catch (error) {
                    console.log(`Generation ${i + 1} failed:`, error.message);
                }
            }

            expect(results.length).toBeGreaterThan(0);

            results.forEach((result, i) => {
                console.log(`Generation ${i + 1}:`, result.string);
                console.log(`Length: ${result.string.length} characters`);
                console.log('-'.repeat(50));
            });

            const uniqueTexts = new Set(results.map(r => r.string));
            expect(uniqueTexts.size).toBeGreaterThan(1);
        });

        test('respects minimum length constraint', async () => {
            const result = await markov.generate({
                minChars: 50,
                maxChars: 280,
                maxTries: 100
            });
            expect(result.string.length).toBeGreaterThanOrEqual(50);
        });

        test('respects maximum length constraint', async () => {
            const result = await markov.generate({
                minChars: 30,
                maxChars: 100,
                maxTries: 100
            });
            expect(result.string.length).toBeLessThanOrEqual(100);
        });
    });
});
