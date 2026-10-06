type CodeLanguage = {
  name: string;
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
  text: { name: 'Plain text', aliases: ['txt', 'plain', 'plaintext', 'none'] },
  c: { name: 'C', load: () => import('@shikijs/langs-precompiled/c') },
  cpp: { name: 'C++', aliases: ['c++'], load: () => import('@shikijs/langs-precompiled/cpp') },
  csharp: {
    name: 'C#',
    aliases: ['c#', 'cs'],
    load: () => import('@shikijs/langs-precompiled/csharp'),
  },
  css: { name: 'CSS', load: () => import('@shikijs/langs-precompiled/css') },
  dart: { name: 'Dart', load: () => import('@shikijs/langs-precompiled/dart') },
  diff: { name: 'Diff', aliases: ['patch'], load: () => import('@shikijs/langs-precompiled/diff') },
  docker: {
    name: 'Dockerfile',
    aliases: ['dockerfile'],
    load: () => import('@shikijs/langs-precompiled/docker'),
  },
  elixir: {
    name: 'Elixir',
    aliases: ['ex', 'exs'],
    load: () => import('@shikijs/langs-precompiled/elixir'),
  },
  go: { name: 'Go', aliases: ['golang'], load: () => import('@shikijs/langs-precompiled/go') },
  graphql: {
    name: 'GraphQL',
    aliases: ['gql'],
    load: () => import('@shikijs/langs-precompiled/graphql'),
  },
  haskell: {
    name: 'Haskell',
    aliases: ['hs'],
    load: () => import('@shikijs/langs-precompiled/haskell'),
  },
  hcl: {
    name: 'HCL',
    aliases: ['terraform', 'tf'],
    load: () => import('@shikijs/langs-precompiled/hcl'),
  },
  html: { name: 'HTML', aliases: ['htm'], load: () => import('@shikijs/langs-precompiled/html') },
  ini: { name: 'INI', aliases: ['conf'], load: () => import('@shikijs/langs-precompiled/ini') },
  java: { name: 'Java', load: () => import('@shikijs/langs-precompiled/java') },
  javascript: {
    name: 'JavaScript',
    aliases: ['js', 'mjs', 'cjs'],
    load: () => import('@shikijs/langs-precompiled/javascript'),
  },
  json: {
    name: 'JSON',
    aliases: ['jsonc', 'json5'],
    load: () => import('@shikijs/langs-precompiled/jsonc'),
  },
  jsx: { name: 'JSX', load: () => import('@shikijs/langs-precompiled/jsx') },
  kotlin: {
    name: 'Kotlin',
    aliases: ['kt', 'kts'],
    load: () => import('@shikijs/langs-precompiled/kotlin'),
  },
  latex: {
    name: 'LaTeX',
    aliases: ['tex'],
    load: () => import('@shikijs/langs-precompiled/latex'),
  },
  lua: { name: 'Lua', load: () => import('@shikijs/langs-precompiled/lua') },
  make: {
    name: 'Makefile',
    aliases: ['makefile'],
    load: () => import('@shikijs/langs-precompiled/make'),
  },
  markdown: {
    name: 'Markdown',
    aliases: ['md'],
    load: () => import('@shikijs/langs-precompiled/markdown'),
  },
  nginx: { name: 'Nginx', load: () => import('@shikijs/langs-precompiled/nginx') },
  nix: { name: 'Nix', load: () => import('@shikijs/langs-precompiled/nix') },
  php: { name: 'PHP', load: () => import('@shikijs/langs-precompiled/php') },
  powershell: {
    name: 'PowerShell',
    aliases: ['ps', 'ps1'],
    load: () => import('@shikijs/langs-precompiled/powershell'),
  },
  proto: {
    name: 'Protocol Buffers',
    aliases: ['protobuf'],
    load: () => import('@shikijs/langs-precompiled/proto'),
  },
  python: {
    name: 'Python',
    aliases: ['py'],
    load: () => import('@shikijs/langs-precompiled/python'),
  },
  r: { name: 'R', load: () => import('@shikijs/langs-precompiled/r') },
  ruby: { name: 'Ruby', aliases: ['rb'], load: () => import('@shikijs/langs-precompiled/ruby') },
  rust: { name: 'Rust', aliases: ['rs'], load: () => import('@shikijs/langs-precompiled/rust') },
  scala: { name: 'Scala', load: () => import('@shikijs/langs-precompiled/scala') },
  scss: { name: 'SCSS', load: () => import('@shikijs/langs-precompiled/scss') },
  shellscript: {
    name: 'Shell',
    aliases: ['bash', 'sh', 'shell', 'zsh'],
    load: () => import('@shikijs/langs-precompiled/shellscript'),
  },
  sql: { name: 'SQL', load: () => import('@shikijs/langs-precompiled/sql') },
  swift: { name: 'Swift', load: () => import('@shikijs/langs-precompiled/swift') },
  toml: { name: 'TOML', load: () => import('@shikijs/langs-precompiled/toml') },
  tsx: {
    name: 'TSX',
    aliases: ['typescriptreact'],
    load: () => import('@shikijs/langs-precompiled/tsx'),
  },
  typescript: {
    name: 'TypeScript',
    aliases: ['ts', 'mts', 'cts'],
    load: () => import('@shikijs/langs-precompiled/typescript'),
  },
  xml: { name: 'XML', aliases: ['svg'], load: () => import('@shikijs/langs-precompiled/xml') },
  yaml: { name: 'YAML', aliases: ['yml'], load: () => import('@shikijs/langs-precompiled/yaml') },
  zig: { name: 'Zig', load: () => import('@shikijs/langs-precompiled/zig') },
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
