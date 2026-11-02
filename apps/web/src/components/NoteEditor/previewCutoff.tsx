import { createBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { en } from '@blocknote/core/locales';
import { type DefaultReactSuggestionItem, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { Scissors } from 'lucide-react';
import { blockDeleteButton } from './blockDeleteButton';
import type { noteEditorSchema } from './checkListItem';
import { PREVIEW_CUTOFF_LABEL } from './previewCutoffLabel';

/**
 * BlockNote's divider, plus the prop that makes one the end of a note's card (ADR 0024).
 * The prop has no default, so an ordinary divider's stored form does not change.
 */
export const divider = createBlockSpec(
  {
    type: 'divider' as const,
    propSchema: { previewEnd: { default: undefined, type: 'boolean' as const } },
    content: 'none' as const,
  },
  {
    meta: { isolating: false },
    parse: (element) => (element.tagName === 'HR' ? {} : undefined),
    render(block, editor) {
      if (!block.props.previewEnd) return { dom: document.createElement('hr') };
      const dom = document.createElement('div');
      dom.className = 'note-preview-cutoff';
      const label = document.createElement('span');
      label.textContent = PREVIEW_CUTOFF_LABEL;
      const line = document.createElement('span');
      line.className = 'note-preview-cutoff-line';
      dom.append(label, line);
      if (this.renderType === 'nodeView' && editor.isEditable) {
        dom.append(blockDeleteButton(editor, block.id, 'Remove card preview cutoff'));
      }
      return { dom };
    },
    toExternalHTML: () => ({ dom: document.createElement('hr') }),
  },
  defaultBlockSpecs.divider.extensions,
)();

type Editor = typeof noteEditorSchema.BlockNoteEditor;

/** A note has one cutoff, so choosing it again moves it. */
function placePreviewCutoff(editor: Editor) {
  const earlier: string[] = [];
  editor.forEachBlock((block) => {
    if (block.type === 'divider' && block.props.previewEnd) earlier.push(block.id);
    return true;
  });
  editor.transact(() => {
    const cutoff = insertOrUpdateBlockForSlashMenu(editor, {
      type: 'divider',
      props: { previewEnd: true },
    });
    if (earlier.length) editor.removeBlocks(earlier);
    // The editor adds no trailing block, and nothing can be typed in a divider.
    if (!editor.getNextBlock(cutoff)) {
      const [paragraph] = editor.insertBlocks([{ type: 'paragraph' }], cutoff, 'after');
      if (paragraph) editor.setTextCursorPosition(paragraph);
    }
  });
}

/** BlockNote's slash menu with the cutoff beside the divider it is built on. */
export function slashMenuItems(editor: Editor): DefaultReactSuggestionItem[] {
  const items = getDefaultReactSlashMenuItems(editor);
  const divider = items.findIndex((item) => item.title === en.slash_menu.divider.title);
  items.splice(divider + 1, 0, {
    title: 'Preview cutoff',
    subtext: "Ends the note's card here. The full note still shows everything.",
    aliases: ['preview', 'cutoff', 'card', 'gallery', 'fold', 'more'],
    group: items[divider]?.group,
    icon: <Scissors size={18} />,
    onItemClick: () => placePreviewCutoff(editor),
  });
  return items;
}
