import {
  DEFAULT_BOARD_STATUS,
  normalizeSecondaryTags,
  secondaryTagAncestors,
  tagColor,
  tagPath,
} from '@catch/shared';
import { Palette, Tags } from 'lucide-react';
import { useId } from 'react';
import { COLOR_NAMES, ColorTagSelector } from '@/components/ColorPicker/ColorPicker';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import type { LinkCapturePlacement } from '@/lib/linkCapturePlacement';

export function LinkCaptureOptions({
  value,
  onChange,
}: {
  value: LinkCapturePlacement;
  onChange: (value: LinkCapturePlacement) => void;
}) {
  const id = useId();
  const columns = sortBoardColumns(useBoardColumns());
  const tags = useTags();
  const { awaitingTags } = useTagReadiness();
  const primary =
    tags.find((tag) => tag.id === value.primaryTagId) ??
    tags.find((tag) => tag.color === value.color);
  const color = primary ? tagColor(tags, primary.id) : value.color;
  const secondary = normalizeSecondaryTags(
    tags,
    value.secondaryTagIds.filter((id) => id !== primary?.id && tags.some((tag) => tag.id === id)),
  );
  const ancestors = secondaryTagAncestors(tags, secondary);
  const destination =
    value.status === null
      ? ''
      : columns.some((column) => column.id === value.status)
        ? value.status
        : DEFAULT_BOARD_STATUS;
  return (
    <section
      aria-label="Link placement"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="font-medium text-sm">
          Save to
        </label>
        <select
          id={id}
          value={destination}
          onChange={(event) => {
            haptics.selection();
            onChange({ ...value, status: event.target.value || null });
          }}
          className="h-11 w-full min-w-0 rounded-xl border border-input bg-foreground/[0.03] px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">Gallery</option>
          <optgroup label="Deck">
            {!columns.some((column) => column.id === DEFAULT_BOARD_STATUS) && (
              <option value={DEFAULT_BOARD_STATUS}>Deck · New</option>
            )}
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                Deck · {column.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                aria-label="Background color"
                className="size-11 shrink-0 rounded-xl"
              >
                <Palette aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="z-[80] w-auto rounded-3xl p-3">
              <ColorTagSelector
                value={color}
                primaryTagId={primary?.id}
                onChange={(color) => onChange({ ...value, color, primaryTagId: null })}
                onTagChange={(id) =>
                  onChange({
                    ...value,
                    color: 'default',
                    primaryTagId: id,
                    secondaryTagIds: secondary.filter((tagId) => tagId !== id),
                  })
                }
              />
            </PopoverContent>
          </Popover>
          <span
            className="min-w-0 truncate text-sm text-muted-foreground"
            title={
              primary
                ? tagPath(tags, primary.id)
                    .map((tag) => tag.name)
                    .join(' / ')
                : COLOR_NAMES[color]
            }
          >
            {primary?.name ?? COLOR_NAMES[color]}
          </span>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              aria-label="Choose tags"
              className="h-11 shrink-0 rounded-xl"
            >
              <Tags aria-hidden /> Tags{secondary.length ? ` (${secondary.length})` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="z-[80] w-80 max-w-[calc(100vw-2rem)] rounded-3xl p-3">
            <section aria-label="Secondary tags">
              <h3 className="mb-2 font-medium text-sm">Secondary tags</h3>
              {awaitingTags ? (
                <p role="status" className="py-3 text-muted-foreground text-sm">
                  Loading tags…
                </p>
              ) : !tags.length ? (
                <p className="py-3 text-muted-foreground text-sm">No tags yet.</p>
              ) : (
                <TagTree
                  tags={tags}
                  className="max-h-[min(20rem,40dvh)]"
                  renderTag={(tag, path) => {
                    const isPrimary = tag.id === primary?.id;
                    const descendant = ancestors.get(tag.id);
                    return (
                      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-foreground/5 has-disabled:cursor-default">
                        <span
                          data-note-color={path[0]?.color ?? 'default'}
                          className="text-note-icon"
                        >
                          <TagIcon name={path[0]?.icon} className="size-4 shrink-0" />
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-sm"
                          title={path.map((tag) => tag.name).join(' / ')}
                        >
                          {tag.name}
                        </span>
                        {isPrimary && (
                          <span className="text-muted-foreground text-xs">Primary</span>
                        )}
                        <input
                          type="checkbox"
                          aria-label={path.map((tag) => tag.name).join(' / ')}
                          checked={isPrimary || secondary.includes(tag.id)}
                          disabled={isPrimary || Boolean(descendant)}
                          title={descendant ? 'A more specific tag is selected' : undefined}
                          onChange={(event) => {
                            haptics.selection();
                            const others = secondary.filter((id) => id !== tag.id);
                            onChange({
                              ...value,
                              secondaryTagIds: normalizeSecondaryTags(
                                tags,
                                event.target.checked ? [...others, tag.id] : others,
                              ),
                            });
                          }}
                          className="size-4 shrink-0 accent-brand"
                        />
                      </label>
                    );
                  }}
                />
              )}
            </section>
          </PopoverContent>
        </Popover>
      </div>
      {secondary.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {secondary
            .map((id) =>
              tagPath(tags, id)
                .map((tag) => tag.name)
                .join(' / '),
            )
            .join(', ')}
        </p>
      )}
    </section>
  );
}
