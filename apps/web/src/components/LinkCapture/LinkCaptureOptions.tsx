import {
  BOARD_COLUMNS,
  DEFAULT_BOARD_STATUS,
  normalizeSecondaryTags,
  secondaryTagAncestors,
  tagColor,
  tagPath,
} from '@catch/shared';
import { ChevronDown, Columns3, LayoutDashboard, Palette, Tags } from 'lucide-react';
import { useId, useState } from 'react';
import { COLOR_NAMES, ColorTagSelector } from '@/components/ColorPicker/ColorPicker';
import { NoteMovePicker } from '@/components/NoteMovePicker/NoteMovePicker';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getSignedInUser } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import type { LinkCapturePlacement } from '@/lib/linkCapturePlacement';

const pickerClass =
  'z-[80] top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-1.5rem)] overflow-y-auto overscroll-contain p-4 sm:max-w-sm pointer-coarse:top-auto pointer-coarse:bottom-[calc(var(--keyboard)+var(--safe-bottom)+0.75rem)] pointer-coarse:translate-y-0';

export function LinkCaptureOptions({
  value,
  onChange,
}: {
  value: LinkCapturePlacement;
  onChange: (value: LinkCapturePlacement) => void;
}) {
  const id = useId();
  const [choosingDestination, setChoosingDestination] = useState(false);
  useBackHandler(choosingDestination, () => setChoosingDestination(false));
  const [choosingTags, setChoosingTags] = useState(false);
  useBackHandler(choosingTags, () => setChoosingTags(false));
  const columns = sortBoardColumns(useBoardColumns());
  const destinations = columns.some((column) => column.id === DEFAULT_BOARD_STATUS)
    ? columns
    : [{ ...BOARD_COLUMNS[0], userId: getSignedInUser()?.id ?? '', position: 'a0' }, ...columns];
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
      ? null
      : columns.some((column) => column.id === value.status)
        ? value.status
        : DEFAULT_BOARD_STATUS;
  const destinationName =
    destination === null
      ? 'Gallery'
      : `Deck · ${destinations.find((column) => column.id === destination)?.name}`;
  return (
    <section
      aria-label="Link placement"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <div className="flex flex-col gap-2">
        <label id={`${id}-label`} htmlFor={id} className="font-medium text-sm">
          Save to
        </label>
        <Dialog open={choosingDestination} onOpenChange={setChoosingDestination}>
          <DialogTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="secondary"
              aria-labelledby={`${id}-label ${id}-destination`}
              className="h-11 w-full min-w-0 justify-start rounded-xl border border-input px-3 font-normal text-base"
            >
              {destination === null ? <LayoutDashboard aria-hidden /> : <Columns3 aria-hidden />}
              <span id={`${id}-destination`} className="min-w-0 flex-1 truncate text-left">
                {destinationName}
              </span>
              <ChevronDown aria-hidden />
            </Button>
          </DialogTrigger>
          <DialogContent
            aria-describedby={undefined}
            showCloseButton={false}
            overlayClassName="z-[80]"
            className={pickerClass}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <DialogTitle className="text-base">Save to</DialogTitle>
            <div className="[&_[data-deck-columns]]:max-h-[min(50dvh,max(0px,calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-8rem)))]">
              <NoteMovePicker
                columns={destinations}
                current={destination}
                hovered={undefined}
                onSelect={(status) => {
                  haptics.selection();
                  onChange({ ...value, status });
                  setChoosingDestination(false);
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
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
                // A new capture owns its draft assignments and can use cached tags offline.
                disabled={false}
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
          {primary ? (
            <span className="flex min-w-0">
              <TagBadge tag={primary} tags={tags} primary interactive={false} />
            </span>
          ) : (
            <span
              className="min-w-0 truncate text-sm text-muted-foreground"
              title={COLOR_NAMES[color]}
            >
              {COLOR_NAMES[color]}
            </span>
          )}
        </div>
        <Dialog open={choosingTags} onOpenChange={setChoosingTags}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              aria-label="Choose tags"
              className="h-11 shrink-0 rounded-xl"
            >
              <Tags aria-hidden /> Tags{secondary.length ? ` (${secondary.length})` : ''}
            </Button>
          </DialogTrigger>
          <DialogContent
            aria-describedby={undefined}
            showCloseButton={false}
            overlayClassName="z-[80]"
            className={pickerClass}
            onOpenAutoFocus={(event) => {
              // Let touch users scroll the list before choosing to bring up search.
              if (
                typeof window.matchMedia !== 'function' ||
                !window.matchMedia('(pointer: coarse)').matches
              )
                return;
              event.preventDefault();
              if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <section aria-label="Secondary tags">
              <DialogTitle className="mb-3 text-base">Secondary tags</DialogTitle>
              {awaitingTags && !tags.length ? (
                <p role="status" className="py-3 text-muted-foreground text-sm">
                  Loading tags…
                </p>
              ) : !tags.length ? (
                <p className="py-3 text-muted-foreground text-sm">No tags yet.</p>
              ) : (
                <TagTree
                  tags={tags}
                  className="max-h-[min(20rem,max(0px,calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-13rem)))]"
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
            <DialogClose asChild>
              <Button type="button" className="h-11 rounded-xl">
                Done
              </Button>
            </DialogClose>
          </DialogContent>
        </Dialog>
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
