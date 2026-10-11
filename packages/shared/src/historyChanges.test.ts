import { describe, expect, it } from 'vitest';
import type { HistoryState } from './history';
import { REVIEW_DELETED, REVIEW_INSERTED, reviewHistory } from './historyChanges';

const state = (content: HistoryState['content']): HistoryState => ({ content, files: [] });
const text = (value: string, styles = {}) => ({ type: 'text', text: value, styles });
const paragraph = (id: string, ...content: unknown[]) => ({ id, type: 'paragraph', content });
/** A changed block's words as `[-removed-]`, `{+added+}` and plain text. */
const reading = (block: Record<string, unknown>) =>
  (block.content as { text: string; styles: Record<string, unknown> }[])
    .map((run) =>
      run.styles[REVIEW_DELETED]
        ? `[-${run.text}-]`
        : run.styles[REVIEW_INSERTED]
          ? `{+${run.text}+}`
          : run.text,
    )
    .join('');

describe('history review', () => {
  it('does not call unchanged blocks moved after an insertion', () => {
    const a = paragraph('a', text('a')),
      b = paragraph('b', text('b'));
    const review = reviewHistory(state([a, b]), state([paragraph('new', text('new')), a, b]));
    expect(review.changes).toBe(1);
    expect(review.items.map((item) => [item.status, item.moved])).toEqual([
      ['added', false],
      ['same', false],
      ['same', false],
    ]);
  });
  it('marks the words a block gained and lost and keeps the rest', () => {
    const review = reviewHistory(
      state([paragraph('a', text('Buy milk and '), text('two', { bold: true }), text(' eggs'))]),
      state([
        paragraph('a', text('Buy oat milk and '), text('six', { bold: true }), text(' eggs')),
      ]),
    );
    expect(review.changes).toBe(1);
    expect(review.items[0]?.status).toBe('changed');
    expect(reading(review.items[0]!.block)).toBe('Buy {+oat +}milk and [-two-]{+six+} eggs');
    const runs = review.items[0]!.block.content as { text: string; styles: object }[];
    expect(runs.find((run) => run.text === 'six')?.styles).toEqual({
      bold: true,
      [REVIEW_INSERTED]: true,
    });
  });
  it('rewrites a phrase as one removal and one addition', () => {
    const review = reviewHistory(
      state([paragraph('a', text('Call the old plumber today'))]),
      state([paragraph('a', text('Call a new electrician today'))]),
    );
    expect(reading(review.items[0]!.block)).toBe(
      'Call [-the old plumber-]{+a new electrician+} today',
    );
  });
  it('keeps link targets around changed words', () => {
    const link = (value: string) => ({
      type: 'link',
      href: 'https://example.com',
      content: [text(value)],
    });
    const review = reviewHistory(
      state([paragraph('a', text('See '), link('the docs'))]),
      state([paragraph('a', text('See '), link('the new docs'))]),
    );
    const content = review.items[0]!.block.content as Record<string, unknown>[];
    expect(content).toHaveLength(2);
    expect(content[1]).toMatchObject({ type: 'link', href: 'https://example.com' });
    expect(reading({ content: content[1]!.content })).toBe('the {+new +}docs');
  });
  it('pairs blocks typed again under new ids by what they say', () => {
    const review = reviewHistory(
      state([
        paragraph('a', text('Trip plan')),
        paragraph('b', text('Book the old hotel by Friday')),
        paragraph('c', text('Buy milk')),
      ]),
      state([
        paragraph('x', text('Trip plan')),
        paragraph('y', text('Book the new hotel by Monday')),
        paragraph('z', text('Rent a car')),
      ]),
    );
    expect(review.items.map((item) => item.status)).toEqual([
      'same',
      'changed',
      'removed',
      'added',
    ]);
    expect(reading(review.items[1]!.block)).toBe(
      'Book the [-old-]{+new+} hotel by [-Friday-]{+Monday+}',
    );
    expect(review.changes).toBe(3);
  });
  it('does not call a block changed for props only the editor writes out', () => {
    const imported = { id: 'a', type: 'heading', content: [{ type: 'text', text: 'Title' }] };
    const edited = {
      id: 'a',
      type: 'heading',
      props: { level: 1, textAlignment: 'left' },
      content: [text('Title', { bold: false })],
      children: [],
    };
    expect(reviewHistory(state([imported]), state([edited])).changes).toBe(0);
    const bold = { ...edited, content: [text('Title', { bold: true })] };
    expect(reviewHistory(state([imported]), state([bold])).items[0]?.detail).toBe('formatting');
  });
  it('leaves a removed block where it was and reports nested changes', () => {
    const review = reviewHistory(
      state([
        paragraph('a', text('first')),
        paragraph('gone', text('second')),
        { ...paragraph('c', text('third')), children: [paragraph('child', text('inner'))] },
      ]),
      state([
        paragraph('a', text('first')),
        { ...paragraph('c', text('third')), children: [paragraph('child', text('inner text'))] },
      ]),
    );
    expect(review.items.map((item) => item.status)).toEqual(['same', 'removed', 'same']);
    expect(review.items[2]?.children[0]?.status).toBe('changed');
    expect(review.changes).toBe(2);
  });
  it('names changes that leave the words alone, and shows tables and reorders', () => {
    const blocks = [
      {
        id: 'a',
        type: 'checkListItem',
        props: { checked: false },
        content: [text('same')],
        future: 1,
      },
      { id: 'b', type: 'table', content: { rows: [{ cells: ['same'] }] } },
    ];
    const changed: HistoryState['content'] = structuredClone(blocks);
    changed[0]!.props = { checked: true };
    const review = reviewHistory(state(blocks), state(changed));
    expect(review.changes).toBe(1);
    expect(review.items[0]).toMatchObject({ status: 'changed', detail: 'checked' });

    const bold = structuredClone(blocks);
    bold[0]!.content = [text('same', { bold: true })];
    expect(reviewHistory(state(blocks), state(bold)).items[0]?.detail).toBe('formatting');

    const table = structuredClone(blocks);
    table[1]!.content = { rows: [{ cells: ['other'] }] };
    expect(reviewHistory(state(blocks), state(table)).items.map((item) => item.status)).toEqual([
      'same',
      'removed',
      'added',
    ]);
    expect(
      reviewHistory(state(blocks), state([...blocks].reverse())).items.some((item) => item.moved),
    ).toBe(true);
  });
});
