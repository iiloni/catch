import type { CSSProperties } from 'react';

type CodeLanguage = {
  name: string;
  fileName: string;
  icon: string;
  aliases?: string[];
  /** The grammar, fetched when a block first uses the language. Plain text has none. */
  load?: () => Promise<unknown>;
};

/**
 * Languages a code block can be set to, keyed by the id stored in the block's `language`.
 * Every grammar is its own chunk, and the service worker precaches them all so highlighting
 * works offline: weigh a grammar's size before adding it.
 */
export const CODE_LANGUAGES = {
  text: {
    fileName: 'snippet.txt',
    icon: 'text',
    name: 'Plain text',
    aliases: ['txt', 'plain', 'plaintext', 'none'],
  },
  c: {
    fileName: 'snippet.c',
    icon: 'c',
    name: 'C',
    load: () => import('@shikijs/langs-precompiled/c'),
  },
  cpp: {
    fileName: 'snippet.cpp',
    icon: 'cplusplus',
    name: 'C++',
    aliases: ['c++'],
    load: () => import('@shikijs/langs-precompiled/cpp'),
  },
  csharp: {
    fileName: 'snippet.cs',
    icon: 'csharp',
    name: 'C#',
    aliases: ['c#', 'cs'],
    load: () => import('@shikijs/langs-precompiled/csharp'),
  },
  css: {
    fileName: 'snippet.css',
    icon: 'css3',
    name: 'CSS',
    load: () => import('@shikijs/langs-precompiled/css'),
  },
  dart: {
    fileName: 'snippet.dart',
    icon: 'dart',
    name: 'Dart',
    load: () => import('@shikijs/langs-precompiled/dart'),
  },
  diff: {
    fileName: 'snippet.diff',
    icon: 'code',
    name: 'Diff',
    aliases: ['patch'],
    load: () => import('@shikijs/langs-precompiled/diff'),
  },
  docker: {
    fileName: 'Dockerfile',
    icon: 'docker',
    name: 'Dockerfile',
    aliases: ['dockerfile'],
    load: () => import('@shikijs/langs-precompiled/docker'),
  },
  elixir: {
    fileName: 'snippet.ex',
    icon: 'elixir',
    name: 'Elixir',
    aliases: ['ex', 'exs'],
    load: () => import('@shikijs/langs-precompiled/elixir'),
  },
  go: {
    fileName: 'snippet.go',
    icon: 'go',
    name: 'Go',
    aliases: ['golang'],
    load: () => import('@shikijs/langs-precompiled/go'),
  },
  graphql: {
    fileName: 'snippet.graphql',
    icon: 'graphql',
    name: 'GraphQL',
    aliases: ['gql'],
    load: () => import('@shikijs/langs-precompiled/graphql'),
  },
  haskell: {
    fileName: 'snippet.hs',
    icon: 'haskell',
    name: 'Haskell',
    aliases: ['hs'],
    load: () => import('@shikijs/langs-precompiled/haskell'),
  },
  hcl: {
    fileName: 'snippet.tf',
    icon: 'terraform',
    name: 'HCL',
    aliases: ['terraform', 'tf'],
    load: () => import('@shikijs/langs-precompiled/hcl'),
  },
  html: {
    fileName: 'snippet.html',
    icon: 'html5',
    name: 'HTML',
    aliases: ['htm'],
    load: () => import('@shikijs/langs-precompiled/html'),
  },
  ini: {
    fileName: 'snippet.ini',
    icon: 'code',
    name: 'INI',
    aliases: ['conf'],
    load: () => import('@shikijs/langs-precompiled/ini'),
  },
  java: {
    fileName: 'snippet.java',
    icon: 'java',
    name: 'Java',
    load: () => import('@shikijs/langs-precompiled/java'),
  },
  javascript: {
    fileName: 'snippet.js',
    icon: 'javascript',
    name: 'JavaScript',
    aliases: ['js', 'mjs', 'cjs'],
    load: () => import('@shikijs/langs-precompiled/javascript'),
  },
  json: {
    fileName: 'snippet.json',
    icon: 'json',
    name: 'JSON',
    aliases: ['jsonc', 'json5'],
    load: () => import('@shikijs/langs-precompiled/jsonc'),
  },
  jsx: {
    fileName: 'snippet.jsx',
    icon: 'react',
    name: 'JSX',
    load: () => import('@shikijs/langs-precompiled/jsx'),
  },
  kotlin: {
    fileName: 'snippet.kt',
    icon: 'kotlin',
    name: 'Kotlin',
    aliases: ['kt', 'kts'],
    load: () => import('@shikijs/langs-precompiled/kotlin'),
  },
  latex: {
    fileName: 'snippet.tex',
    icon: 'latex',
    name: 'LaTeX',
    aliases: ['tex'],
    load: () => import('@shikijs/langs-precompiled/latex'),
  },
  lua: {
    fileName: 'snippet.lua',
    icon: 'lua',
    name: 'Lua',
    load: () => import('@shikijs/langs-precompiled/lua'),
  },
  make: {
    fileName: 'Makefile',
    icon: 'code',
    name: 'Makefile',
    aliases: ['makefile'],
    load: () => import('@shikijs/langs-precompiled/make'),
  },
  markdown: {
    fileName: 'snippet.md',
    icon: 'markdown',
    name: 'Markdown',
    aliases: ['md'],
    load: () => import('@shikijs/langs-precompiled/markdown'),
  },
  nginx: {
    fileName: 'snippet.conf',
    icon: 'nginx',
    name: 'Nginx',
    load: () => import('@shikijs/langs-precompiled/nginx'),
  },
  nix: {
    fileName: 'snippet.nix',
    icon: 'nixos',
    name: 'Nix',
    load: () => import('@shikijs/langs-precompiled/nix'),
  },
  php: {
    fileName: 'snippet.php',
    icon: 'php',
    name: 'PHP',
    load: () => import('@shikijs/langs-precompiled/php'),
  },
  powershell: {
    fileName: 'snippet.ps1',
    icon: 'powershell',
    name: 'PowerShell',
    aliases: ['ps', 'ps1'],
    load: () => import('@shikijs/langs-precompiled/powershell'),
  },
  proto: {
    fileName: 'snippet.proto',
    icon: 'code',
    name: 'Protocol Buffers',
    aliases: ['protobuf'],
    load: () => import('@shikijs/langs-precompiled/proto'),
  },
  python: {
    fileName: 'snippet.py',
    icon: 'python',
    name: 'Python',
    aliases: ['py'],
    load: () => import('@shikijs/langs-precompiled/python'),
  },
  r: {
    fileName: 'snippet.r',
    icon: 'r',
    name: 'R',
    load: () => import('@shikijs/langs-precompiled/r'),
  },
  ruby: {
    fileName: 'snippet.rb',
    icon: 'ruby',
    name: 'Ruby',
    aliases: ['rb'],
    load: () => import('@shikijs/langs-precompiled/ruby'),
  },
  rust: {
    fileName: 'snippet.rs',
    icon: 'rust',
    name: 'Rust',
    aliases: ['rs'],
    load: () => import('@shikijs/langs-precompiled/rust'),
  },
  scala: {
    fileName: 'snippet.scala',
    icon: 'scala',
    name: 'Scala',
    load: () => import('@shikijs/langs-precompiled/scala'),
  },
  scss: {
    fileName: 'snippet.scss',
    icon: 'sass',
    name: 'SCSS',
    load: () => import('@shikijs/langs-precompiled/scss'),
  },
  shellscript: {
    fileName: 'snippet.sh',
    icon: 'bash',
    name: 'Shell',
    aliases: ['bash', 'sh', 'shell', 'zsh'],
    load: () => import('@shikijs/langs-precompiled/shellscript'),
  },
  sql: {
    fileName: 'snippet.sql',
    icon: 'azuresqldatabase',
    name: 'SQL',
    load: () => import('@shikijs/langs-precompiled/sql'),
  },
  swift: {
    fileName: 'snippet.swift',
    icon: 'swift',
    name: 'Swift',
    load: () => import('@shikijs/langs-precompiled/swift'),
  },
  toml: {
    fileName: 'snippet.toml',
    icon: 'code',
    name: 'TOML',
    load: () => import('@shikijs/langs-precompiled/toml'),
  },
  tsx: {
    fileName: 'snippet.tsx',
    icon: 'react',
    name: 'TSX',
    aliases: ['typescriptreact'],
    load: () => import('@shikijs/langs-precompiled/tsx'),
  },
  typescript: {
    fileName: 'snippet.ts',
    icon: 'typescript',
    name: 'TypeScript',
    aliases: ['ts', 'mts', 'cts'],
    load: () => import('@shikijs/langs-precompiled/typescript'),
  },
  xml: {
    fileName: 'snippet.xml',
    icon: 'xml',
    name: 'XML',
    aliases: ['svg'],
    load: () => import('@shikijs/langs-precompiled/xml'),
  },
  yaml: {
    fileName: 'snippet.yaml',
    icon: 'yaml',
    name: 'YAML',
    aliases: ['yml'],
    load: () => import('@shikijs/langs-precompiled/yaml'),
  },
  zig: {
    fileName: 'snippet.zig',
    icon: 'zig',
    name: 'Zig',
    load: () => import('@shikijs/langs-precompiled/zig'),
  },
} satisfies Record<string, CodeLanguage>;

export type CodeLanguageId = keyof typeof CODE_LANGUAGES;

const languages: Record<string, CodeLanguage> = CODE_LANGUAGES;

/** The listed language a block's `language` names, by id or alias, in any letter case. */
export function codeLanguageId(language: unknown): CodeLanguageId | undefined {
  if (typeof language !== 'string') return undefined;
  const wanted = language.trim().toLowerCase();
  const ids = Object.keys(CODE_LANGUAGES) as CodeLanguageId[];
  return ids.find((id) => id === wanted || languages[id]?.aliases?.includes(wanted));
}

/** What to call a block's language. One outside the list (pasted, imported) keeps its own name. */
export function codeLanguageName(language: unknown): string {
  const id = codeLanguageId(language);
  if (id) return CODE_LANGUAGES[id].name;
  return typeof language === 'string' && language.trim()
    ? language.trim()
    : CODE_LANGUAGES.text.name;
}

/** Names come from our list, never from an imported language or note title. */
export function codeLanguageFileName(language: unknown): string {
  return CODE_LANGUAGES[codeLanguageId(language) ?? 'text'].fileName;
}

// Logos without a brand color of their own, black or white ones that would vanish against one
// theme, take the text color instead.
const TINTED_ICONS = new Set(['bash', 'code', 'json', 'latex', 'markdown', 'rust', 'text', 'yaml']);

function iconName(language: unknown): string {
  const id = codeLanguageId(language);
  if (id) return CODE_LANGUAGES[id].icon;
  return typeof language === 'string' && language.trim() ? 'code' : 'text';
}

export function codeLanguageIcon(language: unknown): string {
  return `/code-languages/${iconName(language)}.svg`;
}

/** Props for a `.code-language-icon` element showing the language's logo. */
export function codeLanguageIconProps(language: unknown) {
  return {
    'data-tinted': TINTED_ICONS.has(iconName(language)) ? '' : undefined,
    style: { '--code-language-icon': `url("${codeLanguageIcon(language)}")` } as CSSProperties,
  };
}
