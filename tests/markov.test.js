import { jest } from '@jest/globals';
import { MarkovChain } from '../bot.js';

describe('MarkovChain', () => {
  let markov;

  beforeEach(() => {
    markov = new MarkovChain(2);
  });

  test('should create instance with correct state size', () => {
    expect(markov.stateSize).toBe(2);
    expect(markov.chain).toBeInstanceOf(Map);
    expect(markov.startStates).toBeInstanceOf(Array);
  });

  test('should add data and generate text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. ' +
                'A quick brown dog jumps over the lazy fox. ' +
                'The lazy fox sleeps while the quick brown dog watches.';
    markov.addData([text]);
    
    const generated = markov.generate({
      maxTries: 100,
      minChars: 5,
      maxChars: 100
    });

    expect(generated).toHaveProperty('string');
    expect(typeof generated.string).toBe('string');
    expect(generated.string.length).toBeGreaterThan(0);
    expect(generated.string.length).toBeLessThanOrEqual(100);
    expect(generated.string.length).toBeGreaterThanOrEqual(5);
  });

  test('should generate text within length constraints', () => {
    const text = 'The quick brown fox jumps over the lazy dog. ' +
                'A quick brown dog jumps over the lazy fox. ' +
                'The lazy fox sleeps while the quick brown dog watches. ' +
                'The brown dog chases the quick fox through the garden.';
    markov.addData([text]);

    const options = {
      maxTries: 100,
      minChars: 10,
      maxChars: 50
    };

    const generated = markov.generate(options);
    expect(generated).toHaveProperty('string');
    expect(generated.string.length).toBeGreaterThanOrEqual(options.minChars);
    expect(generated.string.length).toBeLessThanOrEqual(options.maxChars);
  });

  test('should throw error when no valid text can be generated', () => {
    const text = 'too short';
    markov.addData([text]);

    const options = {
      maxTries: 5,
      minChars: 100,
      maxChars: 200
    };

    expect(() => markov.generate(options)).toThrow(
      `Failed to generate text between ${options.minChars} and ${options.maxChars} characters after ${options.maxTries} attempts`
    );
  });
});
