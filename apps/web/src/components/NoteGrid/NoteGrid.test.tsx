import { describe, expect, it } from 'vitest';
import { estimateCardHeight } from './NoteGrid';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('estimateCardHeight', () => {
  it('grows with the text a card wraps and the blocks it shows', () => {
    const short = estimateCardHeight([paragraph('Milk')], 220, false);
    const long = estimateCardHeight([paragraph('word '.repeat(80))], 220, false);
    const narrow = estimateCardHeight([paragraph('word '.repeat(80))], 160, false);
    const many = estimateCardHeight(
      Array.from({ length: 30 }, () => paragraph('Milk')),
      220,
      false,
    );
    expect(long).toBeGreaterThan(short);
    expect(narrow).toBeGreaterThan(long);
    expect(many).toBe(
      estimateCardHeight(
        Array.from({ length: 10 }, () => paragraph('Milk')),
        220,
        false,
      ),
    );
  });

  it('leaves room for the actions only where they show', () => {
    const content = [paragraph('Milk')];
    expect(estimateCardHeight(content, 220, true)).toBeGreaterThan(
      estimateCardHeight(content, 220, false),
    );
  });
});
