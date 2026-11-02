import type { BlockNoteEditor } from '@blocknote/core';
import { closeHistory } from '@tiptap/pm/history';

/** Always-visible removal for a block, since touch screens have no hover to reveal one. */
export function blockDeleteButton(
  // biome-ignore lint/suspicious/noExplicitAny: only `transact`, `getBlock` and `removeBlocks` are used
  editor: BlockNoteEditor<any, any, any>,
  blockId: string,
  label: string,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'note-checklist-delete';
  button.contentEditable = 'false';
  button.setAttribute('aria-label', label);
  button.title = label;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M18 6 6 18M6 6l12 12');
  icon.append(path);
  button.append(icon);
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!editor.isEditable || !editor.getBlock(blockId)) return;
    editor.transact((tr) => {
      closeHistory(tr);
      editor.removeBlocks([blockId]);
    });
    editor.transact((tr) => closeHistory(tr));
    editor.focus();
  });
  return button;
}
