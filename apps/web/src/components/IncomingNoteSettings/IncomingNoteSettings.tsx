import {
  DEFAULT_BOARD_STATUS,
  normalizeSecondaryTags,
  secondaryTagAncestors,
  tagColor,
} from '@catch/shared';
import { COLOR_NAMES, ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { useIncomingNoteDefaults } from '@/lib/incomingNoteDefaults';

export function IncomingNoteSettings() {
  const columns = sortBoardColumns(useBoardColumns());
  const tags = useTags();
  const { awaitingTags } = useTagReadiness();
  const [defaults, setDefaults] = useIncomingNoteDefaults();
  const destination = defaults.status;
  const primary =
    tags.find((tag) => tag.id === defaults.primaryTagId) ??
    tags.find((tag) => tag.color === defaults.color);
  const color = primary ? tagColor(tags, primary.id) : defaults.color;
  const secondary = normalizeSecondaryTags(
    tags,
    defaults.secondaryTagIds.filter(
      (id) => id !== primary?.id && tags.some((tag) => tag.id === id),
    ),
  );
  const ancestors = secondaryTagAncestors(tags, secondary);
  const current =
    destination === null
      ? ''
      : columns.some((column) => column.id === destination)
        ? destination
        : DEFAULT_BOARD_STATUS;

  return (
    <SettingsSection
      title="Incoming notes"
      description="Defaults for bookmarklet captures and shares from other apps. Saved for this account on this device. Deleted columns fall back to the default Deck column; deleted tags are skipped."
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <label htmlFor="incoming-note-destination" className="font-medium">
          Save incoming notes to
        </label>
        <select
          id="incoming-note-destination"
          value={current}
          onChange={(event) => {
            haptics.selection();
            setDefaults({ ...defaults, status: event.target.value || null });
          }}
          className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      <SettingsRow label="Color / primary tag" description={primary?.name ?? COLOR_NAMES[color]}>
        <ColorPicker
          value={color}
          primaryTagId={primary?.id}
          onChange={(color) => setDefaults({ ...defaults, color, primaryTagId: null })}
          onTagChange={(id) =>
            setDefaults({
              ...defaults,
              color: 'default',
              primaryTagId: id,
              secondaryTagIds: secondary.filter((tagId) => tagId !== id),
            })
          }
        />
      </SettingsRow>
      <section aria-label="Incoming secondary tags" className="px-4 py-3">
        <h3 className="mb-2 font-medium">Secondary tags</h3>
        {awaitingTags ? (
          <p role="status" className="text-muted-foreground text-sm">
            Loading tags…
          </p>
        ) : !tags.length ? (
          <p className="text-muted-foreground text-sm">
            Create tags in Settings → Tags to choose defaults.
          </p>
        ) : (
          <TagTree
            tags={tags}
            className="max-h-64"
            renderTag={(tag, path) => {
              const isPrimary = tag.id === primary?.id;
              const descendant = ancestors.get(tag.id);
              return (
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-foreground/5 has-disabled:cursor-default">
                  <span data-note-color={path[0]?.color ?? 'default'} className="text-note-icon">
                    <TagIcon name={path[0]?.icon} className="size-4 shrink-0" />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-sm"
                    title={path.map((tag) => tag.name).join(' / ')}
                  >
                    {tag.name}
                  </span>
                  {isPrimary && <span className="text-muted-foreground text-xs">Primary</span>}
                  {descendant && (
                    <span className="text-muted-foreground text-xs">
                      More specific tag selected
                    </span>
                  )}
                  <input
                    type="checkbox"
                    aria-label={path.map((tag) => tag.name).join(' / ')}
                    checked={isPrimary || secondary.includes(tag.id)}
                    disabled={isPrimary || Boolean(descendant)}
                    onChange={(event) => {
                      haptics.selection();
                      const others = secondary.filter((id) => id !== tag.id);
                      setDefaults({
                        ...defaults,
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
    </SettingsSection>
  );
}
