import { describe, expect, it } from 'vitest';
import { sharedNoteContent } from './shareContent';

const text = (text: string) => ({ type: 'text', text, styles: {} });

describe('shared note content', () => {
  it('makes a title and paragraphs, preserving blank lines and linking URLs', () => {
    expect(
      sharedNoteContent({ title: ' Trip ', text: 'Pack\r\n\r\nhttps://example.com', url: '' }),
    ).toEqual([
      { type: 'heading', props: { level: 3 }, content: [text('Trip')] },
      { type: 'paragraph', content: [text('Pack')] },
      { type: 'paragraph', content: [] },
      {
        type: 'paragraph',
        content: [
          { type: 'link', href: 'https://example.com', content: [text('https://example.com')] },
        ],
      },
    ]);
  });
  it('does not repeat a URL already supplied in the text or title', () => {
    expect(
      sharedNoteContent({ title: '', text: 'https://example.com', url: 'https://example.com/' }),
    ).toHaveLength(1);
    expect(
      sharedNoteContent({ title: 'https://example.com', text: '', url: 'https://example.com' }),
    ).toHaveLength(1);
  });
  it('handles a URL alone and avoids a duplicate title', () => {
    expect(sharedNoteContent({ title: '', text: '', url: 'https://example.com' })).toHaveLength(1);
    expect(sharedNoteContent({ title: 'Hello', text: 'Hello', url: '' })).toEqual([
      { type: 'paragraph', content: [text('Hello')] },
    ]);
  });
  it('keeps HTML as literal text and supports file-only notes', () => {
    expect(sharedNoteContent({ title: '', text: '<script>alert(1)</script>', url: '' })).toEqual([
      { type: 'paragraph', content: [text('<script>alert(1)</script>')] },
    ]);
    expect(sharedNoteContent({ title: '', text: '', url: '' })).toEqual([]);
  });
});
