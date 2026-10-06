import { createCodeBlockSpec, SyntaxHighlightingExtension } from '@blocknote/core';
import { CODE_LANGUAGES, codeLanguageId } from '@/lib/codeLanguages';

const base = createCodeBlockSpec({ defaultLanguage: 'text', supportedLanguages: CODE_LANGUAGES });
// Without a language list BlockNote renders the code alone, leaving the picker to us.
const plain = createCodeBlockSpec({ defaultLanguage: 'text' });

// Keep BlockNote's schema, shortcuts and HTML export. Its own picker only shows on hover and
// throws for a language outside the list, which pasted and imported code can name.
export const codeBlock: typeof base = {
  ...base,
  implementation: {
    ...base.implementation,
    meta: {
      ...base.implementation.meta,
      highlight: (block) => codeLanguageId(block.props.language) ?? block.props.language,
    },
    render(block, editor) {
      const language = String(block.props.language);
      const id = codeLanguageId(language);

      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Code language');
      for (const [value, { name }] of Object.entries(CODE_LANGUAGES)) {
        select.add(new Option(name, value));
      }
      if (!id) select.add(new Option(language, language));
      select.value = id ?? language;
      select.disabled = !editor.isEditable;

      function setLanguage() {
        if (!editor.isEditable || !editor.getBlock(block.id)) return;
        editor.updateBlock(block.id, { props: { language: select.value } });
        // Opening the picker took focus from the code.
        editor.setTextCursorPosition(block.id, 'end');
        editor.focus();
      }
      select.addEventListener('change', setLanguage);

      const picker = document.createElement('div');
      picker.className = 'note-code-language';
      picker.contentEditable = 'false';
      picker.append(select);

      const rendered = plain.implementation.render.call(this, block, editor);
      rendered.dom.prepend(picker);
      return {
        ...rendered,
        destroy() {
          select.removeEventListener('change', setLanguage);
          rendered.destroy?.();
        },
      };
    },
  },
};

// Loaded when a note first shows code in a language, so the editor opens without it.
export const syntaxHighlighting = SyntaxHighlightingExtension({
  createHighlighter: () =>
    import('./codeHighlighter').then((module) => module.createCodeHighlighter()),
});
