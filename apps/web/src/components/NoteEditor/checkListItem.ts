import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { closeHistory } from '@tiptap/pm/history';

const checklist = defaultBlockSpecs.checkListItem;

// Keep BlockNote's schema, shortcuts and HTML export; only its editor view gains a control.
const checkListItem: typeof checklist = {
  ...checklist,
  implementation: {
    ...checklist.implementation,
    render(block, editor) {
      const rendered = checklist.implementation.render.call(this, block, editor);
      if (this.renderType !== 'nodeView' || !editor.isEditable) return rendered;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-checklist-delete';
      button.contentEditable = 'false';
      button.setAttribute('aria-label', 'Delete checklist item');
      button.title = 'Delete checklist item';
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
        if (!editor.isEditable || !editor.getBlock(block.id)) return;
        editor.transact((tr) => {
          closeHistory(tr);
          editor.removeBlocks([block.id]);
        });
        editor.transact((tr) => closeHistory(tr));
        editor.focus();
      });
      rendered.dom.appendChild(button);
      return rendered;
    },
  },
};

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, checkListItem },
});
