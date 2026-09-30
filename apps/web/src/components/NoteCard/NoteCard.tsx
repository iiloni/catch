import { attachmentUrl, type Note } from '@catch/shared';
import { Pin } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { LinkNoteFace } from '@/components/LinkPreviewCard/LinkPreviewCard';
import { LinkUnderlay } from '@/components/LinkUnderlay/LinkUnderlay';
import { MediaPreview } from '@/components/MediaPreview/MediaPreview';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteToolbar } from '@/components/NoteToolbar/NoteToolbar';
import { useNoteAttachments } from '@/lib/attachments';
import { openLinkOverlay, useIsLinkNote, useNoteLinks } from '@/lib/linkPreviews';
import { springs } from '@/lib/motion';
import { setNotePinned } from '@/lib/notes';
import { useIsCardHidden, useIsCardLanding } from '@/lib/noteTransition';
import { paneNoteId } from '@/lib/splitView';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  /** Receives the card element, which the editor grows out of. */
  onOpen?: (note: Note, card: HTMLElement) => void;
  /** Hide actions, e.g. while the card is being dragged. */
  withActions?: boolean;
  /** Keep desktop hover styling while a dragged card settles into place. */
  forceHover?: boolean;
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

/**
 * A card's contents: the note's text, or for a note that is only a link, that link's
 * preview. The editor draws the same face while it grows out of the card.
 */
export function NoteCardFace({ note }: { note: Note }) {
  const links = useNoteLinks(note);
  const [link] = links;
  if (useIsLinkNote(note, links) && link) {
    return <LinkNoteFace link={link} tinted={note.color === 'default'} />;
  }
  if (note.content.length === 0) return <MediaOnlyFace note={note} />;
  return (
    <div className="px-3.5 pt-3 pb-3.5">
      <NotePreview content={note.content} className={cn(note.isPinned && 'pr-5')} />
    </div>
  );
}

function MediaOnlyFace({ note }: { note: Note }) {
  const files = useNoteAttachments(note.id);
  const first = files[0];
  if (!first) return <NotePreview content={note.content} />;
  return (
    <div className={cn('flex min-w-0 items-center gap-3 p-2', note.isPinned && 'pr-8')}>
      <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-foreground/5">
        <MediaPreview url={attachmentUrl(first.id)} name={first.name} kind={first.kind} thumbnail />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{first.name}</p>
        <p className="text-xs text-muted-foreground">
          {files.length === 1 ? 'Attachment' : `${files.length} attachments`}
        </p>
      </div>
    </div>
  );
}

export function NoteCard({
  note,
  onOpen,
  withActions = true,
  forceHover = false,
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
  const links = useNoteLinks(note);
  // A note that is only a link shows it on its face; any other note lists links underneath.
  const underlay = !useIsLinkNote(note, links) && links.length > 0;

  // A note shrinking back into its card lands without the underlay, which slides out from
  // behind the card as the note settles, as if the card were setting it down.
  const landing = useIsCardLanding(note.id);
  const underlayHidden = hidden && !landing;
  const underlayRef = useRef<HTMLDivElement>(null);
  const underlayY = useMotionValue(0);
  const wasHidden = useRef(underlayHidden);
  useLayoutEffect(() => {
    const element = underlayRef.current;
    if (wasHidden.current && !underlayHidden && element) {
      // The wrapper holds only the strip below the card; the underlay's top already tucks under.
      underlayY.set(-element.offsetHeight);
      void animate(underlayY, 0, springs.smooth);
    }
    wasHidden.current = underlayHidden;
  }, [underlayHidden, underlayY]);

  const card = (
    <motion.article
      data-note-card={note.id}
      data-note-color={note.color}
      aria-label={note.deletedAt ? 'Trashed note' : 'Note'}
      // Keep the gesture mounted: removing it mid-press would leave the card shrunk.
      whileTap={{ scale: pressable ? 0.97 : 1 }}
      transition={springs.snappy}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-transparent bg-note text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)] transition-shadow hover:shadow-md data-[note-color=default]:border-border',
        forceHover && 'shadow-md',
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
              (forceHover
                ? 'pointer-coarse:hidden'
                : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:hidden'),
          )}
        >
          <Pin className={cn(note.isPinned && 'fill-current')} />
        </IconButton>
      )}
      {actions && (
        <NoteToolbar
          note={note}
          className={cn(
            'px-2 pb-1 transition-opacity pointer-coarse:hidden',
            forceHover
              ? 'opacity-100'
              : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
          )}
        />
      )}
    </motion.article>
  );

  if (!underlay) return card;
  return (
    // Isolated so the underlay can sit behind the card without going behind the page.
    <div className="isolate flex flex-col">
      {card}
      <motion.div
        ref={underlayRef}
        className={cn('-z-10 relative flex flex-col', underlayHidden && 'invisible')}
        style={{ y: underlayY }}
      >
        <LinkUnderlay
          variant="card"
          links={links}
          color={note.color}
          onOpen={() => {
            if (selecting) onSelect?.(note);
            else openLinkOverlay(note.id);
          }}
        />
      </motion.div>
    </div>
  );
}
