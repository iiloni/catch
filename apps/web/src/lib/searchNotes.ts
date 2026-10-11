import {
  blocksToPlainText,
  type HybridSearchResult,
  type Note,
  type NoteColor,
} from '@catch/shared';

export type Segment = { text: string; match: boolean };

export type SearchResult = {
  note: Note;
  title: Segment[];
  /** The best matching line after the title, trimmed around the match. */
  snippet: Segment[];
  semantic?: boolean;
};

const SNIPPET_CONTEXT = 40;

/** Server ranking uses local notes, so pending edits and revoked local copies stay authoritative. */
export function mergeHybridResults(
  notes: readonly Note[],
  keyword: SearchResult[],
  response: HybridSearchResult | undefined,
  query: string,
): SearchResult[] {
  if (!response) return keyword;
  const byId = new Map(notes.map((note) => [note.id, note]));
  const local = new Map(keyword.map((result) => [result.note.id, result]));
  const ranked: SearchResult[] = [];
  const seen = new Set<string>();
  for (const hit of response.hits) {
    const note = byId.get(hit.id);
    if (!note || note.updatedAt.getTime() !== Date.parse(hit.updatedAt)) continue;
    const result = local.get(hit.id) ?? describeResult(note, terms(query));
    ranked.push({ ...result, semantic: hit.semantic });
    seen.add(hit.id);
  }
  // Local-only matches include notes whose writes or embedding jobs have not reached the server.
  return [...keyword.filter((result) => !seen.has(result.note.id)), ...ranked];
}

function describeResult(note: Note, words: readonly string[]): SearchResult {
  const [title = '', ...body] = blocksToPlainText(note.content).split('\n');
  const matchingLine =
    words.length > 0
      ? body.find((line) => words.some((word) => line.toLowerCase().includes(word)))
      : undefined;
  const snippetLine = matchingLine ?? body.find(Boolean) ?? '';
  return {
    note,
    title: highlight(title, words),
    snippet: highlight(matchingLine ? snippetAround(snippetLine, words) : snippetLine, words),
  };
}

function terms(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Splits text into matched and unmatched runs for highlighting. */
export function highlight(text: string, words: readonly string[]): Segment[] {
  if (words.length === 0 || !text) return text ? [{ text, match: false }] : [];
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, match: words.includes(part.toLowerCase()) }));
}

function snippetAround(line: string, words: readonly string[]) {
  const lower = line.toLowerCase();
  const index = Math.min(
    ...words.map((word) => lower.indexOf(word)).filter((position) => position >= 0),
  );
  if (!Number.isFinite(index) || line.length <= SNIPPET_CONTEXT * 2) return line;
  const start = Math.max(0, index - SNIPPET_CONTEXT);
  const end = Math.min(line.length, index + SNIPPET_CONTEXT * 2);
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
}

/**
 * Client-side keyword search over the synced notes (see docs/decisions/0002-search.md):
 * every word must appear. Title matches rank first, then the most recently edited.
 */
export function searchNotes(
  notes: readonly Note[],
  query: string,
  color: NoteColor | null = null,
  browse = false,
): SearchResult[] {
  const words = terms(query);
  if (words.length === 0 && !color && !browse) return [];

  const results: Array<SearchResult & { titleHit: boolean }> = [];
  for (const note of notes) {
    if (color && note.color !== color) continue;
    const lines = blocksToPlainText(note.content).split('\n');
    const text = lines.join('\n').toLowerCase();
    if (!words.every((word) => text.includes(word))) continue;

    const [title = ''] = lines;
    results.push({
      ...describeResult(note, words),
      titleHit: words.some((word) => title.toLowerCase().includes(word)),
    });
  }

  return results
    .sort(
      (a, b) =>
        Number(b.titleHit) - Number(a.titleHit) ||
        b.note.updatedAt.getTime() - a.note.updatedAt.getTime(),
    )
    .map(({ titleHit: _, ...result }) => result);
}
