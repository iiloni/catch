import { blocksToPlainText, type Note, type NoteColor } from '@catch/shared';

export type Segment = { text: string; match: boolean };

export type SearchResult = {
  note: Note;
  title: Segment[];
  /** The best matching line after the title, trimmed around the match. */
  snippet: Segment[];
};

const SNIPPET_CONTEXT = 40;

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

    const [title = '', ...body] = lines;
    const matchingLine =
      words.length > 0
        ? body.find((line) => words.some((word) => line.toLowerCase().includes(word)))
        : undefined;
    const snippetLine = matchingLine ?? body.find(Boolean) ?? '';
    results.push({
      note,
      title: highlight(title, words),
      snippet: highlight(matchingLine ? snippetAround(snippetLine, words) : snippetLine, words),
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
