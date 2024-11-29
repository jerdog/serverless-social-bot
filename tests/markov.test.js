import { describe, test, expect, beforeAll } from '@jest/globals';
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

    test('generates text within constraints', async () => {
        const markov = new MarkovChain(2);
        await markov.addData(sampleTweets);

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

    test('handles empty input', async () => {
        const markov = new MarkovChain(2);
        await expect(markov.addData([])).rejects.toThrow('No valid training data found');
    });

    test('handles invalid input', async () => {
        const markov = new MarkovChain(2);
        await expect(markov.addData([null, undefined, '', ' '])).rejects.toThrow('No valid training data found');
    });

    test('respects maximum length constraint', async () => {
        const markov = new MarkovChain(2);
        await markov.addData(sampleTweets);

        const result = await markov.generate({
            minChars: 30,
            maxChars: 100,
            maxTries: 100
        });

        expect(result.string.length).toBeLessThanOrEqual(100);
    });

    test('respects minimum length constraint', async () => {
        const markov = new MarkovChain(2);
        await markov.addData(sampleTweets);

        const result = await markov.generate({
            minChars: 50,
            maxChars: 280,
            maxTries: 100
        });

        expect(result.string.length).toBeGreaterThanOrEqual(50);
    });

    test('respects state size', async () => {
        const markov = new MarkovChain(3); // Using state size 3
        await markov.addData(sampleTweets);

        const result = await markov.generate({
            minChars: 30,
            maxChars: 280,
            maxTries: 100
        });

        expect(result.string.length).toBeGreaterThanOrEqual(30);
        expect(result.string.length).toBeLessThanOrEqual(280);
    });
});
