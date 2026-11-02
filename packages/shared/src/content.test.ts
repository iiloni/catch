import { describe, expect, it } from 'vitest';
import { blocksHaveContent, cardBlocks, withoutPreviewCutoff } from './content';

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

describe('cardBlocks', () => {
  const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });
  const cutoff = { type: 'divider', props: { previewEnd: true } };
  const names = (blocks: Record<string, unknown>[]) =>
    blocks.map((block) => (block.content as { text: string }[])[0]?.text);

  it('limits a note with no cutoff and skips its empty blocks', () => {
    const blocks = [
      { type: 'paragraph', content: [] },
      ...Array.from({ length: 12 }, (_, index) => paragraph(String(index))),
    ];
    const { shown, more } = cardBlocks(blocks);
    expect(shown).toHaveLength(10);
    expect(shown[0]).toEqual(paragraph('0'));
    expect(more).toBe(true);
  });

  it('ends at the cutoff, past the usual limit', () => {
    const blocks = Array.from({ length: 12 }, (_, index) => paragraph(String(index)));
    const { shown, more } = cardBlocks([...blocks, cutoff, paragraph('hidden')]);
    expect(shown).toHaveLength(12);
    expect(more).toBe(true);
  });

  it('claims no more when only empty blocks follow the cutoff', () => {
    expect(
      cardBlocks([paragraph('a'), cutoff, { type: 'paragraph', content: [] }, { type: 'divider' }])
        .more,
    ).toBe(false);
  });

  it('counts media after the cutoff as more only when it has a file', () => {
    const image = (url: string) => ({ type: 'image', props: { url } });
    expect(cardBlocks([paragraph('a'), cutoff, image('attachment:photo')]).more).toBe(true);
    expect(cardBlocks([paragraph('a'), cutoff, image('')]).more).toBe(false);
  });

  it('ignores a cutoff with nothing above it, so the card is not blank', () => {
    const { shown, more } = cardBlocks([
      { type: 'paragraph', content: [] },
      cutoff,
      paragraph('kept'),
    ]);
    expect(names(shown)).toEqual(['kept']);
    expect(more).toBe(false);
  });

  it('ignores a cutoff with only blank text above it', () => {
    const { shown } = cardBlocks([paragraph('   '), cutoff, paragraph('kept')]);
    expect(names(shown)).toEqual(['   ', 'kept']);
  });

  it('leaves an ordinary divider alone', () => {
    const { shown } = cardBlocks([paragraph('a'), { type: 'divider', props: {} }, paragraph('b')]);
    expect(names(shown)).toEqual(['a', 'b']);
  });

  it('uses the first of several cutoffs', () => {
    const { shown } = cardBlocks([paragraph('a'), cutoff, paragraph('b'), cutoff, paragraph('c')]);
    expect(names(shown)).toEqual(['a']);
  });

  it('honors a nested cutoff in reading order', () => {
    const parent = {
      ...paragraph('parent'),
      children: [paragraph('child'), cutoff, paragraph('hidden child')],
    };
    const { shown, more } = cardBlocks([paragraph('first'), parent, paragraph('hidden')]);
    expect(names(shown)).toEqual(['first', 'parent']);
    expect(shown[1]?.children).toEqual([paragraph('child')]);
    expect(more).toBe(true);
  });
});

describe('withoutPreviewCutoff', () => {
  it('removes the marker at any depth and keeps ordinary dividers', () => {
    const cutoff = { type: 'divider', props: { previewEnd: true } };
    const divider = { type: 'divider', props: {} };
    const parent = { type: 'paragraph', content: [text('a')], children: [cutoff, divider] };
    expect(withoutPreviewCutoff([cutoff, parent])).toEqual([{ ...parent, children: [divider] }]);
  });
});
