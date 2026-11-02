import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { describe, expect, it } from 'vitest';
import { noteEditorSchema } from './checkListItem';

const CONTENT = [
  { type: 'paragraph', content: 'Above' },
  { type: 'divider', props: { previewEnd: true } },
  { type: 'divider', props: {} },
  { type: 'paragraph', content: 'Below' },
];

describe('the preview cutoff block', () => {
  it('keeps the marker and leaves an ordinary divider unchanged', () => {
    const editor = BlockNoteEditor.create({
      schema: noteEditorSchema,
      initialContent: CONTENT as PartialBlock[],
    });
    const [, cutoff, divider] = editor.document;
    expect(cutoff).toMatchObject({ type: 'divider', props: { previewEnd: true } });
    expect(divider?.props).toEqual({});
  });

  // A client that predates the marker has BlockNote's own divider. It must open the note.
  it('loads as a plain divider in a schema without it', () => {
    const editor = BlockNoteEditor.create({ initialContent: CONTENT as PartialBlock[] });
    expect(editor.document.map((block) => block.type)).toEqual([
      'paragraph',
      'divider',
      'divider',
      'paragraph',
    ]);
  });
});
