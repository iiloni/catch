import type { Note } from '@catch/shared';
import { Link2, Users } from 'lucide-react';
import { useNoteShares } from '@/lib/collections';
import { isSharedNote, useSharedNoteOwner } from '@/lib/sharing';
import { cn } from '@/lib/utils';

type Props = {
  note: Pick<Note, 'id' | 'userId'>;
  className?: string;
};

/**
 * Marks a note that is shared (ADR 0021): someone else's in this gallery says whose it is,
 * and one of the user's own says it has a link. Nothing for any other note.
 */
export function NoteShareBadge({ note, className }: Props) {
  const owner = useSharedNoteOwner(note.id);
  const linked = useNoteShares().has(note.id);
  const theirs = isSharedNote(note);
  if (!theirs && !linked) return null;
  const label = theirs ? (owner ? `Shared by ${owner}` : 'Shared with you') : 'Shared with a link';
  const Icon = theirs ? Users : Link2;
  return (
    <div className={cn('pointer-events-none flex', className)}>
      <span
        data-share-badge
        role="img"
        aria-label={label}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.07] px-2.5 py-1 text-xs"
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{theirs ? (owner ?? 'Shared') : 'Shared'}</span>
      </span>
    </div>
  );
}
