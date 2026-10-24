import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import haskell from 'highlight.js/lib/languages/haskell';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import nix from 'highlight.js/lib/languages/nix';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { type CodeLanguageId, codeLanguageId } from './codeLanguages';

// This module is one lazy chunk; Shiki still owns rendering and its existing theme.
const detector = hljs.newInstance();
const languages = {
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  go,
  graphql,
  haskell,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  lua,
  makefile,
  markdown,
  nginx,
  nix,
  php,
  powershell,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  bash,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};
for (const [id, grammar] of Object.entries(languages)) detector.registerLanguage(id, grammar);

/** Relevance is a heuristic, not a probability. Close guesses stay as plain text. */
export function detectCodeLanguage(text: string): CodeLanguageId | undefined {
  if (text.trim().length < 12) return undefined;
  // Bound work for very large pastes; never change the source to make a guess.
  const sample = text.slice(0, 20_000);
  if (text.length <= 20_000 && /^\s*[[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) return 'json';
    } catch {
      // A bracket can also start ordinary source code.
    }
  }
  if (/^\s*(?:async\s+)?def\s+\w+\s*\([^\n]*\)\s*(?:->[^\n]+)?\s*:/m.test(sample)) return 'python';
  if (
    /\binterface\s+\w+(?:\s+extends\s+\w+)?\s*\{|\b(?:const|let|var)\s+\w+\s*:\s*(?:string|number|boolean|unknown)\b/.test(
      sample,
    )
  )
    return 'typescript';
  if (
    /\b(?:const|let|var)\s+\w+\s*=/.test(sample) &&
    /\bconsole\.|=>|\b(?:export|import)\b/.test(sample)
  )
    return 'javascript';
  const result = detector.highlightAuto(sample);
  if (!result.language || result.relevance < 5) return undefined;
  const second = result.secondBest;
  const jsFamily = (language: string | undefined) =>
    language === 'javascript' || language === 'typescript';
  if (jsFamily(result.language) && (!second || jsFamily(second.language))) {
    return /\b(?:interface|type|enum|implements|declare)\s+\w+|:\s*(?:string|number|boolean|unknown|never)\b/.test(
      sample,
    )
      ? 'typescript'
      : 'javascript';
  }
  if (second && result.relevance < second.relevance + 1) return undefined;
  if (result.language === 'xml') {
    return /<\/?(?:html|head|body|div|span|p|a|script|style)\b/i.test(sample) ? 'html' : 'xml';
  }
  return codeLanguageId(result.language);
}
