import { NOTE_COLORS, type NoteColor, type Tag } from '@catch/shared';
import { Palette, Slash, Tags, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  LayoutGroup,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import { COLOR_NAMES } from '@/components/ColorPicker/ColorPicker';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { usePersistentState } from '@/lib/storage';
import type { TagSearchFilter } from '@/lib/tagSearch';
import { cn } from '@/lib/utils';

const control =
  'flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring';

export function SearchFilterPanel({
  children,
  filtered,
  onClear,
  onClose,
}: {
  children: ReactNode;
  filtered: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const isPresent = useIsPresent();
  useEffect(() => {
    if (!isPresent) return;
    function dismiss(event: globalThis.PointerEvent) {
      if (!(event.target instanceof Element)) return;
      if (
        !ref.current?.contains(event.target) &&
        !event.target.closest('[data-search-filter-trigger]')
      )
        onClose();
    }
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [isPresent, onClose]);
  return createPortal(
    <div className="pointer-events-none fixed right-[var(--note-pane)] bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.75rem)] left-0 z-40 flex justify-center px-3">
      <motion.div
        className="flex w-full max-w-md flex-col justify-end overflow-hidden rounded-[var(--dock-radius)] shadow-[0_10px_30px_-10px_var(--glass-shadow)] [&>*]:shrink-0"
        initial={{ height: 0 }}
        animate={{ height: 'auto' }}
        exit={{ height: 0 }}
        transition={springs.smooth}
      >
        <section
          ref={ref}
          id="search-filter-panel"
          aria-label="Search filters"
          inert={!isPresent}
          aria-hidden={!isPresent}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
              document.querySelector<HTMLButtonElement>('[data-search-filter-trigger]')?.focus();
            }
          }}
          className="glass pointer-events-auto relative flex max-h-[calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-1.5rem)] w-full max-w-md flex-col gap-2 overflow-hidden rounded-[var(--dock-radius)] p-3"
        >
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            {filtered && (
              <button
                type="button"
                className={cn(control, 'text-muted-foreground')}
                onClick={onClear}
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              aria-label="Close filters"
              onClick={onClose}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </section>
      </motion.div>
    </div>,
    document.body,
  );
}

const filterTabSchema = z.enum(['colors', 'tags']);
type FilterTab = z.infer<typeof filterTabSchema>;

// Only tab switches resize with a second spring. Branches keep following their own height animation.
function FilterTabContents({ children, tab }: { children: ReactNode; tab: FilterTab }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef(0);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      previousHeight.current = content.offsetHeight;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab change is the resize trigger; branch and keyboard resizing stay natural
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const content = contentRef.current;
    if (!surface || !content) return;
    const from = surface.style.height
      ? surface.getBoundingClientRect().height
      : previousHeight.current;
    const to = content.offsetHeight;
    previousHeight.current = to;
    if (!from || from === to || reducedMotion) {
      surface.style.removeProperty('height');
      return;
    }
    let cancelled = false;
    const animation = animate(surface, { height: [from, to] }, springs.smooth);
    void animation.then(() => {
      if (!cancelled) surface.style.removeProperty('height');
    });
    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [tab, reducedMotion]);
  return (
    <div ref={surfaceRef} className="flex min-h-0 flex-col justify-end overflow-hidden">
      <div ref={contentRef} className="relative shrink-0">
        {children}
      </div>
    </div>
  );
}

function FilterTabView({
  children,
  tab,
  direction,
}: {
  children: ReactNode;
  tab: FilterTab;
  direction: number;
}) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      id={`search-filter-view-${tab}`}
      role="tabpanel"
      aria-labelledby={`search-filter-tab-${tab}`}
      inert={!isPresent}
      aria-hidden={!isPresent}
      custom={direction}
      variants={{
        enter: (travel: number) => ({ x: reducedMotion ? 0 : travel * 40, opacity: 0 }),
        shown: { x: 0, opacity: 1 },
        leave: (travel: number) => ({ x: reducedMotion ? 0 : -travel * 40, opacity: 0 }),
      }}
      initial="enter"
      animate="shown"
      exit="leave"
      transition={reducedMotion ? { duration: 0 } : springs.smooth}
      className={cn(
        'max-h-[max(0px,calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-6.25rem))] overflow-auto overscroll-contain',
        !isPresent && 'absolute inset-x-0 top-0',
      )}
    >
      {children}
    </motion.section>
  );
}

export function SearchFilters({
  tags,
  awaitingTags = false,
  filter,
  color,
  counts,
  untaggedCount,
  onFilterChange,
  onColorChange,
}: {
  tags: readonly Tag[];
  awaitingTags?: boolean;
  filter: TagSearchFilter;
  color: NoteColor | null;
  counts: ReadonlyMap<string, number>;
  untaggedCount: number;
  onFilterChange: (filter: TagSearchFilter) => void;
  onColorChange: (color: NoteColor | null) => void;
}) {
  const [tab, setTab] = usePersistentState('catch-search-filter-tab', filterTabSchema, 'colors');
  const [direction, setDirection] = useState(1);
  const layoutId = useId();
  const selected = new Set(filter.ids);
  function selectTab(next: FilterTab) {
    if (next === tab) return;
    haptics.selection();
    setDirection(next === 'tags' ? 1 : -1);
    setTab(next);
  }
  function toggleTag(id: string) {
    haptics.selection();
    onFilterChange({
      ...filter,
      untagged: false,
      ids: selected.has(id) ? filter.ids.filter((value) => value !== id) : [...filter.ids, id],
    });
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <FilterTabContents tab={tab}>
        <AnimatePresence initial={false} custom={direction}>
          <FilterTabView key={tab} tab={tab} direction={direction}>
            {tab === 'tags' ? (
              <div className="flex flex-col">
                <h3
                  id="search-tags-heading"
                  className="mb-1 flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium"
                >
                  <Tags className="size-4 text-muted-foreground" aria-hidden />
                  Tags
                </h3>
                {filter.ids.length > 1 && (
                  <fieldset className="flex items-center gap-1 text-sm">
                    <legend className="sr-only">Match tags</legend>
                    <span className="mr-1 text-xs text-muted-foreground" aria-hidden>
                      Match
                    </span>
                    {(['any', 'all'] as const).map((match) => (
                      <button
                        key={match}
                        type="button"
                        aria-pressed={filter.match === match}
                        className={cn(control, filter.match === match && 'bg-foreground/8')}
                        onClick={() => onFilterChange({ ...filter, match })}
                      >
                        {match === 'any' ? 'Any tag' : 'All tags'}
                      </button>
                    ))}
                  </fieldset>
                )}
                {awaitingTags && !tags.length ? (
                  <p role="status" className="py-2 text-sm text-muted-foreground">
                    Loading tags…
                  </p>
                ) : tags.length ? (
                  <TagTree
                    tags={tags}
                    searchPosition="bottom"
                    className="max-h-[clamp(6rem,calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-16rem),16rem)]"
                    renderTag={(tag, path) => (
                      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-foreground/5">
                        <span
                          data-note-color={path[0]?.color ?? 'default'}
                          className={path[0]?.color ? 'text-note-icon' : 'text-muted-foreground'}
                        >
                          <TagIcon name={path[0]?.icon} className="size-4" />
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-sm"
                          title={path.map((item) => item.name).join(' / ')}
                        >
                          {tag.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {counts.get(tag.id) ?? 0}
                        </span>
                        <input
                          type="checkbox"
                          aria-label={path.map((item) => item.name).join(' / ')}
                          checked={selected.has(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                          className="size-4 shrink-0 accent-brand"
                        />
                      </label>
                    )}
                  />
                ) : (
                  <p className="py-2 text-sm text-muted-foreground">
                    Create tags in Settings → Tags.
                  </p>
                )}
                <label className="mt-2 flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm hover:bg-foreground/5">
                  <Tags className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Untagged</span>
                  <span className="text-xs text-muted-foreground">{untaggedCount}</span>
                  <input
                    type="checkbox"
                    checked={filter.untagged}
                    onChange={() =>
                      onFilterChange({ ...filter, ids: [], untagged: !filter.untagged })
                    }
                    className="size-4 accent-brand"
                  />
                </label>
              </div>
            ) : (
              <div>
                <h3
                  id="search-colors-heading"
                  className="mb-1 flex min-h-11 items-center gap-2 text-sm font-medium"
                >
                  <Palette className="size-4 text-muted-foreground" aria-hidden />
                  Colors
                </h3>
                {awaitingTags && (
                  <p role="status" className="pb-2 text-sm text-muted-foreground">
                    Loading tags…
                  </p>
                )}
                <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
                  {NOTE_COLORS.map((value) => {
                    const linkedTag = tags.find(
                      (tag) => tag.parentId === null && tag.color === value,
                    );
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={awaitingTags}
                        aria-label={COLOR_NAMES[value]}
                        aria-pressed={linkedTag ? selected.has(linkedTag.id) : color === value}
                        title={
                          linkedTag
                            ? `${COLOR_NAMES[value]}: ${linkedTag.name}`
                            : COLOR_NAMES[value]
                        }
                        onClick={() => {
                          if (linkedTag) {
                            toggleTag(linkedTag.id);
                            onColorChange(null);
                          } else {
                            haptics.selection();
                            onColorChange(color === value ? null : value);
                          }
                        }}
                        className="flex h-11 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                      >
                        <span
                          data-note-color={value}
                          className={cn(
                            'flex size-8 items-center justify-center rounded-full border bg-note',
                            (linkedTag ? selected.has(linkedTag.id) : color === value)
                              ? 'border-foreground/70 ring-2 ring-foreground/20 ring-offset-2 ring-offset-card'
                              : 'border-foreground/15',
                          )}
                        >
                          {value === 'default' ? (
                            <Slash className="size-4 text-muted-foreground" aria-hidden />
                          ) : linkedTag ? (
                            <TagIcon name={linkedTag.icon} className="size-4 text-note-icon" />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </FilterTabView>
        </AnimatePresence>
      </FilterTabContents>
      <LayoutGroup id={layoutId}>
        <div
          role="tablist"
          aria-label="Filter type"
          className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/5 p-1"
          onKeyDown={(event) => {
            const next =
              event.key === 'Home'
                ? 'colors'
                : event.key === 'End'
                  ? 'tags'
                  : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                    ? tab === 'colors'
                      ? 'tags'
                      : 'colors'
                    : null;
            if (!next) return;
            event.preventDefault();
            selectTab(next);
            document.getElementById(`search-filter-tab-${next}`)?.focus();
          }}
        >
          {(['colors', 'tags'] as const).map((value) => (
            <button
              key={value}
              id={`search-filter-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls={`search-filter-view-${value}`}
              tabIndex={tab === value ? 0 : -1}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectTab(value)}
              className="relative flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tab === value && (
                <motion.span
                  layoutId="filter-tab"
                  aria-hidden
                  className="absolute inset-0 rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]"
                  transition={springs.snappy}
                />
              )}
              {value === 'colors' ? (
                <Palette className="relative size-4" aria-hidden />
              ) : (
                <Tags className="relative size-4" aria-hidden />
              )}
              <span className="relative">{value === 'colors' ? 'Colors' : 'Tags'}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}

export function ActiveSearchFilters({
  tags,
  filter,
  color,
  onFilterChange,
  onColorChange,
}: {
  tags: readonly Tag[];
  filter: TagSearchFilter;
  color: NoteColor | null;
  onFilterChange: (filter: TagSearchFilter) => void;
  onColorChange: (color: NoteColor | null) => void;
}) {
  const filtered = filter.ids.length > 0 || filter.untagged || color !== null;
  function toggleTag(id: string) {
    haptics.selection();
    onFilterChange({ ...filter, ids: filter.ids.filter((value) => value !== id) });
  }
  return (
    <>
      {filtered && (
        <fieldset aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {filter.ids.map((id) => {
            const tag = tags.find((item) => item.id === id);
            return tag ? (
              <span key={id} className="flex items-center gap-0.5">
                <TagBadge tag={tag} tags={tags} />
                <button
                  type="button"
                  aria-label={`Remove ${tag.name} filter`}
                  className="flex size-9 items-center justify-center rounded-full outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => toggleTag(id)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ) : null;
          })}
          {filter.untagged && (
            <button
              type="button"
              className={control}
              onClick={() => onFilterChange({ ...filter, untagged: false })}
              aria-label="Remove Untagged filter"
            >
              Untagged
              <X className="size-3.5" aria-hidden />
            </button>
          )}
          {color !== null && (
            <button
              type="button"
              className={control}
              onClick={() => onColorChange(null)}
              aria-label="Remove color filter"
            >
              <span
                data-note-color={color}
                className="flex size-5 items-center justify-center rounded-full border border-foreground/15 bg-note"
              >
                {color === 'default' && <Slash className="size-3" aria-hidden />}
              </span>
              {COLOR_NAMES[color]}
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </fieldset>
      )}
    </>
  );
}

export function BrowseTags({
  tags,
  counts,
  untaggedCount,
  onSelect,
  onUntagged,
}: {
  tags: readonly Tag[];
  counts: ReadonlyMap<string, number>;
  untaggedCount: number;
  onSelect: (id: string) => void;
  onUntagged: () => void;
}) {
  const roots = tags
    .filter((tag) => tag.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-label="Browse tags">
      <h2 className="mb-3 px-1 font-medium text-sm">Browse tags</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
        {roots.map((tag) => (
          <button
            key={tag.id}
            type="button"
            data-note-color={tag.color ?? 'default'}
            aria-label={`Browse ${tag.name}`}
            onClick={() => onSelect(tag.id)}
            className="flex min-h-16 min-w-0 items-center gap-3 rounded-2xl border border-foreground/10 bg-note px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TagIcon name={tag.icon} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
            <span className="text-xs text-muted-foreground">{counts.get(tag.id) ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onUntagged}
          aria-label="Browse Untagged"
          className="flex min-h-16 min-w-0 items-center gap-3 rounded-2xl border border-border bg-card/60 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Tags className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-sm font-medium">Untagged</span>
          <span className="text-xs text-muted-foreground">{untaggedCount}</span>
        </button>
      </div>
    </section>
  );
}
