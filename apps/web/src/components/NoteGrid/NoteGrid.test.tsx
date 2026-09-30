import { describe, expect, it } from 'vitest';
import { columnsFor, estimateCardHeight } from './NoteGrid';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('columnsFor', () => {
  it('uses two columns on phones and more as space allows', () => {
    expect(columnsFor(260)).toBe(1);
    expect(columnsFor(366)).toBe(2);
    expect(columnsFor(768)).toBe(3);
    expect(columnsFor(1232)).toBe(5);
  });
});

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
