import type { HistoryState } from './history';
import { canonicalHistory } from './historyCanonical';

type Block = Record<string, unknown>;

/** Inline styles that mark words the comparison added or removed; no stored note has them. */
export const REVIEW_INSERTED = 'reviewInserted';
export const REVIEW_DELETED = 'reviewDeleted';

export type HistoryReviewItem = {
  key: string;
  status: 'same' | 'added' | 'removed' | 'changed';
  /** The block also sits somewhere else among its siblings. */
  moved: boolean;
  /** How a changed block differs when no word of it was added or removed. */
  detail?: 'formatting' | 'checked' | 'unchecked';
  /** Without its children. A changed block's words carry the review styles above. */
  block: Block;
  children: HistoryReviewItem[];
};
export type HistoryReview = { items: HistoryReviewItem[]; changes: number };

/** Word diffs larger than this many cell comparisons show the block as replaced instead. */
const MAX_DIFF_CELLS = 4_000_000;
/** Above this many pairs of unmatched blocks, only identical ones are paired. */
const MAX_ALIKE_CELLS = 250_000;

const isObject = (value: unknown): value is Block => typeof value === 'object' && value !== null;
const childrenOf = (block: Block) =>
  Array.isArray(block.children) ? block.children.filter(isObject) : [];
const own = (block: Block) => {
  const { children: _children, ...rest } = block;
  return rest;
};

type Token = { text: string; styles: Block; stylesKey: string; href: string | null };
type Marked = Token & { mark: typeof REVIEW_INSERTED | typeof REVIEW_DELETED | null };

function words(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return text.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu) ?? [];
}

/** Null for inline content this comparison does not know how to take apart. */
function tokens(content: unknown): Token[] | null {
  if (typeof content === 'string') return tokens([{ type: 'text', text: content, styles: {} }]);
  if (!Array.isArray(content)) return null;
  const result: Token[] = [];
  const add = (run: unknown, href: string | null) => {
    if (!isObject(run) || run.type !== 'text' || typeof run.text !== 'string') return false;
    const styles = isObject(run.styles) ? run.styles : {};
    const stylesKey = canonicalHistory(styles);
    for (const text of words(run.text)) result.push({ text, styles, stylesKey, href });
    return true;
  };
  for (const item of content) {
    if (isObject(item) && item.type === 'link') {
      if (typeof item.href !== 'string' || !Array.isArray(item.content)) return null;
      for (const run of item.content) if (!add(run, item.href)) return null;
    } else if (!add(item, null)) return null;
  }
  return result;
}

/** The words of both sides in reading order: removed words, then the ones that replaced them. */
function diffTokens(before: Token[], after: Token[]): Marked[] | null {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start]!.text === after[start]!.text
  )
    start++;
  let endBefore = before.length,
    endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1]!.text === after[endAfter - 1]!.text
  ) {
    endBefore--;
    endAfter--;
  }
  const rows = endBefore - start,
    columns = endAfter - start;
  if (rows * columns > MAX_DIFF_CELLS) return null;
  // Longest common subsequence, filled from the end so the walk below runs forward.
  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row--)
    for (let column = columns - 1; column >= 0; column--)
      table[row * width + column] =
        before[start + row]!.text === after[start + column]!.text
          ? table[(row + 1) * width + column + 1]! + 1
          : Math.max(table[(row + 1) * width + column]!, table[row * width + column + 1]!);

  type Step = { same: Token } | { removed: Token[]; added: Token[] };
  const steps: Step[] = [];
  const change = () => {
    const last = steps.at(-1);
    if (last && 'removed' in last) return last;
    const next = { removed: [] as Token[], added: [] as Token[] };
    steps.push(next);
    return next;
  };
  for (let index = 0; index < start; index++) steps.push({ same: after[index]! });
  let row = 0,
    column = 0;
  while (row < rows || column < columns) {
    if (
      row < rows &&
      column < columns &&
      before[start + row]!.text === after[start + column]!.text
    ) {
      steps.push({ same: after[start + column]! });
      row++;
      column++;
    } else if (
      column < columns &&
      (row === rows || table[row * width + column + 1]! >= table[(row + 1) * width + column]!)
    )
      change().added.push(after[start + column++]!);
    else change().removed.push(before[start + row++]!);
  }
  for (let index = endAfter; index < after.length; index++) steps.push({ same: after[index]! });

  // A space left standing between two rewritten words reads as confetti; rewrite it with them.
  const joined: Step[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    const previous = joined.at(-1);
    const next = steps[index + 1];
    if (
      'same' in step &&
      !step.same.text.trim() &&
      previous &&
      'removed' in previous &&
      next &&
      'removed' in next
    ) {
      previous.removed.push(step.same, ...next.removed);
      previous.added.push(step.same, ...next.added);
      index++;
    } else joined.push(step);
  }
  return joined.flatMap((step): Marked[] =>
    'same' in step
      ? [{ ...step.same, mark: null }]
      : [
          ...step.removed.map((token): Marked => ({ ...token, mark: REVIEW_DELETED })),
          ...step.added.map((token): Marked => ({ ...token, mark: REVIEW_INSERTED })),
        ],
  );
}

function inline(marked: Marked[]): Block[] {
  const result: Block[] = [];
  let run: { token: Marked; block: Block } | null = null;
  let link = null as { href: string; content: Block[] } | null;
  for (const token of marked) {
    if (
      run &&
      run.token.mark === token.mark &&
      run.token.href === token.href &&
      run.token.stylesKey === token.stylesKey
    ) {
      run.block.text = `${String(run.block.text)}${token.text}`;
      continue;
    }
    const block: Block = {
      type: 'text',
      text: token.text,
      styles: token.mark ? { ...token.styles, [token.mark]: true } : token.styles,
    };
    run = { token, block };
    if (token.href === null) {
      link = null;
      result.push(block);
    } else if (link?.href === token.href) link.content.push(block);
    else {
      link = { href: token.href, content: [block] };
      result.push({ type: 'link', href: token.href, content: link.content });
    }
  }
  return result;
}

type Outline = { index: number; content: string; words: Map<string, number> | null; total: number };
/** What a block says, apart from its id and its children. */
function outline(block: Block): Omit<Outline, 'index'> {
  const { children: _children, id: _id, ...rest } = block;
  const parts = tokens(rest.content);
  const words = parts && new Map<string, number>();
  let total = 0;
  for (const part of parts ?? []) {
    const word = part.text.trim().toLowerCase();
    if (!word) continue;
    words?.set(word, (words.get(word) ?? 0) + 1);
    total++;
  }
  return { content: canonicalHistory(rest), words, total };
}
/** The same block, or one that shares at least half of its words with the other. */
function resembles(was: Outline, now: Outline) {
  if (was.content === now.content) return true;
  if (!was.words || !now.words || !was.total || !now.total) return false;
  let common = 0;
  for (const [word, times] of was.words) common += Math.min(times, now.words.get(word) ?? 0);
  return (2 * common) / (was.total + now.total) >= 0.5;
}
/** Pairs of indices, in order on both sides: the longest run of blocks that resemble. */
function alike(before: Outline[], after: Outline[]): [number, number][] {
  const pairs: [number, number][] = [];
  if (before.length * after.length > MAX_ALIKE_CELLS) {
    // Too many to weigh against each other: pair the ones left exactly as they were.
    let from = 0;
    for (const was of before) {
      const at = after.findIndex((now, index) => index >= from && now.content === was.content);
      if (at < 0) continue;
      pairs.push([was.index, after[at]!.index]);
      from = at + 1;
    }
    return pairs;
  }
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  const same = new Uint8Array(before.length * after.length);
  for (let row = before.length - 1; row >= 0; row--)
    for (let column = after.length - 1; column >= 0; column--) {
      const match = resembles(before[row]!, after[column]!);
      same[row * after.length + column] = match ? 1 : 0;
      table[row * width + column] = match
        ? table[(row + 1) * width + column + 1]! + 1
        : Math.max(table[(row + 1) * width + column]!, table[row * width + column + 1]!);
    }
  let row = 0,
    column = 0;
  while (row < before.length && column < after.length) {
    if (same[row * after.length + column])
      pairs.push([before[row++]!.index, after[column++]!.index]);
    else if (table[(row + 1) * width + column]! >= table[row * width + column + 1]!) row++;
    else column++;
  }
  return pairs;
}

const blank = (value: unknown): boolean =>
  !value || (typeof value === 'object' && Object.values(value).every(blank));
/**
 * Whether two blocks look the same. An imported note leaves out what the editor writes in
 * full, so a prop only one side names is no difference, nor is a style it has switched off.
 */
function looksSame(was: unknown, now: unknown, props = false): boolean {
  if (Array.isArray(was) || Array.isArray(now))
    return (
      Array.isArray(was) &&
      Array.isArray(now) &&
      was.length === now.length &&
      was.every((item, index) => looksSame(item, now[index]))
    );
  if (!isObject(was) || !isObject(now)) return was === now;
  for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (!(name in was) || !(name in now)) {
      if (props || name === 'props' || blank(was[name] ?? now[name])) continue;
      return false;
    }
    if (!looksSame(was[name], now[name], name === 'props')) return false;
  }
  return true;
}

const whole = (block: Block, status: 'added' | 'removed', key: string): HistoryReviewItem => ({
  key,
  status,
  moved: false,
  block: own(block),
  children: childrenOf(block).map((child, index) => whole(child, status, `${key}/${index}`)),
});

function reviewBlocks(before: Block[], after: Block[], path: string): HistoryReviewItem[] {
  const counts = (blocks: Block[]) => {
    const result = new Map<string, number>();
    for (const block of blocks)
      if (typeof block.id === 'string') result.set(block.id, (result.get(block.id) ?? 0) + 1);
    return result;
  };
  const leftCounts = counts(before),
    rightCounts = counts(after);
  const shared = (block: Block) =>
    typeof block.id === 'string' &&
    leftCounts.get(block.id) === 1 &&
    rightCounts.get(block.id) === 1;
  // A block keeps its id through an edit, but not through being cut and pasted or typed
  // again, so the blocks that ids leave over pair up by what they say, in order.
  const leftKeys = before.map((block, index) =>
    shared(block) ? `${path}id:${String(block.id)}` : `${path}was:${index}`,
  );
  const rightKeys = after.map((block, index) =>
    shared(block) ? `${path}id:${String(block.id)}` : `${path}now:${index}`,
  );
  const rest = (blocks: Block[]) =>
    blocks.flatMap((block, index) => (shared(block) ? [] : [{ index, ...outline(block) }]));
  for (const [was, now] of alike(rest(before), rest(after)))
    leftKeys[was] = rightKeys[now] = `${path}like:${now}`;
  const left = new Map(before.map((block, index) => [leftKeys[index]!, { block, index }]));
  const right = new Map(after.map((block, index) => [rightKeys[index]!, { block, index }]));
  // Insertions shift indices without moving existing blocks. LIS isolates reordered blocks.
  const common = [...right.keys()].filter((id) => left.has(id));
  const tails: number[] = [],
    predecessors: number[] = [],
    end: number[] = [];
  common.forEach((id, index) => {
    const value = left.get(id)!.index;
    let low = 0,
      high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (tails[middle]! < value) low = middle + 1;
      else high = middle;
    }
    predecessors[index] = low ? end[low - 1]! : -1;
    tails[low] = value;
    end[low] = index;
  });
  const stayed = new Set<string>();
  let cursor = end.at(-1) ?? -1;
  while (cursor >= 0) {
    stayed.add(common[cursor]!);
    cursor = predecessors[cursor]!;
  }

  const items: HistoryReviewItem[] = [];
  /** The last item drawn for a block of the earlier side, which a removed block follows. */
  const drawn = new Map<string, HistoryReviewItem>();
  for (const [id, current] of right) {
    const previous = left.get(id);
    if (!previous) {
      items.push(whole(current.block, 'added', id));
      continue;
    }
    const moved = !stayed.has(id);
    const children = reviewBlocks(childrenOf(previous.block), childrenOf(current.block), `${id}/`);
    const was = own(previous.block),
      is = own(current.block);
    let item: HistoryReviewItem;
    if (outline(was).content === outline(is).content)
      item = { key: id, status: 'same', moved, block: is, children };
    else {
      const earlier = tokens(was.content),
        later = tokens(is.content);
      const marked = earlier && later ? diffTokens(earlier, later) : null;
      if (!marked) {
        // A table, a file or a rewrite too long to line up: show both, the old one first.
        items.push({ ...whole(was, 'removed', `${id}:before`), moved: false });
        item = { key: id, status: 'added', moved, block: is, children };
      } else {
        const rewritten = marked.some((token) => token.mark);
        const checked = isObject(is.props) ? is.props.checked : undefined;
        const wasChecked = isObject(was.props) ? was.props.checked : undefined;
        if (!rewritten && looksSame({ ...was, id: null }, { ...is, id: null }))
          item = { key: id, status: 'same', moved, block: is, children };
        else
          item = {
            key: id,
            status: 'changed',
            moved,
            ...(rewritten
              ? {}
              : {
                  detail:
                    checked !== wasChecked && typeof checked === 'boolean'
                      ? checked
                        ? ('checked' as const)
                        : ('unchecked' as const)
                      : ('formatting' as const),
                }),
            block: { ...is, content: inline(marked) },
            children,
          };
      }
    }
    items.push(item);
    drawn.set(id, item);
  }
  // A removed block keeps its place after the block that came before it.
  let head = 0;
  before.forEach((block, index) => {
    const id = leftKeys[index]!;
    if (right.has(id)) return;
    const item = whole(block, 'removed', id);
    const anchor = index ? drawn.get(leftKeys[index - 1]!) : undefined;
    if (anchor) items.splice(items.indexOf(anchor) + 1, 0, item);
    else items.splice(head++, 0, item);
    drawn.set(id, item);
  });
  return items;
}

const count = (items: HistoryReviewItem[]): number =>
  items.reduce(
    (total, item) =>
      total +
      (item.status === 'same' ? (item.moved ? 1 : 0) + count(item.children) : 1) +
      (item.status === 'changed' ? count(item.children) : 0),
    0,
  );

/**
 * Both documents as one, for reading: the later one in its order, each block marked with
 * what happened to it, and the blocks it lost left where they were. Presentation compares
 * all JSON fields, independently from the storage delta.
 */
export function reviewHistory(before: HistoryState, after: HistoryState): HistoryReview {
  const items = reviewBlocks(before.content, after.content, '');
  return { items, changes: count(items) };
}
