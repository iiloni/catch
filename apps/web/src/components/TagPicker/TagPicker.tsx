import { secondaryTagAncestors } from '@catch/shared';
import { useMemo } from 'react';
import { NewTagButton } from '@/components/TagForm/TagForm';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { useNoteTagAssignments, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { setSecondaryTag } from '@/lib/tags';

type Props = { noteId: string; noteIds?: never } | { noteId?: never; noteIds: readonly string[] };

export function TagPicker({ noteId, noteIds }: Props) {
  const ids = useMemo(() => noteIds ?? [noteId], [noteId, noteIds]);
  const tags = useTags();
  const { awaitingTags, awaitingAssignments } = useTagReadiness();
  const assignments = useNoteTagAssignments();
  const ancestors = useMemo(
    () =>
      new Map(
        ids.map((id) => [
          id,
          secondaryTagAncestors(tags, assignments.get(id)?.secondaryTagIds ?? []),
        ]),
      ),
    [tags, assignments, ids],
  );
  return (
    <section aria-label="Secondary tags" className="px-3 pt-3 pb-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Secondary tags</p>
        <NewTagButton
          disabled={awaitingTags || awaitingAssignments}
          onCreated={(tagId) => {
            for (const id of ids) setSecondaryTag(id, tagId, true);
          }}
        />
      </div>
      {awaitingTags || awaitingAssignments ? (
        <p role="status" className="py-3 text-sm text-muted-foreground">
          Loading tags…
        </p>
      ) : !tags.length ? (
        <p className="py-3 text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <TagTree
          tags={tags}
          searchPosition="bottom"
          // Leave room for the heading, search field and padding within an anchored popover.
          className="max-h-[max(0px,min(22rem,45dvh,calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-8rem),calc(var(--radix-popover-content-available-height,100dvh)-8rem)))]"
          renderTag={(tag, path) => {
            const root = path[0];
            const states = ids.map((id) => {
              const assignment = assignments.get(id);
              return {
                id,
                primary: assignment?.primaryTagId === tag.id,
                selected:
                  assignment?.primaryTagId === tag.id ||
                  (assignment?.secondaryTagIds.includes(tag.id) ?? false),
                descendant: ancestors.get(id)?.get(tag.id),
              };
            });
            const primary = states.every((state) => state.primary);
            const checked = states.every((state) => state.selected);
            const mixed = !checked && states.some((state) => state.selected);
            const disabled = states.every((state) => state.primary || state.descendant);
            const descendant = tags.find((item) => item.id === states[0]?.descendant);
            const reason =
              disabled && !primary
                ? ids.length === 1 && descendant
                  ? `${descendant.name} is already assigned`
                  : 'Primary or more specific tags are already assigned'
                : undefined;
            return (
              <label
                title={reason}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-foreground/5 has-disabled:cursor-default"
              >
                <span
                  data-note-color={root?.color ?? 'default'}
                  className={root?.color ? 'text-note-icon' : 'text-muted-foreground'}
                >
                  <TagIcon name={root?.icon} className="size-4 shrink-0" />
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  title={path.map((item) => item.name).join(' / ')}
                >
                  <span className="block truncate">{tag.name}</span>
                  {!primary && reason && (
                    <span
                      id={`tag-reason-${tag.id}`}
                      className="block truncate text-[0.6875rem] text-muted-foreground"
                    >
                      {reason}
                    </span>
                  )}
                </span>
                {primary && <span className="text-xs text-muted-foreground">Primary</span>}
                <input
                  type="checkbox"
                  aria-label={path.map((item) => item.name).join(' / ')}
                  checked={checked}
                  ref={(input) => {
                    if (input) input.indeterminate = mixed;
                  }}
                  disabled={disabled}
                  aria-describedby={!primary && reason ? `tag-reason-${tag.id}` : undefined}
                  onChange={(event) => {
                    haptics.selection();
                    for (const state of states) {
                      // Keep primary assignments and more specific secondary tags intact.
                      if (
                        state.primary ||
                        state.descendant ||
                        state.selected === event.target.checked
                      )
                        continue;
                      setSecondaryTag(state.id, tag.id, event.target.checked);
                    }
                  }}
                  className="size-4 shrink-0 accent-brand"
                />
              </label>
            );
          }}
        />
      )}
    </section>
  );
}
