import { type BoardColumn, type Note, type NoteColor, tagColor } from '@catch/shared';
import { isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Clock, SearchX } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteTags } from '@/components/NoteTags/NoteTags';
import { TabPageHeader } from '@/components/PageHeader/PageHeader';
import {
  ActiveSearchFilters,
  BrowseTags,
  SearchFilterPanel,
  SearchFilters,
} from '@/components/SearchFilters/SearchFilters';
import { SelectCheck } from '@/components/SelectCheck/SelectCheck';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { VaultToggle } from '@/components/VaultToggle/VaultToggle';
import {
  boardColumnsCollection,
  notesCollection,
  tagsCollection,
  useNoteTagAssignments,
  useTagReadiness,
} from '@/lib/collections';
import { searchFilterCount, searchFiltersOpen, searchQuery } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { useLongPress } from '@/lib/longPress';
import { springs } from '@/lib/motion';
import { useNoteSelection } from '@/lib/noteSelection';
import { useIsCardHidden } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { type SearchResult, type Segment, searchNotes } from '@/lib/searchNotes';
import { READING_MAX, usePageGutterShift } from '@/lib/splitView';
import { usePersistentState } from '@/lib/storage';
import { indexNoteTags, matchesTagFilter, type TagSearchFilter } from '@/lib/tagSearch';
import { cn } from '@/lib/utils';
import { useVaultView } from '@/lib/vault';

export const Route = createFileRoute('/_app/search')({
  component: SearchPage,
});

const MAX_RESULTS = 60;
const recentSchema = z.array(z.string()).max(8);

function SearchPage() {
  const query = searchQuery.use();
  const filtersOpen = searchFiltersOpen.use();
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<TagSearchFilter>({ ids: [], match: 'any', untagged: false });
  const [color, setColor] = useState<NoteColor | null>(null);
  const [recent, setRecent] = usePersistentState('catch-recent-searches', recentSchema, []);
  const { open } = useOpenNote();
  const gutterShift = usePageGutterShift(READING_MAX);
  const [showArchived, setShowArchived] = usePersistentState(
    'catch-search-show-archived',
    z.boolean(),
    true,
  );
  const { data: plainNotes = [] } = useLiveQuery({
    query: (q) => q.from({ note: notesCollection }).where(({ note }) => isNull(note.deletedAt)),
  });
  // Search runs on the device, so inside the vault it reads the vault's opened notes.
  const vault = useVaultView();
  const stored = useMemo(
    () => (vault ? vault.filter((note) => !note.deletedAt) : plainNotes),
    [vault, plainNotes],
  );
  // Filtered ahead of the counts, so a tag's number is the notes its filter would show.
  const notes = useMemo(
    () => (showArchived ? stored : stored.filter((note) => !note.isArchived)),
    [stored, showArchived],
  );
  const { data: columns = [] } = useLiveQuery({
    query: (q) => q.from({ column: boardColumnsCollection }),
  });

  const { data: tags = [] } = useLiveQuery({
    query: (q) => q.from({ tag: tagsCollection }),
  });
  // An apparently unlinked swatch is meaningful only after the initial tag snapshot.
  const { awaitingTags, awaitingAssignments } = useTagReadiness();
  const awaitingTagData = awaitingTags || awaitingAssignments;
  const assignments = useNoteTagAssignments();
  const indexed = useMemo(() => indexNoteTags(tags, assignments), [tags, assignments]);
  const { counts, untaggedCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let untaggedCount = 0;
    for (const note of notes) {
      const ids = indexed.get(note.id);
      if (!ids?.size) untaggedCount++;
      for (const id of ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return { counts, untaggedCount };
  }, [notes, indexed]);
  const browsing = filter.ids.length > 0 || filter.untagged;
  const results = useMemo(
    () =>
      searchNotes(
        notes
          .filter((note) => matchesTagFilter(indexed.get(note.id), filter))
          .map((note) => {
            const primary = assignments.get(note.id)?.primaryTagId;
            return primary ? { ...note, color: tagColor(tags, primary) } : note;
          }),
        deferredQuery,
        color,
        browsing,
      ).slice(0, MAX_RESULTS),
    [notes, deferredQuery, color, tags, assignments, indexed, filter, browsing],
  );
  // The notes as stored: a result's note wears its primary tag's color.
  const resultNotes = useMemo(() => {
    const ids = new Set(results.map((result) => result.note.id));
    return notes.filter((note) => ids.has(note.id));
  }, [notes, results]);
  const selection = useNoteSelection(resultNotes);
  // Results mix archived notes with the rest, as the Reminders page does.
  const place = selection.notes.every((note) => note.isArchived) ? 'archive' : 'gallery';
  const searching = query.trim() !== '' || color !== null || browsing;
  const view = awaitingTagData
    ? 'loading'
    : !searching
      ? 'browse'
      : results.length > 0
        ? 'results'
        : 'empty';
  const filterCount = filter.ids.length + Number(filter.untagged) + Number(color !== null);
  useEffect(() => {
    searchFilterCount.set(filterCount);
  }, [filterCount]);
  useEffect(
    () => () => {
      searchFiltersOpen.set(false);
      searchFilterCount.set(0);
    },
    [],
  );

  function closeFilters() {
    searchFiltersOpen.set(false);
  }

  function openResult(result: SearchResult, card: HTMLElement) {
    const trimmed = query.trim();
    if (trimmed) setRecent([trimmed, ...recent.filter((item) => item !== trimmed)].slice(0, 8));
    closeFilters();
    open(result.note.id, card);
  }

  return (
    <>
      <AnimatePresence>
        {filtersOpen && (
          <SearchFilterPanel
            filtered={filterCount > 0}
            onClose={closeFilters}
            onClear={() => {
              setFilter({ ids: [], match: 'any', untagged: false });
              setColor(null);
            }}
          >
            <SearchFilters
              tags={tags}
              awaitingTags={awaitingTagData}
              filter={filter}
              color={color}
              counts={counts}
              untaggedCount={untaggedCount}
              showArchived={showArchived}
              onFilterChange={setFilter}
              onColorChange={setColor}
              onShowArchivedChange={setShowArchived}
            />
          </SearchFilterPanel>
        )}
      </AnimatePresence>
      <TabPageHeader
        title={vault ? 'Search the vault' : 'Search'}
        selection={selectionHeader(selection, place)}
        trailing={<VaultToggle />}
      />
      <motion.div style={{ x: gutterShift }} className="mx-auto max-w-2xl px-3 pt-3 pb-6 sm:px-6">
        <ActiveSearchFilters
          tags={tags}
          filter={filter}
          color={color}
          onFilterChange={setFilter}
          onColorChange={setColor}
        />
        <div className="relative">
          <AnimatePresence initial={false}>
            <SearchView key={view} view={view}>
              {awaitingTagData && (
                <p role="status" className="px-1 text-sm text-muted-foreground">
                  Loading tags…
                </p>
              )}
              {!awaitingTagData && !searching && (
                <BrowseTags
                  tags={tags}
                  counts={counts}
                  untaggedCount={untaggedCount}
                  onSelect={(id) => setFilter({ ...filter, ids: [id], untagged: false })}
                  onUntagged={() => setFilter({ ...filter, ids: [], untagged: true })}
                />
              )}
              {awaitingTagData ? null : !searching ? (
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
                  <p className="px-1 text-sm text-muted-foreground">
                    Search words, browse a tag, or filter by color. Archived notes are{' '}
                    {showArchived ? 'included' : 'hidden'}.
                  </p>
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
                          <ResultCard
                            result={result}
                            columns={columns}
                            onOpen={openResult}
                            selected={
                              selection.selecting ? selection.ids.has(result.note.id) : undefined
                            }
                            onSelect={selection.select}
                          />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              ) : (
                <EmptyState icon={SearchX} title="No matching notes">
                  {showArchived
                    ? 'Try fewer words or remove a filter.'
                    : 'Try fewer words, remove a filter or show archived notes.'}
                </EmptyState>
              )}
            </SearchView>
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}

function SearchView({
  children,
  view,
}: {
  children: ReactNode;
  view: 'browse' | 'results' | 'empty' | 'loading';
}) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      data-search-view={view}
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
      transition={reducedMotion ? { duration: 0 } : springs.smooth}
      className={cn('flex flex-col gap-5', !isPresent && 'absolute inset-x-0 top-0')}
    >
      {children}
    </motion.div>
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
  columns,
  onOpen,
  selected,
  onSelect,
}: {
  result: SearchResult;
  columns: BoardColumn[];
  onOpen: (result: SearchResult, card: HTMLElement) => void;
  /** Undefined unless notes are being selected, when a tap selects instead of opening. */
  selected: boolean | undefined;
  onSelect: (note: Note, selected: boolean) => void;
}) {
  const { note } = result;
  const hidden = useIsCardHidden(note.id);
  const column = columns.find((c) => c.id === note.status);
  const selecting = selected !== undefined;
  const longPress = useLongPress(() => {
    haptics.longPress();
    onSelect(note, true);
  });

  return (
    <article
      data-note-card={note.id}
      data-note-color={note.color}
      {...longPress}
      className={cn(
        'group/cell relative touch-manipulation select-none rounded-2xl border border-transparent bg-note [-webkit-touch-callout:none] data-[note-color=default]:border-border',
        hidden && 'invisible',
      )}
    >
      <button
        type="button"
        aria-label={selecting ? 'Select note' : 'Open note'}
        aria-pressed={selecting ? selected : undefined}
        onClick={(event) => {
          if (selecting) {
            haptics.selection();
            onSelect(note, !selected);
            return;
          }
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
      <NoteTags noteId={note.id} className="px-3.5 pb-3 [&>h3]:sr-only" />
      <motion.span
        aria-hidden
        className="-inset-px pointer-events-none absolute rounded-2xl border-2 border-foreground"
        initial={false}
        animate={{ opacity: selected ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      />
      <SelectCheck selected={selected} onSelect={() => onSelect(note, true)} />
    </article>
  );
}
