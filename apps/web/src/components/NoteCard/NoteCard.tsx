import type { Note } from '@catch/shared';
import { Pin } from 'lucide-react';
import { motion } from 'motion/react';
import { IconButton } from '@/components/IconButton/IconButton';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteToolbar } from '@/components/NoteToolbar/NoteToolbar';
import { springs } from '@/lib/motion';
import { setNotePinned } from '@/lib/notes';
import { useIsCardHidden } from '@/lib/noteTransition';
import { paneNoteId } from '@/lib/splitView';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  /** Receives the card element, which the editor grows out of. */
  onOpen?: (note: Note, card: HTMLElement) => void;
  /** Hide actions, e.g. while the card is being dragged. */
  withActions?: boolean;
  /** Shrink slightly while pressed. Off while the card is lifted to be dragged. */
  pressable?: boolean;
  /**
   * Set while notes are being selected: a tap then toggles the note through `onSelect`
   * instead of opening it, and the card's own actions step aside.
   */
  selected?: boolean;
  onSelect?: (note: Note) => void;
  className?: string;
};

/** A card's contents. The editor draws the same face while it grows out of the card. */
export function NoteCardFace({ note }: { note: Note }) {
  return (
    <div className="px-3.5 pt-3 pb-3.5">
      <NotePreview content={note.content} className={cn(note.isPinned && 'pr-5')} />
    </div>
  );
}

export function NoteCard({
  note,
  onOpen,
  withActions = true,
  pressable = true,
  selected,
  onSelect,
  className,
}: Props) {
  const selecting = selected !== undefined;
  const actions = withActions && !selecting;
  const canPin = actions && !note.deletedAt && !note.isArchived;
  const hidden = useIsCardHidden(note.id);
  const openBeside = paneNoteId.use() === note.id;

  return (
    <motion.article
      data-note-card={note.id}
      data-note-color={note.color}
      aria-label={note.deletedAt ? 'Trashed note' : 'Note'}
      // Keep the gesture mounted: removing it mid-press would leave the card shrunk.
      whileTap={{ scale: pressable ? 0.97 : 1 }}
      transition={springs.snappy}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-transparent bg-note text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)] transition-shadow hover:shadow-md data-[note-color=default]:border-border',
        hidden && 'invisible',
        openBeside && 'ring-2 ring-brand ring-inset',
        className,
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          if (selecting) {
            onSelect?.(note);
            return;
          }
          const card = event.currentTarget.closest('article');
          if (card) onOpen?.(note, card);
        }}
        className="min-h-12 cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={selecting ? 'Select note' : 'Open note'}
        aria-pressed={selecting ? selected : undefined}
      >
        <NoteCardFace note={note} />
      </button>
      <motion.span
        aria-hidden
        className="-inset-px pointer-events-none absolute rounded-2xl border-2 border-foreground"
        initial={false}
        animate={{ opacity: selected ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      />
      {canPin && (
        <IconButton
          label={note.isPinned ? 'Unpin' : 'Pin'}
          onClick={() => setNotePinned(note.id, !note.isPinned)}
          className={cn(
            'absolute top-1.5 right-1.5 size-7 [&_svg]:size-3.5',
            // Only pinned notes show the pin on touch; with a mouse it appears on hover.
            !note.isPinned &&
              'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:hidden',
          )}
        >
          <Pin className={cn(note.isPinned && 'fill-current')} />
        </IconButton>
      )}
      {actions && (
        <NoteToolbar
          note={note}
          className="px-2 pb-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:hidden"
        />
      )}
    </motion.article>
  );
}
