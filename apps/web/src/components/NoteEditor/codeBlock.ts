import { createCodeBlockSpec, SyntaxHighlightingExtension } from '@blocknote/core';
import { CODE_LANGUAGES, codeLanguageId, codeLanguageName } from '@/lib/codeLanguages';

const base = createCodeBlockSpec({ defaultLanguage: 'text', supportedLanguages: CODE_LANGUAGES });
// Without a language list BlockNote renders the code alone, leaving the picker to us.
const plain = createCodeBlockSpec({ defaultLanguage: 'text' });

// Keep BlockNote's schema, shortcuts and HTML export. Its own picker only shows on hover and
// throws for a language outside the list, which pasted and imported code can name. It is
// also a native menu, too long to pick from without a search.
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

      // The list itself is React's: the editor opens it for the block this button is in.
      const button = document.createElement('button');
      button.type = 'button';
      const name = codeLanguageName(language);
      button.setAttribute('aria-label', `Code language: ${name}`);
      button.setAttribute('aria-haspopup', 'dialog');
      button.dataset.language = id ?? language;
      button.textContent = name;
      button.disabled = !editor.isEditable;

      const picker = document.createElement('div');
      picker.className = 'note-code-language';
      picker.contentEditable = 'false';
      picker.append(button);

      const rendered = plain.implementation.render.call(this, block, editor);
      rendered.dom.prepend(picker);
      return rendered;
    },
  },
};

// Loaded when a note first shows code in a language, so the editor opens without it.
export const syntaxHighlighting = SyntaxHighlightingExtension({
  createHighlighter: () =>
    import('./codeHighlighter').then((module) => module.createCodeHighlighter()),
});
