import { attachmentUrl, type Note } from '@catch/shared';
import { Pin } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useLayoutEffect, useReducer, useRef } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { LinkNoteFace } from '@/components/LinkPreviewCard/LinkPreviewCard';
import { LinkUnderlay } from '@/components/LinkUnderlay/LinkUnderlay';
import { MediaPreview } from '@/components/MediaPreview/MediaPreview';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteShareBadge } from '@/components/NoteShareBadge/NoteShareBadge';
import { NoteTags } from '@/components/NoteTags/NoteTags';
import { NoteToolbar } from '@/components/NoteToolbar/NoteToolbar';
import { ReminderChip } from '@/components/ReminderChip/ReminderChip';
import { useNoteAttachments } from '@/lib/attachments';
import { useReminders } from '@/lib/collections';
import { galleryPreviewLink, openLinkOverlay, useNoteLinks } from '@/lib/linkPreviews';
import { springs } from '@/lib/motion';
import { setNotePinned } from '@/lib/notes';
import { useIsCardHidden, useIsCardLanding } from '@/lib/noteTransition';
import { paneNoteId } from '@/lib/splitView';
import { useNoteColor, useResolvedNoteTags } from '@/lib/tags';
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
 * A card's contents: the note's text, or its explicitly chosen link's
 * preview. The editor draws the same face while it grows out of the card.
 */
export function NoteCardFace({ note }: { note: Note }) {
  const tagged = useResolvedNoteTags(note.id).length > 0;
  return (
    <>
      <NoteCardContent note={note} />
      <NoteBadges note={note} />
      <NoteTags noteId={note.id} className="px-3.5 pb-3" interactive={false} />
      {tagged && note.content.length === 0 && <MediaOnlyFace note={note} />}
    </>
  );
}

/** Card metadata shares one row and wraps when the card is too narrow. */
function NoteBadges({ note }: { note: Note }) {
  const reminder = useReminders().get(note.id);
  return (
    <div className="pointer-events-none flex flex-wrap items-center gap-2 px-3.5 pb-3 empty:hidden">
      {reminder && !note.deletedAt && <ReminderChip reminder={reminder} />}
      <NoteShareBadge note={note} className="min-w-0 max-w-full" />
    </div>
  );
}

function NoteCardContent({ note }: { note: Note }) {
  const links = useNoteLinks(note);
  const link = galleryPreviewLink(note, links);
  const color = useNoteColor(note);
  const tagged = useResolvedNoteTags(note.id).length > 0;
  if (link) {
    return <LinkNoteFace link={link} tinted={color === 'default'} />;
  }
  if (note.content.length === 0 && !tagged) return <MediaOnlyFace note={note} />;
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
      <div className="size-16 shrink-0 overflow-hidden rounded-xl">
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

/** Touch screens hide a card's actions (`pointer-coarse:hidden`), so they are never built there. */
const hidesActions = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

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
  const color = useNoteColor(note);
  const tagged = useResolvedNoteTags(note.id).length > 0;
  const selecting = selected !== undefined;
  const actions = withActions && !selecting;
  const canPin = actions && !note.deletedAt && !note.isArchived;
  // The actions stay hidden until a pointer hovers the card or focus enters it, so they
  // (and their tooltips) are only built then; a grid of thousands of cards need not.
  const [armed, arm] = useReducer(() => true, false);
  // A card dropped from a drag is still under the pointer once it stops forcing hover.
  if (forceHover && !armed) arm();
  const revealed = armed || forceHover;
  const hidden = useIsCardHidden(note.id);
  const openBeside = paneNoteId.use() === note.id;
  const links = useNoteLinks(note);
  const face = galleryPreviewLink(note, links);
  // A chosen link face fills the card edge to edge, so the card ends at the preview:
  // no reserved action row, just a glass dock over the face on hover.
  const linkFace = face !== undefined;
  // Keep the full link list reachable when the face shows one of several links.
  const underlay = (!linkFace || links.length > 1) && links.length > 0;

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
      data-note-color={color}
      onClick={(event) => {
        const control = (event.target as Element).closest('button, input, a, [role="button"]');
        // The draggable wrapper also has a button role; only card controls consume clicks.
        if (control && event.currentTarget.contains(control)) return;
        if (selecting) onSelect?.(note);
        else onOpen?.(note, event.currentTarget);
      }}
      aria-label={note.deletedAt ? 'Trashed note' : 'Note'}
      // Keep the gesture mounted: removing it mid-press would leave the card shrunk.
      whileTap={{ scale: pressable ? 0.97 : 1 }}
      transition={springs.snappy}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') arm();
      }}
      // A tap focuses the card as it opens the note, which is no time to build hidden actions.
      onFocus={() => {
        if (!hidesActions()) arm();
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col rounded-2xl border border-transparent bg-note text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)] transition-shadow hover:shadow-md data-[note-color=default]:border-border',
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
        // The face swaps elements as previews load (a placeholder for its thumbnail), and a
        // press on one that is gone by the release makes no click. The button takes the press.
        className="min-h-12 cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>*]:pointer-events-none"
        aria-label={selecting ? 'Select note' : 'Open note'}
        aria-pressed={selecting ? selected : undefined}
      >
        <NoteCardContent note={note} />
      </button>
      <NoteBadges note={note} />
      <NoteTags noteId={note.id} className="px-3.5 pb-3" />
      {tagged && note.content.length === 0 && <MediaOnlyFace note={note} />}
      <motion.span
        aria-hidden
        className="-inset-px pointer-events-none absolute rounded-2xl border-2 border-foreground"
        initial={false}
        animate={{ opacity: selected ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      />
      {canPin && (note.isPinned || revealed) && (
        <span className="absolute top-1.5 right-1.5 size-7">
          {linkFace && (
            // The pin's own glass backing. It holds constant glass and fades as a
            // unit with opacity, like the dock below it: toggling the glass itself
            // lets its border arrive early and leave late. Never at rest: it only
            // ever shows while hovered (or focused).
            <span
              aria-hidden
              className={cn(
                'glass absolute inset-0 rounded-full transition-opacity duration-200 pointer-coarse:hidden',
                forceHover
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
              )}
            />
          )}
          <IconButton
            label={note.isPinned ? 'Unpin' : 'Pin'}
            onClick={() => setNotePinned(note.id, !note.isPinned)}
            className={cn(
              'relative size-7 [&_svg]:size-3.5',
              // Only pinned notes show the pin on touch; with a mouse it appears on hover.
              !note.isPinned &&
                (forceHover
                  ? 'pointer-coarse:hidden'
                  : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:hidden'),
            )}
          >
            <Pin className={cn(note.isPinned && 'fill-current')} />
          </IconButton>
        </span>
      )}
      {actions && !revealed && !linkFace && (
        // Holds the toolbar's height (its buttons and bottom padding), so the card does not
        // grow when it arrives.
        <div aria-hidden className="h-9 pointer-coarse:hidden" />
      )}
      {actions && revealed && !linkFace && (
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
      {actions && revealed && linkFace && (
        // A glass dock over the face's bottom edge (`glass`, dock radius, `p-1`, as in
        // FloatingToolbar), fading in the moment the card is hovered and out the
        // moment it is left. Over the face rather than below it, so the card ends at
        // the preview. Rounded like the card it floats over, not the screen dock.
        // The pill re-enables pointer events: the wrapper passes them through
        // outside it. `visibility` joins the transition so the faded-out dock
        // never intercepts taps meant to open the note.
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center px-3 pointer-coarse:hidden">
          <NoteToolbar
            note={note}
            className={cn(
              'glass pointer-events-auto max-w-full rounded-2xl p-1 transition-[opacity,visibility] duration-200',
              forceHover
                ? 'visible opacity-100'
                : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
            )}
          />
        </div>
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
          color={color}
          onOpen={() => {
            if (selecting) onSelect?.(note);
            else openLinkOverlay(note.id);
          }}
        />
      </motion.div>
    </div>
  );
}
