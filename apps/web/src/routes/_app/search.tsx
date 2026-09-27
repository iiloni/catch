import { BOARD_COLUMNS, NOTE_COLORS, type NoteColor } from '@catch/shared';
import { isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Clock, Search, SearchX, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useDeferredValue, useMemo, useState } from 'react';
import { z } from 'zod';
import { COLOR_NAMES } from '@/components/ColorPicker/ColorPicker';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { notesCollection } from '@/lib/collections';
import { searchQuery } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { useIsCardHidden } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { type SearchResult, type Segment, searchNotes } from '@/lib/searchNotes';
import { usePersistentState } from '@/lib/storage';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/search')({
  component: SearchPage,
});

const MAX_RESULTS = 60;
const recentSchema = z.array(z.string()).max(8);

function SearchPage() {
  const query = searchQuery.use();
  const deferredQuery = useDeferredValue(query);
  const [color, setColor] = useState<NoteColor | null>(null);
  const [recent, setRecent] = usePersistentState('catch-recent-searches', recentSchema, []);
  const { open } = useOpenNote();
  const { data: notes = [] } = useLiveQuery({
    query: (q) => q.from({ note: notesCollection }).where(({ note }) => isNull(note.deletedAt)),
  });

  const results = useMemo(
    () => searchNotes(notes, deferredQuery, color).slice(0, MAX_RESULTS),
    [notes, deferredQuery, color],
  );
  const searching = query.trim() !== '' || color !== null;

  function openResult(result: SearchResult, card: HTMLElement) {
    const trimmed = query.trim();
    if (trimmed) setRecent([trimmed, ...recent.filter((item) => item !== trimmed)].slice(0, 8));
    open(result.note.id, card);
  }

  return (
    <>
      <PageHeader title="Search" />
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-3 pt-3 sm:px-6">
        <ColorFilter value={color} onChange={setColor} />

        {!searching ? (
          recent.length > 0 ? (
            <section aria-labelledby="recent-heading" className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-1">
                <h2 id="recent-heading" className="font-medium text-muted-foreground text-sm">
                  Recent
                </h2>
                <button
                  type="button"
                  onClick={() => setRecent([])}
                  className="rounded-full px-2 py-1 font-medium text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  Clear
                </button>
              </div>
              <ul className="flex flex-col">
                {recent.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => searchQuery.set(item)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left outline-none active:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring/70"
                    >
                      <Clock className="size-4 text-muted-foreground" aria-hidden />
                      <span className="truncate">{item}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <EmptyState icon={Search} title="Search your notes">
              Type a word, or pick a color. Archived notes are included.
            </EmptyState>
          )
        ) : results.length > 0 ? (
          <section aria-label="Results">
            <p className="px-1 pb-2 text-muted-foreground text-xs">
              {results.length === MAX_RESULTS
                ? `First ${MAX_RESULTS} notes`
                : `${results.length} ${results.length === 1 ? 'note' : 'notes'}`}
            </p>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {results.map((result) => (
                  <motion.li
                    key={result.note.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={springs.smooth}
                  >
                    <ResultCard result={result} onOpen={openResult} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ) : (
          <EmptyState
            icon={SearchX}
            title={query.trim() ? `No notes contain “${query.trim()}”` : 'No notes in that color'}
          >
            {query.trim() ? 'Check the spelling, or try fewer words.' : 'Pick another color.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

function ColorFilter({
  value,
  onChange,
}: {
  value: NoteColor | null;
  onChange: (color: NoteColor | null) => void;
}) {
  return (
    <fieldset className="-mx-3 flex min-w-0 items-center gap-1.5 overflow-x-auto px-3 py-1 [scrollbar-width:none]">
      <legend className="sr-only">Filter by color</legend>
      <AnimatePresence initial={false}>
        {value && (
          <motion.button
            key="clear"
            type="button"
            aria-label="Any color"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 32 }}
            exit={{ opacity: 0, width: 0 }}
            transition={springs.snappy}
            onClick={() => onChange(null)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <X className="size-4" aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>
      {NOTE_COLORS.filter((color) => color !== 'default').map((color) => (
        <motion.button
          key={color}
          type="button"
          data-note-color={color}
          aria-label={COLOR_NAMES[color]}
          aria-pressed={value === color}
          whileTap={{ scale: 0.85 }}
          animate={{ scale: value === color ? 1.12 : 1 }}
          transition={springs.snappy}
          onClick={() => {
            haptics.selection();
            onChange(value === color ? null : color);
          }}
          className={cn(
            'size-8 shrink-0 rounded-full border bg-note outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
            value === color ? 'border-foreground/70' : 'border-foreground/10',
          )}
        />
      ))}
    </fieldset>
  );
}

function Highlighted({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) =>
    segment.match ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
      <mark key={index} className="rounded-sm bg-brand/45 px-0.5 text-inherit">
        {segment.text}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
      <span key={index}>{segment.text}</span>
    ),
  );
}

function ResultCard({
  result,
  onOpen,
}: {
  result: SearchResult;
  onOpen: (result: SearchResult, card: HTMLElement) => void;
}) {
  const { note } = result;
  const hidden = useIsCardHidden(note.id);
  const column = BOARD_COLUMNS.find((c) => c.id === note.status);

  return (
    <article
      data-note-card={note.id}
      data-note-color={note.color}
      className={cn(
        'rounded-2xl border border-transparent bg-note data-[note-color=default]:border-border',
        hidden && 'invisible',
      )}
    >
      <button
        type="button"
        aria-label="Open note"
        onClick={(event) => {
          const card = event.currentTarget.closest('article');
          if (card) onOpen(result, card);
        }}
        className="flex w-full flex-col gap-0.5 rounded-2xl px-3.5 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-display font-semibold text-[0.9375rem] tracking-[-0.01em]">
            {result.title.length > 0 ? <Highlighted segments={result.title} /> : 'Untitled'}
          </span>
          {(note.isArchived || column) && (
            <span className="mt-0.5 shrink-0 rounded-full bg-foreground/[0.08] px-2 py-0.5 font-medium text-[0.6875rem] text-muted-foreground">
              {note.isArchived ? 'Archived' : column?.name}
            </span>
          )}
        </span>
        {result.snippet.length > 0 && (
          <span className="line-clamp-2 text-muted-foreground text-sm">
            <Highlighted segments={result.snippet} />
          </span>
        )}
      </button>
    </article>
  );
}
