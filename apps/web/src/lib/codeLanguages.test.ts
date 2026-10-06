import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, codeLanguageId, codeLanguageName } from './codeLanguages';

describe('codeLanguages', () => {
  it('finds a language by id or alias in any letter case', () => {
    expect(codeLanguageId('python')).toBe('python');
    expect(codeLanguageId(' TS ')).toBe('typescript');
    expect(codeLanguageId('bash')).toBe('shellscript');
    expect(codeLanguageId('brainfuck')).toBeUndefined();
    expect(codeLanguageId(undefined)).toBeUndefined();
  });

  it('names a language outside the list as it was written', () => {
    expect(codeLanguageName('yml')).toBe('YAML');
    expect(codeLanguageName('brainfuck')).toBe('brainfuck');
    expect(codeLanguageName(undefined)).toBe('Plain text');
  });

  it('gives every alias to one language', () => {
    const names = Object.entries(CODE_LANGUAGES).flatMap(([id, language]) => [
      id,
      ...('aliases' in language ? language.aliases : []),
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});
