import type { Note } from '@catch/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { ChevronLeft, Trash2 } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  usePresence,
  useTransform,
} from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteCardFace } from '@/components/NoteCard/NoteCard';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteLinks } from '@/components/NoteLinks/NoteLinks';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { SaveStatus } from '@/components/SaveStatus/SaveStatus';
import { notesCollection } from '@/lib/collections';
import { editorControls, editorNote } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { useNoteLinks } from '@/lib/linkPreviews';
import { curves, springs } from '@/lib/motion';
import { deleteNoteForever, discardIfEmpty, trashNote } from '@/lib/notes';
import {
  editorProgress,
  hideCard,
  landCard,
  measureCard,
  type Rect,
  showCard,
  takeOrigin,
} from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { GUTTER, type NotePane, paneNoteId, paneReveal, useNotePane } from '@/lib/splitView';
import { useNoteAutosave } from '@/lib/useNoteAutosave';
import { cn } from '@/lib/utils';
import { MAX_DRAG, useSwipeToDismiss } from './useSwipeToDismiss';

type Props = {
  noteId: string | undefined;
};

/**
 * The open note: full screen on phones, a pane beside the page on tablets and unfolded
 * foldables, and a centered panel on other wide screens. In the pane the note is a large card
 * between its toolbars, so it reads as the page's card opened up rather than a second screen. Full screen or as a panel, it grows
 * out of the card that opened it and shrinks back into that card when it closes. As a pane it
 * slides in from the screen's edge, and another note fades in over the one it replaces: the
 * page narrows under the pane, so its cards move and a morph to or from them would chase them.
 */
export function NoteEditorOverlay({ noteId }: Props) {
  const { close } = useOpenNote();
  const { data: matches = [], isReady } = useLiveQuery(
    (q) => q.from({ note: notesCollection }).where(({ note }) => eq(note.id, noteId ?? '')),
    [noteId],
  );
  const note = matches[0];

  // A deleted or unknown note id in the URL closes the editor.
  useEffect(() => {
    if (noteId && isReady && !note) close();
  }, [noteId, isReady, note, close]);

  return (
    <AnimatePresence>
      {note && <EditorSurface key={note.id} note={note} onClose={close} />}
    </AnimatePresence>
  );
}

/** Space the panel leaves above and below itself: the status bar at the top, the dock below. */
type Insets = { top: number; bottom: number };

/**
 * From this width the note's links get a column beside it instead of following its text.
 * Only a pane gets this wide: the centered panel stops at 672 px and phones are narrower.
 */
const SIDE_LINKS_MIN = 700;

/** Space between the panel and the screen's top edge or the dock. */
const PANEL_GAP = 12;

/**
 * How long before the editor finishes settling into its card (in seconds) the card's link
 * underlay starts sliding out, so the two motions overlap rather than queue.
 */
const LAND_EARLY = 0.25;

/** The editor's rectangle: the whole screen on phones, the pane or a centered panel otherwise. */
function targetRect({ split, listWidth, viewport }: NotePane, insets: Insets): Rect {
  if (split) {
    const x = listWidth + GUTTER;
    return { x, y: 0, width: viewport.width - x, height: viewport.height, radius: 0 };
  }
  if (viewport.width < 640) return { x: 0, y: 0, ...viewport, radius: 0 };
  // The panel is centered in the space above the dock, which holds its toolbar, so the note
  // never runs under it.
  const top = insets.top + PANEL_GAP;
  const room = viewport.height - insets.bottom - PANEL_GAP - top;
  const width = Math.min(672, viewport.width - 64);
  const height = Math.min(Math.round(viewport.height * 0.85), 820, room);
  return {
    x: Math.round((viewport.width - width) / 2),
    y: Math.round(top + (room - height) / 2),
    width,
    height,
    radius: 24,
  };
}

/** A CSS length, such as one built from the layout tokens in styles.css, in pixels. */
function cssPixels(length: string) {
  const probe = document.createElement('div');
  probe.style.cssText = `position: fixed; visibility: hidden; height: ${length}`;
  document.body.append(probe);
  const pixels = probe.getBoundingClientRect().height;
  probe.remove();
  return pixels;
}

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

// Switching notes in the pane overlaps two surfaces, one closing and one opening. The newest
// one drives `editorProgress`, which the dock follows.
let leadSurface: object | null = null;
// Panes sliding away. A note opened meanwhile takes the pane over, so they go at once.
const leavingPanes = new Set<() => void>();
/** How long a note takes to fade in over the one it replaces in the pane. */
const SWAP_MS = 250;

function EditorSurface({ note, onClose }: { note: Note; onClose: () => void }) {
  const [isPresent, safeToRemove] = usePresence();
  const [, rerender] = useState(0);
  // The back button, Escape and an outside click can all fire for one close.
  const closing = useRef(false);
  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    onClose();
  };
  const { state, save, flush } = useNoteAutosave(note.id);
  const pane = useNotePane();
  // Leaving for the Deck closes the note on a page that does not split, so a closing note
  // keeps the layout it had: a pane slides away rather than turning into a panel.
  const splitRef = useRef(pane.split);
  if (isPresent) splitRef.current = pane.split;
  const split = splitRef.current;
  const { width: viewportWidth, height: viewportHeight } = pane.viewport;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the insets change with the viewport
  const insets = useMemo(
    () => ({
      top: cssPixels('var(--safe-top)'),
      bottom: cssPixels('calc(var(--dock-height) + var(--dock-rest-bottom))'),
    }),
    [viewportWidth, viewportHeight],
  );
  const target = targetRect({ ...pane, split }, insets);
  const targetRef = useRef(target);
  targetRef.current = target;
  const editable = !note.deletedAt;
  const hasLinks = useNoteLinks(note).length > 0;
  const sideLinks = split && target.width >= SIDE_LINKS_MIN && hasLinks;

  // The dock shows this note's actions (see NoteDock).
  useEffect(() => editorNote.set(note), [note]);
  useEffect(
    () => () => {
      if (editorNote.get()?.id === note.id) editorNote.set(null);
    },
    [note.id],
  );

  useEffect(() => {
    if (!split || !isPresent) return;
    paneNoteId.set(note.id);
    return () => {
      if (paneNoteId.get() === note.id) paneNoteId.set(null);
    };
  }, [split, isPresent, note.id]);

  // Where the surface morphs from (opening) or to (closing). Null means no card to
  // morph with, so the editor fades instead. A pane never morphs.
  const [origin] = useState(() => {
    const rect = takeOrigin(note.id);
    return split ? null : rect;
  });
  const cardRect = useRef<Rect | null>(origin);
  const [settled, setSettled] = useState(false);

  const progress = useMotionValue(0);
  const [self] = useState(() => ({}));
  useMotionValueEvent(progress, 'change', (value) => {
    if (leadSurface === self) editorProgress.set(value);
  });
  useLayoutEffect(() => {
    leadSurface = self;
    return () => {
      if (leadSurface === self) leadSurface = null;
    };
  }, [self]);
  const fade = useMotionValue(origin || split ? 1 : 0);
  const dragY = useMotionValue(0);
  // In the pane: this note fading in over the one it replaces, and that one's text fading out.
  const swap = useMotionValue(1);
  const textFade = useMotionValue(1);
  // Bumped when the layout changes, so the transforms below recompute at rest too.
  const layoutTick = useMotionValue(0);
  const dragScale = useTransform(() => 1 - (Math.abs(dragY.get()) / MAX_DRAG) * 0.08);
  // Without a card to morph with, the whole surface (not just its content) fades and
  // settles in, or sinks away, so nothing opaque is left to vanish at the end.
  const surfaceOpacity = useTransform(() => (cardRect.current ? 1 : fade.get()) * swap.get());
  const scale = useTransform(
    () => dragScale.get() * (cardRect.current ? 1 : 0.94 + 0.06 * fade.get()),
  );

  // Container transform: translate the surface so its top-left sits on the card, and
  // clip it to the card's size. Content is never scaled, so text stays crisp. A pane
  // slides in from the right edge instead. Every value is read up front, so each transform
  // follows all of them whichever branch it takes.
  const x = useTransform(() => {
    const p = progress.get();
    const reveal = paneReveal.get();
    layoutTick.get();
    const card = cardRect.current;
    if (splitRef.current) return (1 - reveal) * targetRef.current.width;
    return card ? (1 - p) * (card.x - targetRef.current.x) : 0;
  });
  const y = useTransform(() => {
    const p = progress.get();
    const drag = dragY.get();
    const faded = fade.get();
    layoutTick.get();
    const card = cardRect.current;
    const offset = card ? (1 - p) * (card.y - targetRef.current.y) : 0;
    return offset + drag + (1 - faded) * 48;
  });
  const clipPath = useTransform(() => {
    const card = cardRect.current;
    const t = targetRef.current;
    const p = progress.get();
    layoutTick.get();
    // The pane's toolbars and card sit on its left edge, so clipping would cut their shadows.
    if (splitRef.current) return 'none';
    if (!card) return `inset(0px round ${t.radius}px)`;
    const right = Math.max(0, (1 - p) * (t.width - card.width));
    const bottom = Math.max(0, (1 - p) * (t.height - card.height));
    const radius = lerp(card.radius, t.radius || 28 * Math.min(1, Math.abs(dragY.get()) / 80), p);
    return `inset(0px ${right}px ${bottom}px 0px round ${radius}px)`;
  });
  const ghostOpacity = useTransform(() => (cardRect.current ? 1 - progress.get() / 0.35 : 0));
  const contentOpacity = useTransform(
    () => (cardRect.current ? (progress.get() - 0.25) / 0.45 : fade.get()) * textFade.get(),
  );
  const contentY = useTransform(() => (1 - swap.get()) * 12);
  const backdropOpacity = useTransform(() => progress.get() * 0.35);

  // Open: grow out of the card (or slide in as a pane, or fade in over the pane's last note),
  // then swap the preview for the real editor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; the key fixes the note
  useLayoutEffect(() => {
    if (split) {
      for (const leave of leavingPanes) leave();
      progress.set(1);
      const replacing = paneReveal.get() === 1;
      if (replacing) swap.set(0);
      const animation = replacing
        ? animate(swap, 1, { duration: SWAP_MS / 1000, ease: 'easeOut' })
        : animate(paneReveal, 1, springs.pane);
      void animation.then(() => setSettled(true));
      return;
    }
    if (origin) hideCard(note.id);
    const animations = [animate(progress, 1, curves.expand)];
    if (!origin) animations.push(animate(fade, 1, curves.expand));
    void Promise.all(animations).then(() => setSettled(true));
  }, []);

  // Unfolding a foldable with a note open turns it into a pane, which slides into place. Its
  // card stays in view beside it, marked as open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when the layout changes
  useEffect(() => {
    layoutTick.set(layoutTick.get() + 1);
    if (!settled || !split || !isPresent) return;
    showCard(note.id);
    if (leadSurface === self && paneReveal.get() < 1) animate(paneReveal, 1, springs.pane);
  }, [settled, split, isPresent, note.id, self, layoutTick, target.x, target.width, target.height]);

  // Close (from any cause, including the back gesture): save, drop an empty note, then
  // shrink into the note's card, or fade out when it has none.
  useEffect(() => {
    if (isPresent) return;
    flush();
    const discarded = discardIfEmpty(note.id);

    if (splitRef.current) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        leavingPanes.delete(finish);
        progress.set(0);
        safeToRemove();
      };
      // Replaced by another note: its text fades out while the new note fades in on top.
      if (leadSurface !== self) {
        void animate(textFade, 0, { duration: SWAP_MS / 2000, ease: 'easeOut' });
        const timer = window.setTimeout(finish, SWAP_MS);
        return () => window.clearTimeout(timer);
      }
      leavingPanes.add(finish);
      void animate(paneReveal, 0, springs.pane).then(finish);
      return;
    }

    // Measure a frame later: an action that closed the editor (trash, archive) may be about
    // to take the card off the page, and shrinking into a card that vanishes looks broken.
    let landing = 0;
    const frame = requestAnimationFrame(() => {
      cardRect.current = discarded ? null : measureCard(note.id);
      if (cardRect.current) {
        hideCard(note.id);
        landing = window.setTimeout(
          () => landCard(note.id),
          (curves.collapse.duration - LAND_EARLY) * 1000,
        );
      }
      rerender((n) => n + 1);

      const animations = [
        animate(progress, 0, curves.collapse),
        animate(dragY, 0, curves.collapse),
      ];
      if (!cardRect.current) animations.push(animate(fade, 0, curves.collapse));
      void Promise.all(animations).then(() => {
        showCard(note.id);
        // A pane folded away into full screen leaves no pane behind.
        if (leadSurface === self) paneReveal.jump(0);
        safeToRemove();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(landing);
    };
  }, [isPresent, flush, note.id, progress, dragY, fade, textFade, self, safeToRemove]);

  // A pane is part of the layout, not a sheet over it, so it does not swipe away.
  const scrollRef = useSwipeToDismiss({
    dragY,
    onDismiss: requestClose,
    enabled: isPresent && !split,
  });

  const scrollArea = (
    <div
      ref={scrollRef}
      data-note-scroll
      data-note-color={note.color}
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pt-2',
        split
          ? cn(
              'rounded-3xl border border-transparent bg-note pb-6 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_12px_32px_-16px_oklch(0_0_0/0.18)] data-[note-color=default]:border-border',
              // The card stops above the pane's dock, which follows the keyboard up.
              !sideLinks && 'mr-3 mb-[calc(var(--dock-height)+var(--dock-bottom)+0.75rem)]',
            )
          : target.radius
            ? // The panel ends above the dock, until the keyboard lifts the dock.
              'pb-[calc(var(--keyboard)+1.5rem)]'
            : // Room to scroll the last lines clear of the dock (and keyboard) above.
              'pb-[var(--dock-space)]',
      )}
    >
      {/* The editor keeps its own height so the links follow its last line. */}
      <div className="flex min-h-full flex-col">
        {settled ? (
          <LazyNoteEditor
            initialContent={note.content}
            onChange={save}
            onControls={editorControls.set}
            editable={editable}
            className="min-h-0"
            fallback={<NotePreview content={note.content} maxBlocks={200} variant="editor" />}
          />
        ) : (
          <NotePreview content={note.content} maxBlocks={200} variant="editor" />
        )}
        {!sideLinks && <NoteLinks note={note} variant="below" className="note-links-inset pt-5" />}
        {/* Tapping the blank space below the note writes at its end, as tapping paper would. */}
        <div
          aria-hidden
          className={cn('min-h-16 flex-1', editable && 'cursor-text')}
          onClick={() => {
            if (editable) editorControls.get()?.focusEnd();
          }}
        />
      </div>
    </div>
  );

  return (
    // Not modal: the dock above the editor is its toolbar and must stay usable. The page
    // behind is made inert instead (see routes/_app.tsx).
    <DialogPrimitive.Root open modal={false} onOpenChange={(open) => !open && requestClose()}>
      <DialogPrimitive.Portal>
        {!split && (
          <motion.div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-50 bg-black"
            style={{ opacity: backdropOpacity }}
          />
        )}
        <DialogPrimitive.Content
          asChild
          // Focusing the editor would raise the keyboard before the user asks for it.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Using the dock (or a toast) is not leaving the editor. On touch, Radix checks the
          // target on click, after a re-render may have replaced it (Pin becomes Unpin), so a
          // detached target counts as ours too. Beside the page, the page is not outside.
          onInteractOutside={(event) => {
            if (split) {
              event.preventDefault();
              return;
            }
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (
              !target.isConnected ||
              target.closest('[data-dock], [data-sonner-toaster], [data-link-overlay]')
            ) {
              event.preventDefault();
            }
          }}
        >
          <motion.div
            data-note-color={note.color}
            className={cn(
              'fixed z-50 flex flex-col text-card-foreground outline-none',
              !split && 'overflow-hidden bg-note',
            )}
            style={{
              left: target.x,
              top: target.y,
              width: target.width,
              height: target.height,
              x,
              y,
              clipPath,
              scale,
              opacity: surfaceOpacity,
              transformOrigin: '50% 20%',
              pointerEvents: isPresent ? 'auto' : 'none',
            }}
          >
            <DialogPrimitive.Title className="sr-only">Edit note</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Changes are saved automatically.
            </DialogPrimitive.Description>

            {/* The card face only exists while morphing; afterwards the editor is the note. */}
            {cardRect.current !== null && (!settled || !isPresent) && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute top-0 left-0"
                style={{ width: cardRect.current.width, opacity: ghostOpacity }}
              >
                <NoteCardFace note={note} />
              </motion.div>
            )}

            <motion.div
              className="flex min-h-0 flex-1 flex-col"
              style={{ opacity: contentOpacity, y: contentY }}
            >
              <header
                className={cn(
                  'flex shrink-0 items-center gap-2',
                  // In the pane the toolbars line up with the card's edges below them.
                  split ? 'pr-3 pb-3' : 'px-3 pb-1 sm:px-4',
                  target.radius === 0 ? 'pt-[calc(var(--safe-top)+0.5rem)]' : 'pt-3',
                )}
              >
                <div className="glass flex shrink-0 rounded-[var(--dock-radius)] p-1">
                  <IconButton
                    label="Close"
                    onClick={requestClose}
                    className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
                  >
                    <ChevronLeft />
                  </IconButton>
                </div>
                <div className="flex min-w-0 flex-1 justify-center">
                  <SaveStatus state={state} updatedAt={note.updatedAt} />
                </div>
                <div className="glass flex shrink-0 rounded-[var(--dock-radius)] p-1">
                  <IconButton
                    label={editable ? 'Move to trash' : 'Delete forever'}
                    onClick={() => {
                      haptics.warning();
                      if (editable) trashNote(note.id);
                      else deleteNoteForever(note.id);
                      requestClose();
                    }}
                    className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] text-destructive hover:text-destructive [&_svg]:size-6"
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </header>

              {sideLinks ? (
                // The column sits outside the note's card: the links belong to the note but
                // are not part of its text.
                <div className="mr-3 mb-[calc(var(--dock-height)+var(--dock-bottom)+0.75rem)] flex min-h-0 flex-1 gap-3">
                  {scrollArea}
                  <motion.aside
                    className="w-64 shrink-0 overflow-y-auto overscroll-contain pb-6"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={springs.smooth}
                  >
                    <NoteLinks note={note} variant="side" />
                  </motion.aside>
                </div>
              ) : (
                scrollArea
              )}
            </motion.div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
