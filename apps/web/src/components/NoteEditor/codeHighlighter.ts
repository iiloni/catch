import { createBundledHighlighter, createCssVariablesTheme } from '@shikijs/core';
import { createJavaScriptRawEngine } from '@shikijs/engine-javascript';
import { CODE_LANGUAGES } from '@/lib/codeLanguages';

type Languages = Parameters<typeof createBundledHighlighter>[0]['langs'];

const langs = Object.fromEntries(
  Object.entries(CODE_LANGUAGES).flatMap(([id, language]) =>
    'load' in language ? [[id, language.load]] : [],
  ),
) as Languages;

// Tokens are colored with the `--code-*` tokens in styles.css instead of a fixed theme, so
// they follow the app's light and dark palettes and stay readable on every note color.
const theme = createCssVariablesTheme({ name: 'catch', variablePrefix: '--code-' });

// The grammars are precompiled to JavaScript regular expressions, which the raw engine runs
// as they are.
const createHighlighter = createBundledHighlighter({
  langs,
  themes: {},
  engine: createJavaScriptRawEngine,
});

export function createCodeHighlighter() {
  return createHighlighter({ themes: [theme], langs: [] });
}
