import { TagBadge } from '@/components/TagBadge/TagBadge';
import { useNoteTagAssignments, useTags } from '@/lib/collections';
import { cn } from '@/lib/utils';

export function NoteTags({ noteId, className }: { noteId: string; className?: string }) {
  const tags = useTags();
  const assignment = useNoteTagAssignments().get(noteId);
  const primary = tags.find((tag) => tag.id === assignment?.primaryTagId);
  const secondary =
    assignment?.secondaryTagIds.flatMap((id) => {
      const tag = tags.find((tag) => tag.id === id);
      return tag && id !== primary?.id ? [tag] : [];
    }) ?? [];
  if (!primary && !secondary.length) return null;
  return (
    <section aria-label="Tags" className={cn('min-w-0', className)}>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Tags</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {primary && <TagBadge tag={primary} tags={tags} primary />}
        {secondary.map((tag) => (
          <TagBadge key={tag.id} tag={tag} tags={tags} />
        ))}
      </div>
    </section>
  );
}
