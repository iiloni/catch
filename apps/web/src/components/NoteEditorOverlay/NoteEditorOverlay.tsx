import type { Note } from '@catch/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { Archive, ArchiveRestore, ChevronLeft, Pin, Trash2 } from 'lucide-react';
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HistoryToolbar } from '@/components/HistoryToolbar/HistoryToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteCardFace } from '@/components/NoteCard/NoteCard';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteLinks } from '@/components/NoteLinks/NoteLinks';
import { NoteMedia } from '@/components/NoteMedia/NoteMedia';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteTags } from '@/components/NoteTags/NoteTags';
import { NoteTimestamp } from '@/components/NoteTimestamp/NoteTimestamp';
import { ReminderChip } from '@/components/ReminderChip/ReminderChip';
import { SaveStatus } from '@/components/SaveStatus/SaveStatus';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useNoteAttachments } from '@/lib/attachments';
import { notesCollection, useReminders } from '@/lib/collections';
import { editorControls, noteDockPanelOpen, noteReminderRequest, quickNote } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { linkCaptureControls } from '@/lib/linkCapture';
import { useNoteLinks } from '@/lib/linkPreviews';
import {
  afterPaint,
  animateSteady,
  animateSteadySpring,
  curves,
  springs,
  stopSteady,
} from '@/lib/motion';
import {
  deleteNoteForever,
  discardIfEmpty,
  setNoteArchived,
  setNotePinned,
  trashNote,
} from '@/lib/notes';
import {
  CARD_FACE_FADE_END,
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
import { useNoteColor, useResolvedNoteTags } from '@/lib/tags';
import { useNoteAutosave } from '@/lib/useNoteAutosave';
import { cn } from '@/lib/utils';
import { useEditorDock } from './useEditorDock';
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
  const reminder = useReminders().get(note.id);
  const popupState = quickNote.use();
  const capture = linkCaptureControls.use();
  const color = useNoteColor(note);
  const hasTags = useResolvedNoteTags(note.id).length > 0;
  const [isPresent, safeToRemove] = usePresence();
  const [, rerender] = useState(0);
  // The back button, Escape and an outside click can all fire for one close.
  const closing = useRef(false);
  /** Calls off the pane's slide in while it is still waiting to start. */
  const cancelSlide = useRef(() => {});
  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    onClose();
  };
  // AnimatePresence brings the same instance back if its note is reopened before it finishes
  // closing, and that note has to be able to close again.
  useEffect(() => {
    if (isPresent) closing.current = false;
  }, [isPresent]);
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
  const fullscreen = !split && target.radius === 0;
  const targetRef = useRef(target);
  targetRef.current = target;
  const editable = !note.deletedAt;
  const [controls, setControls] = useState<EditorControls | null>(null);
  useEditorDock(note, controls, isPresent);
  const hasLinks = useNoteLinks(note).length > 0;
  const hasMedia = useNoteAttachments(note.id).length > 0;
  const sideLinks = split && target.width >= SIDE_LINKS_MIN && (hasLinks || hasMedia || hasTags);

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
  // A card can be taller than the screen. The backing surface must contain both ends of
  // the morph, or translating it to an off-screen card top cuts its visible bottom short.
  const surfaceWidth = split ? target.width : Math.max(target.width, cardRect.current?.width ?? 0);
  const surfaceHeight = split
    ? target.height
    : Math.max(target.height, cardRect.current?.height ?? 0);

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
    const right = Math.max(t.width, card.width) - lerp(card.width, t.width, p);
    const bottom = Math.max(t.height, card.height) - lerp(card.height, t.height, p);
    const radius = lerp(card.radius, t.radius || 28 * Math.min(1, Math.abs(dragY.get()) / 80), p);
    return `inset(0px ${right}px ${bottom}px 0px round ${radius}px)`;
  });
  const ghostOpacity = useTransform(() =>
    cardRect.current ? 1 - progress.get() / CARD_FACE_FADE_END : 0,
  );
  const contentOpacity = useTransform(
    () => (cardRect.current ? (progress.get() - 0.25) / 0.45 : fade.get()) * textFade.get(),
  );
  const contentY = useTransform(() => (1 - swap.get()) * 12);
  const backdropOpacity = useTransform(() => progress.get() * 0.35);

  // Recompute the clip before painting a newly measured backing size, including when the
  // destination card grew while the note was being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidate transforms when their referenced geometry changes
  useLayoutEffect(() => {
    layoutTick.set(layoutTick.get() + 1);
  }, [layoutTick, surfaceWidth, surfaceHeight, target.x, target.y, target.width, target.height]);

  // Open: grow out of the card (or slide in as a pane, or fade in over the pane's last note),
  // then swap the preview for the real editor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; the key fixes the note
  useLayoutEffect(() => {
    if (split) {
      for (const leave of leavingPanes) leave();
      progress.set(1);
      if (paneReveal.get() === 1) {
        swap.set(0);
        void animate(swap, 1, { duration: SWAP_MS / 1000, ease: 'easeOut' }).then(() =>
          setSettled(true),
        );
        return;
      }
      // Mounting the note and narrowing the page beside it is one long frame. A spring keeps
      // time, so that frame came out of the slide, which then appeared most of the way in.
      // The pane waits for it to be painted and then follows the spring it leaves on by
      // frames, as below.
      cancelSlide.current = afterPaint(() => {
        void animateSteadySpring(paneReveal, 1, springs.pane).then(() => setSettled(true));
      });
      return () => cancelSlide.current();
    }
    if (origin) hideCard(note.id);
    // Mounting the note (and turning the dock into its toolbar) keeps the page busy for a
    // moment. The surface waits it out looking like the card it covers, then grows.
    return afterPaint(() => {
      const animations = [animateSteady(progress, 1, curves.expand)];
      if (!origin) animations.push(animateSteady(fade, 1, curves.expand));
      void Promise.all(animations).then(() => setSettled(true));
    });
  }, []);

  // Unfolding a foldable with a note open turns it into a pane, which slides into place. Its
  // card stays in view beside it, marked as open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when the layout changes
  useEffect(() => {
    if (!settled || !split || !isPresent) return;
    showCard(note.id);
    if (leadSurface === self && paneReveal.get() < 1) {
      stopSteady(paneReveal);
      animate(paneReveal, 1, springs.pane);
    }
  }, [settled, split, isPresent, note.id, self, target.x, target.width, target.height]);

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
      // Closed before it finished sliding in, or before it began.
      cancelSlide.current();
      stopSteady(paneReveal);
      void animate(paneReveal, 0, springs.pane).then(finish);
      return;
    }

    // Measure a frame later: an action that closed the editor (trash, archive) may be about
    // to take the card off the page, and shrinking into a card that vanishes looks broken.
    let landing = 0;
    let start = 0;
    const frame = requestAnimationFrame(() => {
      cardRect.current = discarded ? null : measureCard(note.id);
      if (cardRect.current) hideCard(note.id);
      rerender((n) => n + 1);

      // A frame later again, once the card's face is drawn on the surface shrinking into it.
      start = requestAnimationFrame(() => {
        if (cardRect.current) {
          landing = window.setTimeout(
            () => landCard(note.id),
            (curves.collapse.duration - LAND_EARLY) * 1000,
          );
        }
        const animations = [
          animateSteady(progress, 0, curves.collapse),
          animateSteady(dragY, 0, curves.collapse),
        ];
        if (!cardRect.current) animations.push(animateSteady(fade, 0, curves.collapse));
        void Promise.all(animations).then(() => {
          showCard(note.id);
          // A pane folded away into full screen leaves no pane behind.
          if (leadSurface === self) paneReveal.jump(0);
          safeToRemove();
        });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(start);
      window.clearTimeout(landing);
    };
  }, [isPresent, flush, note.id, progress, dragY, fade, textFade, self, safeToRemove]);

  // A pane is part of the layout, not a sheet over it, so it does not swipe away.
  const scrollRef = useSwipeToDismiss({
    dragY,
    onDismiss: requestClose,
    enabled: isPresent && !split,
  });
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });
  const attachScroll = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef(element);
      setScrollElement(element);
    },
    [scrollRef],
  );

  useEffect(() => {
    if (!fullscreen || !scrollElement) return;
    const update = () => {
      const top = scrollElement.scrollTop > 1;
      const bottom =
        scrollElement.scrollTop + scrollElement.clientHeight < scrollElement.scrollHeight - 1;
      setScrollEdges((edges) =>
        edges.top === top && edges.bottom === bottom ? edges : { top, bottom },
      );
    };
    update();
    scrollElement.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    if (scrollElement.firstElementChild) observer.observe(scrollElement.firstElementChild);
    return () => {
      scrollElement.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [fullscreen, scrollElement]);

  const scrollArea = (
    <ScrollArea
      data-note-color={color}
      className={cn(
        'flex-1',
        !fullscreen && 'rounded-3xl [--scrollbar-edge:0.25rem] [--scrollbar-inset:1rem]',
        split &&
          cn(
            'border border-transparent bg-note shadow-[0_1px_2px_oklch(0_0_0/0.06),0_12px_32px_-16px_oklch(0_0_0/0.18)] data-[note-color=default]:border-border',
            // The card stops above the pane's dock, which follows the keyboard up.
            !sideLinks && 'mr-3 mb-[calc(var(--dock-height)+var(--dock-bottom)+0.75rem)]',
          ),
      )}
    >
      <ScrollAreaViewport
        ref={attachScroll}
        data-note-scroll
        data-note-color={color}
        className={cn(
          fullscreen
            ? 'scroll-pt-[calc(var(--safe-top)+4rem)] pt-[calc(var(--safe-top)+4rem)] pb-[calc(var(--dock-space)+4rem)]'
            : cn('pt-2', split ? 'pb-6' : 'pb-[calc(var(--keyboard)+1.5rem)]'),
        )}
      >
        {/* The editor keeps its own height so the links follow its last line. */}
        <div className="flex min-h-full flex-1 flex-col">
          {settled ? (
            <LazyNoteEditor
              noteId={note.id}
              initialContent={note.content}
              onChange={save}
              onControls={setControls}
              editable={editable}
              className="min-h-0"
              fallback={<NotePreview content={note.content} maxBlocks={200} variant="editor" />}
            />
          ) : (
            <NotePreview content={note.content} maxBlocks={200} variant="editor" />
          )}
          {!sideLinks && <NoteTags noteId={note.id} className="note-links-inset pt-5" />}
          {!sideLinks && (
            <NoteMedia noteId={note.id} readOnly={!editable} className="note-links-inset pt-5" />
          )}
          {!sideLinks && (
            <NoteLinks note={note} variant="below" className="note-links-inset pt-5" />
          )}
          {reminder && !note.deletedAt && (
            <div className="flex justify-center px-4 pt-6">
              <ReminderChip
                reminder={reminder}
                onClick={() => {
                  haptics.toggle();
                  noteReminderRequest.set(noteReminderRequest.get() + 1);
                }}
              />
            </div>
          )}
          <NoteTimestamp updatedAt={note.updatedAt} />
          {/* Tapping the blank space below the note writes at its end, as tapping paper would. */}
          <div
            aria-hidden
            className={cn('min-h-16 flex-1', editable && 'cursor-text')}
            onClick={() => {
              if (editable) editorControls.get()?.focusEnd();
            }}
          />
        </div>
      </ScrollAreaViewport>
      <ScrollBar className={fullscreen ? 'hidden' : undefined} />
    </ScrollArea>
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
          inert={popupState === 'open' || popupState === 'capture' || Boolean(capture)}
          // Focusing the editor would raise the keyboard before the user asks for it.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            // The dock folds its open picker before Escape leaves the note.
            if (noteDockPanelOpen.get()) event.preventDefault();
          }}
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
              target.closest(
                '[data-dock], [data-sonner-toaster], [aria-label="New note"], [data-link-overlay], [data-link-scrim], [data-attachment-menu], .bn-suggestion-menu, .bn-file-panel, .bn-toolbar',
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <motion.div
            data-note-color={color}
            className={cn(
              'fixed z-50 flex flex-col text-card-foreground outline-none',
              !split && 'overflow-hidden bg-note',
            )}
            style={{
              left: target.x,
              top: target.y,
              width: surfaceWidth,
              height: surfaceHeight,
              x,
              y,
              clipPath,
              scale,
              opacity: surfaceOpacity,
              transformOrigin: `${target.width / 2}px ${target.height * 0.2}px`,
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
              className="relative flex min-h-0 shrink-0 flex-col"
              // The backing can exceed the screen; the editor keeps its viewport and scroll.
              style={{
                width: target.width,
                height: target.height,
                opacity: contentOpacity,
                y: contentY,
              }}
            >
              {fullscreen && (
                <>
                  <div
                    aria-hidden
                    className="page-top-blur pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--safe-top)+8rem)] transition-opacity duration-200"
                    style={{ opacity: scrollEdges.top ? 1 : 0 }}
                  />
                  <div
                    aria-hidden
                    className="page-bottom-blur pointer-events-none absolute inset-x-0 bottom-[var(--keyboard)] z-10 h-[calc(var(--dock-height)+var(--safe-bottom)+3rem)] transition-opacity duration-200"
                    style={{ opacity: scrollEdges.bottom ? 1 : 0 }}
                  />
                </>
              )}
              <header
                data-note-header
                className={cn(
                  'flex shrink-0 items-center gap-2',
                  fullscreen && 'absolute inset-x-0 top-0 z-20',
                  // In the pane the toolbars line up with the card's edges below them.
                  split ? 'pr-3 pb-3' : 'px-3 pb-1 sm:px-4',
                  target.radius === 0 ? 'pt-[calc(var(--safe-top)+0.5rem)]' : 'pt-3',
                )}
              >
                <div className="relative shrink-0">
                  <div className="glass flex rounded-[var(--dock-radius)] p-1">
                    <IconButton
                      label="Close"
                      onClick={requestClose}
                      className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
                    >
                      <ChevronLeft />
                    </IconButton>
                  </div>
                  {editable && (
                    <HistoryToolbar
                      controls={controls}
                      className="absolute top-0 left-[calc(100%+0.25rem)] hidden sm:flex"
                    />
                  )}
                </div>
                <div
                  className={cn(
                    'pointer-events-none relative h-[50px] min-w-0 flex-1',
                    // Balance the buttons on the right so the centered pill clears history in
                    // narrow panes. A phone has no history there and no width to spare.
                    editable && (note.isArchived ? 'sm:ml-10' : 'sm:ml-[5.5625rem]'),
                  )}
                >
                  <SaveStatus state={state} compact={split && target.width < 480} />
                </div>
                <div className="glass flex shrink-0 items-center rounded-[var(--dock-radius)] p-1">
                  {editable && !note.isArchived && (
                    <>
                      <IconButton
                        label={note.isPinned ? 'Unpin' : 'Pin'}
                        aria-pressed={note.isPinned}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          haptics.toggle();
                          setNotePinned(note.id, !note.isPinned);
                        }}
                        className={cn(
                          'size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6',
                          note.isPinned && 'bg-foreground/[0.08]',
                        )}
                      >
                        <Pin className={cn(note.isPinned && 'fill-current')} />
                      </IconButton>
                      {/* Pinning keeps the note; the two beyond the line put it away. */}
                      <span aria-hidden className="mx-1 h-6 w-px bg-foreground/15" />
                    </>
                  )}
                  {editable && (
                    <IconButton
                      label={note.isArchived ? 'Unarchive' : 'Archive'}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        haptics.selection();
                        flush();
                        setNoteArchived(note.id, !note.isArchived);
                        if (!note.isArchived) requestClose();
                      }}
                      className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
                    >
                      {note.isArchived ? <ArchiveRestore /> : <Archive />}
                    </IconButton>
                  )}
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

              <div
                className={cn(
                  'flex min-h-0 flex-1',
                  sideLinks &&
                    'mr-3 mb-[calc(var(--dock-height)+var(--dock-bottom)+0.75rem)] gap-3',
                )}
              >
                {scrollArea}
                {sideLinks && (
                  <motion.aside
                    className="min-h-0 w-64 shrink-0"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={springs.smooth}
                  >
                    <ScrollArea className="h-full [--scrollbar-inset:0.5rem]">
                      <ScrollAreaViewport className="pb-6">
                        <NoteTags noteId={note.id} className="mb-4" />
                        <NoteMedia noteId={note.id} readOnly={!editable} className="mb-4" />
                        <NoteLinks note={note} variant="side" />
                      </ScrollAreaViewport>
                      <ScrollBar />
                    </ScrollArea>
                  </motion.aside>
                )}
              </div>
            </motion.div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
