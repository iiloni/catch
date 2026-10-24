import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeLanguageFileName } from './codeLanguages';
import { codeSnippetText, downloadCodeSnippet, normalizeCodeIndentation } from './codeSnippet';
import { saveNativeFile } from './mediaPicker';

vi.mock('./mediaPicker', () => ({ saveNativeFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe('code snippets', () => {
  it('saves through Android with the source filename and no forced .txt extension', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    await downloadCodeSnippet('print("hi")\n', 'python');
    expect(saveNativeFile).toHaveBeenCalledWith(
      expect.any(Blob),
      'snippet.py',
      'application/octet-stream',
    );
  });
  it('extracts only source text, keeping whitespace and Unicode intact', () => {
    const source = '  print("héllo 🦊")\n\n';
    expect(codeSnippetText(source)).toBe(source);
    expect(codeSnippetText([{ type: 'text', text: '  print(' }, { text: '"héllo 🦊")\n\n' }])).toBe(
      source,
    );
  });

  it.each([
    ['py', 'snippet.py'],
    [' TS ', 'snippet.ts'],
    ['c++', 'snippet.cpp'],
    ['dockerfile', 'Dockerfile'],
    ['makefile', 'Makefile'],
    ['bash', 'snippet.sh'],
    ['brainfuck', 'snippet.txt'],
    ['../../bad.exe', 'snippet.txt'],
    [undefined, 'snippet.txt'],
  ])('names a file for %s safely', (language, expected) => {
    expect(codeLanguageFileName(language)).toBe(expected);
  });

  it.each([
    ['    def greet():\n        print("hi")\n', 'def greet():\n    print("hi")\n'],
    ['\n    if ok:\n      run()\n\n', '\nif ok:\n  run()\n\n'],
    ['  a\r\n    b\r', 'a\n  b\n'],
    ['\tall:\n\t\techo hi\n', 'all:\n\techo hi\n'],
    ['  a\n\t  b', 'a\n  b'],
    ['a\n\tb', 'a\n\tb'],
    ['  a  \n    b  ', 'a  \n  b  '],
    ['\n  \n\t', '\n  \n\t'],
    ['', ''],
  ])('removes the shared margin and preserves relative indentation: %j', (source, expected) => {
    expect(normalizeCodeIndentation(source)).toBe(expected);
  });

  it('aligns continuation lines with the cursor indentation without padding blank lines', () => {
    expect(normalizeCodeIndentation('    if ok:\n        run()\n\n', '    ')).toBe(
      'if ok:\n        run()\n\n',
    );
  });
});
