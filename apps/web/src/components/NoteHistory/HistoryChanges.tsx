import type { HistoryReview, HistoryReviewItem, HistoryState } from '@catch/shared';
import { Fragment, useEffect, useState } from 'react';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { compareHistoryInWorker } from '@/lib/historyWorker';
import { cn } from '@/lib/utils';

/** Unchanged blocks left standing on each side of a change; longer runs fold away. */
const CONTEXT = 2;
const DETAILS = {
  checked: 'Checked',
  unchecked: 'Unchecked',
  formatted: 'Formatting changed',
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const untouched = (item: HistoryReviewItem): boolean =>
  item.status === 'same' && !item.moved && item.children.every(untouched);

function ReviewItems({ items, fold }: { items: HistoryReviewItem[]; fold: boolean }) {
  const [opened, setOpened] = useState(new Set<string>());
  // A numbered list counts on through what was added to it; a removed item keeps its number.
  let number = 0;
  const numbered = items.map((item) => {
    if (item.block.type !== 'numberedListItem') {
      number = 0;
      return item.block;
    }
    const props = isObject(item.block.props) ? item.block.props : {};
    const start = number > 0 ? number + 1 : typeof props.start === 'number' ? props.start : 1;
    if (item.status !== 'removed') number = start;
    return { ...item.block, props: { ...props, start } };
  });

  const rows = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    let end = index;
    while (end < items.length && untouched(items[end]!)) end++;
    const hidden = end - index - (index ? CONTEXT : 0) - (end < items.length ? CONTEXT : 0);
    // Named by its last block, which every block of the run finds again once it is shown.
    const run = items[end - 1]?.key ?? item.key;
    if (fold && hidden > 1 && !opened.has(run)) {
      const from = index ? index + CONTEXT : index;
      rows.push(
        ...items
          .slice(index, from)
          .map((shown, offset) => (
            <ReviewBlock key={shown.key} item={shown} block={numbered[index + offset]!} />
          )),
        <button
          key={`${run}:fold`}
          type="button"
          className="mx-4 my-2 flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-muted-foreground text-sm outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpened(new Set(opened).add(run))}
        >
          <span aria-hidden className="h-px w-6 bg-current opacity-40" />
          Show {hidden} unchanged lines
        </button>,
      );
      index = from + hidden - 1;
      continue;
    }
    rows.push(<ReviewBlock key={item.key} item={item} block={numbered[index]!} />);
  }
  return rows;
}

function ReviewBlock({ item, block }: { item: HistoryReviewItem; block: Record<string, unknown> }) {
  const marked = item.status !== 'same' || item.moved;
  const Mark = item.status === 'added' ? 'ins' : item.status === 'removed' ? 'del' : 'div';
  const label = [item.moved && 'Moved', item.detail && DETAILS[item.detail]]
    .filter(Boolean)
    .join(' · ');
  return (
    <Fragment>
      <Mark
        className={cn(marked && 'review-block')}
        data-review={marked ? (item.moved && item.status === 'same' ? 'moved' : item.status) : null}
      >
        <NotePreview content={[block]} maxBlocks={1} variant="editor" reading />
        {label && (
          <p className="note-links-inset pb-1 font-medium text-muted-foreground text-xs">{label}</p>
        )}
      </Mark>
      {item.children.length > 0 && (
        <div className="pl-6">
          <ReviewItems items={item.children} fold={false} />
        </div>
      )}
    </Fragment>
  );
}

/**
 * What the note gained and lost since `before`. Null until it is known, and `failed` when
 * it cannot be: either way the reader goes on showing the version itself.
 */
export function useHistoryReview(before: HistoryState | null, after: HistoryState) {
  const [result, setResult] = useState<{
    before: HistoryState;
    review: HistoryReview | null;
  } | null>(null);
  useEffect(() => {
    if (!before) return;
    const controller = new AbortController();
    void compareHistoryInWorker(before, after, controller.signal)
      .then((review) => setResult({ before, review }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ before, review: null });
      });
    return () => controller.abort();
  }, [before, after]);
  // An answer for another version is no answer for this one.
  const current = result?.before === before ? result : null;
  return { review: current?.review ?? null, failed: current !== null && !current.review };
}

/** The current note and what it lost, read as one document with the changes marked. */
export function HistoryChanges({ review }: { review: HistoryReview }) {
  return <ReviewItems items={review.items} fold />;
}
