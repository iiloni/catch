import { NOTE_COLORS, type NoteColor, type Tag } from '@catch/shared';
import { ChevronDown, Palette, Slash, Tags, X } from 'lucide-react';
import { useState } from 'react';
import { COLOR_NAMES } from '@/components/ColorPicker/ColorPicker';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { haptics } from '@/lib/haptics';
import type { TagSearchFilter } from '@/lib/tagSearch';
import { cn } from '@/lib/utils';

const control =
  'flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring';

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
  const [panel, setPanel] = useState<'tags' | 'colors' | null>(null);
  const selected = new Set(filter.ids);
  function toggleTag(id: string) {
    haptics.selection();
    onFilterChange({
      ...filter,
      untagged: false,
      ids: selected.has(id) ? filter.ids.filter((value) => value !== id) : [...filter.ids, id],
    });
  }
  const filtered = filter.ids.length > 0 || filter.untagged || color !== null;
  return (
    <section aria-label="Search filters" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-card/60 p-1">
        <button
          type="button"
          className={cn(control, panel === 'tags' && 'bg-foreground/5')}
          aria-expanded={panel === 'tags'}
          aria-controls="search-tag-tree"
          onClick={() => setPanel(panel === 'tags' ? null : 'tags')}
        >
          <Tags className="size-4" aria-hidden />
          Tags
          {filter.ids.length > 0 && (
            <span className="text-muted-foreground">{filter.ids.length}</span>
          )}
          <ChevronDown
            className={cn('size-3.5 transition-transform', panel === 'tags' && 'rotate-180')}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className={cn(control, panel === 'colors' && 'bg-foreground/5')}
          aria-expanded={panel === 'colors'}
          aria-controls="search-colors"
          onClick={() => setPanel(panel === 'colors' ? null : 'colors')}
        >
          <Palette className="size-4" aria-hidden />
          Colors
          <ChevronDown
            className={cn('size-3.5 transition-transform', panel === 'colors' && 'rotate-180')}
            aria-hidden
          />
        </button>
        {filtered && (
          <button
            type="button"
            className={cn(control, 'ml-auto text-muted-foreground')}
            onClick={() => {
              onFilterChange({ ids: [], match: 'any', untagged: false });
              onColorChange(null);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {panel === 'tags' && (
        <div id="search-tag-tree" className="rounded-2xl border border-border bg-card/60 p-3">
          <p className="mb-3 text-xs text-muted-foreground">
            Includes primary tags, secondary tags and descendants.
          </p>
          {tags.length ? (
            <TagTree
              tags={tags}
              className="max-h-[min(24rem,40dvh)]"
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
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-t border-border px-2 text-sm">
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
        </div>
      )}
      {panel === 'colors' && (
        <fieldset
          id="search-colors"
          className="flex flex-wrap gap-1 rounded-2xl border border-border bg-card/60 p-3"
        >
          <legend className="sr-only">Filter by color</legend>
          {NOTE_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={COLOR_NAMES[value]}
              aria-pressed={color === value}
              title={COLOR_NAMES[value]}
              onClick={() => {
                haptics.selection();
                onColorChange(color === value ? null : value);
              }}
              className="flex size-11 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                {value === 'default' && (
                  <Slash className="size-4 text-muted-foreground" aria-hidden />
                )}
              </span>
            </button>
          ))}
        </fieldset>
      )}
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
    </section>
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
