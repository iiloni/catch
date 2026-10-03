import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { useNoteTagAssignments, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { setSecondaryTag } from '@/lib/tags';

export function TagPicker({ noteId }: { noteId: string }) {
  const tags = useTags();
  const assignment = useNoteTagAssignments().get(noteId);
  const ancestors = useMemo(
    () => secondaryTagAncestors(tags, assignment?.secondaryTagIds ?? []),
    [tags, assignment],
  );
  return (
    <section aria-label="Secondary tags" className="px-3 pt-3 pb-1">
      <p className="mb-2 text-sm font-medium">Secondary tags</p>
      {!tags.length ? (
        <p className="py-3 text-sm text-muted-foreground">Create tags in Settings → Tags.</p>
      ) : (
        <TagTree
          tags={tags}
          searchPosition="bottom"
          className="max-h-[min(22rem,45dvh,calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-7rem))]"
          renderTag={(tag, path) => {
            const root = path[0];
            const primary = assignment?.primaryTagId === tag.id;
            const descendant = tags.find((item) => item.id === ancestors.get(tag.id));
            const reason = descendant ? `${descendant.name} is already assigned` : undefined;
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
                  checked={primary || (assignment?.secondaryTagIds.includes(tag.id) ?? false)}
                  disabled={primary || !!descendant}
                  aria-describedby={!primary && reason ? `tag-reason-${tag.id}` : undefined}
                  onChange={(event) => {
                    haptics.selection();
                    setSecondaryTag(noteId, tag.id, event.target.checked);
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

import { secondaryTagAncestors } from '@catch/shared';
import { useMemo } from 'react';
