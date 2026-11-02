import type { BlockNoteEditor, BlockNoteEditorOptions } from '@blocknote/core';
import { toast } from 'sonner';
import { codeLanguageId } from '@/lib/codeLanguages';
import { codeSnippetText, normalizeCodeIndentation } from '@/lib/codeSnippet';
import type { noteEditorSchema } from './checkListItem';

export type CodeEditor = BlockNoteEditor<
  typeof noteEditorSchema.blockSchema,
  typeof noteEditorSchema.inlineContentSchema,
  typeof noteEditorSchema.styleSchema
>;
type PasteContext = Parameters<
  NonNullable<
    BlockNoteEditorOptions<
      typeof noteEditorSchema.blockSchema,
      typeof noteEditorSchema.inlineContentSchema,
      typeof noteEditorSchema.styleSchema
    >['pasteHandler']
  >
>[0];

const requests = new WeakMap<CodeEditor, Map<string, object>>();

/** A choice made while the detector loads always wins, including Plain text. */
export function cancelCodeDetection(editor: CodeEditor, id: string) {
  requests.get(editor)?.delete(id);
}

export async function detectBlockLanguage(editor: CodeEditor, id: string, manual = false) {
  const block = editor.getBlock(id);
  if (!editor.isEditable || block?.type !== 'codeBlock') return;
  const source = codeSnippetText(block.content);
  const language = block.props.language;
  const pending = requests.get(editor) ?? new Map<string, object>();
  requests.set(editor, pending);
  const request = {};
  pending.set(id, request);
  try {
    const { detectCodeLanguage } = await import('@/lib/detectCodeLanguage');
    const detected = detectCodeLanguage(source);
    const current = editor.getBlock(id);
    if (
      pending.get(id) !== request ||
      !editor.domElement?.isConnected ||
      !editor.isEditable ||
      current?.type !== 'codeBlock' ||
      current.props.language !== language ||
      codeSnippetText(current.content) !== source
    )
      return;
    if (detected) editor.updateBlock(id, { props: { language: detected } });
    else if (manual) toast('Could not confidently detect a language. Choose one from the list.');
  } catch {
    if (manual) toast('Could not detect the code language. Choose one from the list.');
  } finally {
    if (pending.get(id) === request) pending.delete(id);
  }
}

export function pasteCode({ event, editor, defaultPasteHandler }: PasteContext) {
  const text = event.clipboardData?.getData('text/plain');
  const { $from, $to } = editor.prosemirrorState.selection;
  if ($from.parent.type.spec.code && $to.parent === $from.parent && text) {
    const block = editor.getTextCursorPosition().block;
    const empty = !codeSnippetText(block.content);
    const beforeCursor = $from.parent.textContent.slice(0, $from.parentOffset);
    const currentLine = beforeCursor.slice(beforeCursor.lastIndexOf('\n') + 1);
    const indent = currentLine.match(/^[ \t]*/)?.[0] ?? '';
    editor.pasteText(normalizeCodeIndentation(text, indent));
    if (empty && block.type === 'codeBlock' && !block.props.language)
      void detectBlockLanguage(editor, block.id);
    return true;
  }

  const before = new Set<string>();
  editor.forEachBlock((block) => {
    if (block.type === 'codeBlock') before.add(block.id);
    return true;
  });
  const handled = defaultPasteHandler();
  // Copying Catch blocks preserves their exact source and explicit language choices.
  if (event.clipboardData?.types.includes('blocknote/html')) return handled;
  const added: string[] = [];
  editor.forEachBlock((block) => {
    if (block.type === 'codeBlock' && !before.has(block.id)) added.push(block.id);
    return true;
  });
  const hasLanguage =
    /(?:^|\n)\s*(?:```|~~~)\S+/.test(text ?? '') ||
    /\blanguage-\S+/.test(event.clipboardData?.getData('text/html') ?? '') ||
    Boolean(event.clipboardData?.getData('vscode-editor-data'));
  for (const id of added) {
    const block = editor.getBlock(id);
    if (block?.type !== 'codeBlock') continue;
    const source = codeSnippetText(block.content);
    const normalized = normalizeCodeIndentation(source);
    if (normalized !== source) editor.updateBlock(id, { content: normalized });
    // Markdown's parser supplies `text` for a fence with no info string.
    if (!hasLanguage && (!block.props.language || codeLanguageId(block.props.language) === 'text'))
      void detectBlockLanguage(editor, id);
  }
  return handled;
}
