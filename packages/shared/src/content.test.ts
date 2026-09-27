import { describe, expect, it } from 'vitest';
import { blocksHaveContent } from './content';

const text = (value: string) => ({ type: 'text', text: value, styles: {} });

describe('blocksHaveContent', () => {
  it('treats missing and empty documents as empty', () => {
    expect(blocksHaveContent(undefined)).toBe(false);
    expect(blocksHaveContent([])).toBe(false);
  });

  it('ignores whitespace-only text', () => {
    expect(
      blocksHaveContent([
        { type: 'heading', content: [text('  ')] },
        { type: 'paragraph', content: [] },
      ]),
    ).toBe(false);
  });

  it('counts text, links, and nested children', () => {
    expect(blocksHaveContent([{ type: 'paragraph', content: [text('hi')] }])).toBe(true);
    expect(
      blocksHaveContent([
        { type: 'paragraph', content: [{ type: 'link', href: 'https://x.y', content: [] }] },
      ]),
    ).toBe(true);
    expect(
      blocksHaveContent([
        { type: 'paragraph', content: [], children: [{ type: 'paragraph', content: [text('x')] }] },
      ]),
    ).toBe(true);
  });

  it('counts media only when it has a URL', () => {
    expect(blocksHaveContent([{ type: 'image', props: { url: '' } }])).toBe(false);
    expect(blocksHaveContent([{ type: 'image', props: { url: 'https://x.y/a.png' } }])).toBe(true);
  });
});
