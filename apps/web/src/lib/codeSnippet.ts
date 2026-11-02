import { Capacitor } from '@capacitor/core';
import { codeLanguageFileName } from './codeLanguages';

/** Read the source, never the highlighted DOM or its controls. */
export function codeSnippetText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return '';
      if ('text' in item && typeof item.text === 'string') return item.text;
      return 'content' in item ? codeSnippetText(item.content) : '';
    })
    .join('');
}

/** Remove the copied margin; tabs use the same two-column stops as the editor. */
export function normalizeCodeIndentation(text: string, indent = ''): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const indents = lines.map((line) => {
    let columns = 0;
    for (const char of line) {
      if (char === ' ') columns++;
      else if (char === '\t') columns += 2 - (columns % 2);
      else break;
    }
    return columns;
  });
  const margin = lines.reduce(
    (smallest, line, i) => (line.trim() ? Math.min(smallest, indents[i]!) : smallest),
    Number.POSITIVE_INFINITY,
  );
  const dedented =
    !Number.isFinite(margin) || margin === 0
      ? lines
      : lines.map((line) => {
          let columns = 0;
          let index = 0;
          while (index < line.length && columns < margin && /^[ \t]$/.test(line[index]!)) {
            columns += line[index] === '\t' ? 2 - (columns % 2) : 1;
            index++;
          }
          // Keep the remaining tabs: in languages such as Make, they carry meaning.
          return ' '.repeat(Math.max(0, columns - margin)) + line.slice(index);
        });
  return dedented
    .map((line, index) => (index > 0 && line.trim() ? indent + line : line))
    .join('\n');
}

export async function downloadCodeSnippet(text: string, language: unknown) {
  const name = codeLanguageFileName(language);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  if (Capacitor.isNativePlatform()) {
    const { saveNativeFile } = await import('./mediaPicker');
    // A generic MIME keeps Android's picker from adding .txt to source extensions.
    return saveNativeFile(blob, name, 'application/octet-stream');
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}
