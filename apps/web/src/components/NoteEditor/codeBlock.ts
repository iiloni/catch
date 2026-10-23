import { createCodeBlockSpec, SyntaxHighlightingExtension } from '@blocknote/core';
import { toast } from 'sonner';
import {
  CODE_LANGUAGES,
  codeLanguageFileName,
  codeLanguageIcon,
  codeLanguageId,
  codeLanguageName,
} from '@/lib/codeLanguages';
import { codeSnippetText, downloadCodeSnippet } from '@/lib/codeSnippet';
import { haptics } from '@/lib/haptics';

// An empty language is unlabelled; `text` is an explicit choice that survives reloads.
const base = createCodeBlockSpec({ defaultLanguage: '', supportedLanguages: CODE_LANGUAGES });
// Without a language list BlockNote renders the code alone, leaving the picker to us.
const plain = createCodeBlockSpec({ defaultLanguage: '' });

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
      const rendered = plain.implementation.render.call(this, block, editor);
      if (this.renderType !== 'nodeView') return rendered;
      const language = String(block.props.language);
      const id = codeLanguageId(language);

      // The list itself is React's: the editor opens it for the block this button is in.
      const button = document.createElement('button');
      button.type = 'button';
      const name = codeLanguageName(language);
      button.setAttribute('aria-label', `Code language: ${name}`);
      if (editor.isEditable) button.setAttribute('aria-haspopup', 'dialog');
      button.dataset.language = id ?? language;
      const icon = document.createElement('span');
      icon.className = 'code-language-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.maskImage = `url("${codeLanguageIcon(language)}")`;
      const label = document.createElement('span');
      label.className = 'truncate';
      label.textContent = name;
      button.append(icon, label);
      button.title = `Code language: ${name}`;

      const picker = document.createElement('div');
      picker.className = 'note-code-language';
      picker.contentEditable = 'false';
      picker.append(button);

      const toolbar = document.createElement('div');
      toolbar.className = 'note-code-toolbar glass';
      toolbar.contentEditable = 'false';
      toolbar.append(picker);
      let revealOnClick = false;
      button.addEventListener('pointerdown', (event) => {
        // Touch can focus the button before click, so remember its state before focus
        // expands the pill. The first tap reveals tools; the next opens the picker.
        revealOnClick =
          !window.matchMedia('(hover: hover)').matches && !toolbar.hasAttribute('data-expanded');
        event.preventDefault();
      });

      const copy = actionButton('Copy snippet', 'M9 5H5v16h12v-4M9 3h12v14H9z');
      const download = actionButton('Download snippet', 'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5');
      download.title = `Download ${codeLanguageFileName(language)}`;
      let copiedTimer: ReturnType<typeof setTimeout> | undefined;
      copy.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = editor.getBlock(block.id);
        if (current?.type !== 'codeBlock') return;
        void (async () => {
          try {
            await navigator.clipboard.writeText(codeSnippetText(current.content));
            haptics.success();
            toast('Snippet copied');
            copy.setAttribute('aria-label', 'Snippet copied');
            copy.title = 'Snippet copied';
            clearTimeout(copiedTimer);
            copiedTimer = setTimeout(() => {
              copy.setAttribute('aria-label', 'Copy snippet');
              copy.title = 'Copy snippet';
            }, 2000);
          } catch {
            toast('Could not copy the snippet');
          }
        })();
      });
      download.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = editor.getBlock(block.id);
        if (current?.type !== 'codeBlock') return;
        download.disabled = true;
        void downloadCodeSnippet(codeSnippetText(current.content), current.props.language)
          .catch(() => toast('Could not download the snippet'))
          .finally(() => {
            download.disabled = false;
          });
      });
      toolbar.append(copy, download);
      rendered.dom.prepend(toolbar);
      let pinned = false;
      const expand = (open: boolean) => toolbar.toggleAttribute('data-expanded', open);
      toolbar.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') expand(true);
      });
      toolbar.addEventListener('pointerleave', () => {
        if (!pinned && !toolbar.matches(':focus-within')) expand(false);
      });
      toolbar.addEventListener('focusin', () => expand(true));
      toolbar.addEventListener('focusout', (event) => {
        if (event.relatedTarget instanceof Node && toolbar.contains(event.relatedTarget)) return;
        pinned = false;
        expand(false);
      });
      button.addEventListener('click', (event) => {
        if (revealOnClick && event.detail > 0) {
          pinned = true;
          expand(true);
          haptics.toggle();
          event.stopPropagation();
        } else if (!editor.isEditable) event.stopPropagation();
        revealOnClick = false;
      });
      const outside = (event: PointerEvent) => {
        if (event.target instanceof Node && toolbar.contains(event.target)) return;
        pinned = false;
        expand(false);
      };
      toolbar.addEventListener('keydown', (event) => {
        // Tab belongs to the controls here, not the code block's indent shortcut.
        event.stopPropagation();
        if (event.key !== 'Escape' || !toolbar.hasAttribute('data-expanded')) return;
        pinned = false;
        expand(false);
        editor.focus();
      });
      document.addEventListener('pointerdown', outside);
      const frame = requestAnimationFrame(() => {
        const width = Array.from(toolbar.children).reduce(
          (sum, child) => sum + child.getBoundingClientRect().width,
          2,
        );
        toolbar.style.setProperty('--code-pill-width', `${width}px`);
      });
      return {
        ...rendered,
        // Pill state is editor chrome, not a change to the document. Letting ProseMirror
        // reparse it would replace the node view on every animation or feedback change.
        ignoreMutation: (mutation) =>
          toolbar.contains(mutation.target) || (rendered.ignoreMutation?.(mutation) ?? false),
        destroy() {
          clearTimeout(copiedTimer);
          cancelAnimationFrame(frame);
          document.removeEventListener('pointerdown', outside);
          rendered.destroy?.();
        },
      };
    },
  },
};

function actionButton(name: string, path: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'note-code-action';
  button.setAttribute('aria-label', name);
  button.title = name;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  icon.append(line);
  button.append(icon);
  // Acting on the source must not move its caret or dismiss the phone's keyboard.
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  return button;
}

// Loaded when a note first shows code in a language, so the editor opens without it.
export const syntaxHighlighting = SyntaxHighlightingExtension({
  createHighlighter: () =>
    import('./codeHighlighter').then((module) => module.createCodeHighlighter()),
});
