import { describe, expect, it } from 'vitest';
import { blocksToPlainText } from './plainText';

describe('blocksToPlainText', () => {
  it('flattens headings, links and nested children', () => {
    const text = blocksToPlainText([
      { type: 'heading', content: [{ type: 'text', text: 'Groceries', styles: {} }] },
      {
        type: 'checkListItem',
        content: [{ type: 'text', text: 'Milk', styles: {} }],
        children: [{ type: 'paragraph', content: [{ type: 'text', text: 'Oat', styles: {} }] }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ', styles: {} },
          { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'shop' }] },
        ],
      },
    ]);
    expect(text).toBe('Groceries\nMilk\nOat\nSee shop');
  });

  it('reads table cells', () => {
    const text = blocksToPlainText([
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]] }],
        },
      },
    ]);
    expect(text).toBe('a b');
  });

  it('skips empty blocks', () => {
    expect(blocksToPlainText([{ type: 'paragraph', content: [] }, { type: 'image' }])).toBe('');
  });
});
