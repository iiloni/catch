import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { blockDeleteButton } from './blockDeleteButton';
import { codeBlock } from './codeBlock';
import { divider } from './previewCutoff';

const checklist = defaultBlockSpecs.checkListItem;

// Keep BlockNote's schema, shortcuts and HTML export; only its editor view gains a control.
const checkListItem: typeof checklist = {
  ...checklist,
  implementation: {
    ...checklist.implementation,
    render(block, editor) {
      const rendered = checklist.implementation.render.call(this, block, editor);
      if (this.renderType !== 'nodeView' || !editor.isEditable) return rendered;
      const button = blockDeleteButton(editor, block.id, 'Delete checklist item');
      rendered.dom.appendChild(button);
      return rendered;
    },
  },
};

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, checkListItem, codeBlock, divider },
});
