import type { Note } from '@catch/shared';
import { Pin } from 'lucide-react';
import { IconButton } from '@/components/IconButton/IconButton';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteToolbar } from '@/components/NoteToolbar/NoteToolbar';
import { setNotePinned } from '@/lib/notes';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  onOpen?: (note: Note) => void;
  /** Hide actions, e.g. while the card is being dragged. */
  withActions?: boolean;
  className?: string;
};

export function NoteCard({ note, onOpen, withActions = true, className }: Props) {
  const canPin = withActions && !note.deletedAt && !note.isArchived;

  return (
    <article
      data-note-color={note.color}
      aria-label={note.deletedAt ? 'Trashed note' : 'Note'}
      className={cn(
        'group relative flex flex-col rounded-lg border bg-note text-card-foreground shadow-xs transition-shadow hover:shadow-md',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(note)}
        className="min-h-12 cursor-pointer rounded-lg px-4 pt-3 pb-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Open note"
      >
        <NotePreview content={note.content} className={cn(canPin && 'pr-6')} />
      </button>
      {canPin && (
        <IconButton
          label={note.isPinned ? 'Unpin' : 'Pin'}
          onClick={() => setNotePinned(note.id, !note.isPinned)}
          className={cn(
            'absolute top-1.5 right-1.5',
            !note.isPinned &&
              'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          <Pin className={cn(note.isPinned && 'fill-current')} />
        </IconButton>
      )}
      {withActions && (
        <NoteToolbar
          note={note}
          className="px-2 pb-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:hidden"
        />
      )}
    </article>
  );
}
