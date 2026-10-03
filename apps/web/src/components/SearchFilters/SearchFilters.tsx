import { NOTE_COLORS, type NoteColor, type Tag } from '@catch/shared';
import { Palette, Slash, Tags, X } from 'lucide-react';
import { motion, useIsPresent } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { COLOR_NAMES } from '@/components/ColorPicker/ColorPicker';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
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
          className="glass pointer-events-auto relative flex max-h-[calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-1.5rem)] w-full max-w-md flex-col gap-2 overflow-auto overscroll-contain rounded-[var(--dock-radius)] p-3"
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

export function SearchFilters({
  tags,
  filter,
  color,
  counts,
  untaggedCount,
  onFilterChange,
  onColorChange,
}: {
  tags: readonly Tag[];
  filter: TagSearchFilter;
  color: NoteColor | null;
  counts: ReadonlyMap<string, number>;
  untaggedCount: number;
  onFilterChange: (filter: TagSearchFilter) => void;
  onColorChange: (color: NoteColor | null) => void;
}) {
  const selected = new Set(filter.ids);
  function toggleTag(id: string) {
    haptics.selection();
    onFilterChange({
      ...filter,
      untagged: false,
      ids: selected.has(id) ? filter.ids.filter((value) => value !== id) : [...filter.ids, id],
    });
  }
  return (
    <div className="flex shrink-0 flex-col gap-3">
      <section aria-labelledby="search-tags-heading" className="flex flex-col">
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
        {tags.length ? (
          <TagTree
            tags={tags}
            searchPosition="bottom"
            className="max-h-[clamp(6rem,calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-26rem),16rem)]"
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
                <span className="text-xs text-muted-foreground">{counts.get(tag.id) ?? 0}</span>
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
          <p className="py-2 text-sm text-muted-foreground">Create tags in Settings → Tags.</p>
        )}
        <label className="mt-2 flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm hover:bg-foreground/5">
          <Tags className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">Untagged</span>
          <span className="text-xs text-muted-foreground">{untaggedCount}</span>
          <input
            type="checkbox"
            checked={filter.untagged}
            onChange={() => onFilterChange({ ...filter, ids: [], untagged: !filter.untagged })}
            className="size-4 accent-brand"
          />
        </label>
      </section>
      <section
        aria-labelledby="search-colors-heading"
        className="shrink-0 border-t border-foreground/10 pt-3"
      >
        <h3 id="search-colors-heading" className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Palette className="size-4 text-muted-foreground" aria-hidden />
          Colors
        </h3>
        <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
          {NOTE_COLORS.map((value) => {
            const linkedTag = tags.find((tag) => tag.parentId === null && tag.color === value);
            return (
              <button
                key={value}
                type="button"
                aria-label={COLOR_NAMES[value]}
                aria-pressed={color === value}
                title={linkedTag ? `${COLOR_NAMES[value]}: ${linkedTag.name}` : COLOR_NAMES[value]}
                onClick={() => {
                  haptics.selection();
                  onColorChange(color === value ? null : value);
                }}
                className="flex h-11 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  data-note-color={value}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border bg-note',
                    color === value
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
      </section>
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
