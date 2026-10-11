import { describe, expect, it } from 'vitest';
import { historyReading } from './historyReading';

const text = (value: string, styles = {}) => ({ type: 'text', text: value, styles });

describe('how a version reads', () => {
  it('is the same whatever the ids, defaults, switched-off styles and split of the text', () => {
    const imported = [{ type: 'heading', content: 'A title' }, { type: 'paragraph' }];
    const edited = [
      {
        id: 'a',
        type: 'heading',
        props: { level: 1, textAlignment: 'left', textColor: 'default' },
        content: [text('A ', { bold: false }), text('title', { textColor: 'default' })],
        children: [],
      },
      { id: 'b', type: 'paragraph', props: { backgroundColor: 'default' }, content: [] },
    ];
    expect(historyReading(edited)).toBe(historyReading(imported));
  });
  it('differs with the words, their formatting, a link, the kind of block and its place', () => {
    const base = [{ type: 'paragraph', content: [text('Buy milk')] }];
    const others = [
      [{ type: 'paragraph', content: [text('Buy oat milk')] }],
      [{ type: 'paragraph', content: [text('Buy '), text('milk', { bold: true })] }],
      [{ type: 'paragraph', content: [{ type: 'link', href: '/a', content: [text('Buy milk')] }] }],
      [{ type: 'heading', content: [text('Buy milk')] }],
      [{ type: 'heading', props: { level: 2 }, content: [text('Buy milk')] }],
      [{ type: 'checkListItem', props: { checked: true }, content: [text('Buy milk')] }],
      [{ type: 'paragraph', children: [{ type: 'paragraph', content: [text('Buy milk')] }] }],
      [...base, { type: 'paragraph', content: [text('More')] }],
    ];
    const readings = new Set([base, ...others].map(historyReading));
    expect(readings.size).toBe(others.length + 1);
  });
  it('keeps what it does not know how to read as it is', () => {
    const table = (cell: string) => [
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text(cell)]] }] } },
    ];
    expect(historyReading(table('a'))).not.toBe(historyReading(table('b')));
    expect(historyReading(table('a'))).toBe(historyReading(table('a')));
  });
});
