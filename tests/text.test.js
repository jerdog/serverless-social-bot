import { describe, test, expect } from '@jest/globals';
import { stripHtml, stripMentions, normalizeWhitespace } from '../text.js';

describe('text helpers', () => {
    test('stripHtml removes tags', () => {
        expect(stripHtml('<p>hi <b>there</b></p>')).toBe('hi there');
    });

    test('stripMentions removes @handles', () => {
        expect(stripMentions('hello @user and @two')).toBe('hello  and ');
    });

    test('normalizeWhitespace collapses runs and trims', () => {
        expect(normalizeWhitespace('  a   b\n c  ')).toBe('a b c');
    });

    test('composed cleaning matches the previous inline pipeline', () => {
        const input = '<p>Hey @bob,   check   this</p>';
        const composed = normalizeWhitespace(stripMentions(stripHtml(input)));
        const inline = input
            .replace(/<[^>]*>/g, '')
            .replace(/@[\w]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        expect(composed).toBe(inline);
        expect(composed).toBe('Hey , check this');
    });
});
