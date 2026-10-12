import type { HistoryRestoreResult, Note } from '@catch/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { Archive, ArchiveRestore, ChevronLeft, Pin, Share2, Trash2 } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  usePresence,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { HistoryToolbar } from '@/components/HistoryToolbar/HistoryToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteCardFace } from '@/components/NoteCard/NoteCard';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteHistory } from '@/components/NoteHistory/NoteHistory';
import { NoteLinks } from '@/components/NoteLinks/NoteLinks';
import { NoteMedia } from '@/components/NoteMedia/NoteMedia';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteTags } from '@/components/NoteTags/NoteTags';
import { NoteTimestamp } from '@/components/NoteTimestamp/NoteTimestamp';
import { ReminderChip } from '@/components/ReminderChip/ReminderChip';
import { SaveStatus } from '@/components/SaveStatus/SaveStatus';
import { SharePanel } from '@/components/SharePanel/SharePanel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useNoteAttachments } from '@/lib/attachments';
import {
  notesCollection,
  useNoteShares,
  useReminders,
  useSharedNotes,
  useSharedNotesReady,
} from '@/lib/collections';
import {
  editorControls,
  editorScrollToBottom,
  noteDockPanelOpen,
  noteHistoryOpen,
  noteReminderRequest,
  quickNote,
  tagFormOpen,
} from '@/lib/dockState';
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
import { freezeHistory } from '@/lib/noteHistory';
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
  findCard,
  hideCard,
  landCard,
  measureCard,
  type Rect,
  showCard,
  takeOrigin,
} from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { isSharedNote, useSharedNoteOwner } from '@/lib/sharing';
import {
  GUTTER,
  HEADER_HISTORY_MIN,
  type NotePane,
  paneNoteId,
  paneReveal,
  useNotePane,
} from '@/lib/splitView';
import { useNoteColor, useResolvedNoteTags } from '@/lib/tags';
import { useNoteAutosave } from '@/lib/useNoteAutosave';
import { cn } from '@/lib/utils';
import { isVaultNote, openIfVaultNote, openVaultHistoryNote, useVaultNote } from '@/lib/vault';
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
  const { open, close } = useOpenNote();
  const { data: matches = [], isReady } = useLiveQuery(
    (q) => q.from({ note: notesCollection }).where(({ note }) => eq(note.id, noteId ?? '')),
    [noteId],
  );
  // A note in the unlocked vault is not in the notes collection; locking the vault closes it.
  const vaultNote = useVaultNote(noteId);
  // A note someone shared opens like one of the user's own, to be read (ADR 0021).
  const shared = useSharedNotes().notes;
  const sharedReady = useSharedNotesReady();
  const note = matches[0] ?? vaultNote ?? shared.find((candidate) => candidate.id === noteId);

  // A deleted or unknown note id in the URL closes the editor. So does a shared note whose
  // owner stops sharing it or moves it to the trash while it is open. One this editor never
  // showed may be a vault note asked for from outside, by its reminder or a reload: that
  // enters the vault, asking for its password if need be, and opens the note there.
  const shown = useRef<string | null>(null);
  if (note) shown.current = note.id;
  useEffect(() => {
    if (!noteId || !isReady || !sharedReady || note) return;
    if (shown.current !== noteId) openIfVaultNote(noteId, () => open(noteId));
    close();
  }, [noteId, isReady, sharedReady, note, open, close]);

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
/** How much note must lie below the screen before the dock offers a jump to its end. */
const END_FAR = 160;

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

/** The narrowest note that lists its versions beside the one being read. */
const HISTORY_LIST_MIN = 640;

const SCROLL_OPTIONS = { capture: true, passive: true } as const;

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
  const { state, save, flush, cancel } = useNoteAutosave(note.id);
  // The back button, Escape and an outside click can all fire for one close.
  const closing = useRef(false);
  /** Calls off the pane's slide in while it is still waiting to start. */
  const cancelSlide = useRef(() => {});
  const requestClose = async () => {
    if (noteHistoryOpen.get()) {
      noteHistoryOpen.set(false);
      return;
    }
    if (closing.current) return;
    closing.current = true;
    try {
      await flush();
      // History reports its own storage failures; the working note has already been saved.
      await freezeHistory(note.id).catch(() => {});
      onClose();
    } catch (error) {
      closing.current = false;
      toast.error('Could not save this note on your device', {
        description: error instanceof Error ? error.message : 'Try closing the note again.',
      });
    }
  };
  // AnimatePresence brings the same instance back if its note is reopened before it finishes
  // closing, and that note has to be able to close again.
  useEffect(() => {
    if (isPresent) closing.current = false;
  }, [isPresent]);
  const historyOpen = noteHistoryOpen.use();
  const historyReturnScroll = useRef<number | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [restoredContent, setRestoredContent] = useState<Note['content'] | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  useEffect(() => {
    if (historyOpen && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (!historyOpen) {
      setHistoryReady(false);
      return;
    }
    let active = true;
    void flush()
      .then(() => freezeHistory(note.id))
      .then(() => {
        if (active) setHistoryReady(true);
      })
      .catch(() => {
        if (active) setHistoryReady(true);
      });
    return () => {
      active = false;
    };
  }, [historyOpen, flush, note.id]);
  // One flag serves every surface, so a note opened over another's reader starts as a note.
  useLayoutEffect(() => {
    noteHistoryOpen.set(false);
    return () => noteHistoryOpen.set(false);
  }, []);
  const historyRestored = (result: HistoryRestoreResult) => {
    cancel();
    historyReturnScroll.current = 0;
    setRestoredContent(
      result.note?.content ??
        (result.vaultNote ? openVaultHistoryNote(note.id, result.vaultNote.data).content : null),
    );
    setEditorGeneration((value) => value + 1);
  };
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
  const narrowPane = split && target.width < HEADER_HISTORY_MIN;
  const fullscreen = !split && target.radius === 0;
  const targetRef = useRef(target);
  targetRef.current = target;
  const shared = isSharedNote(note);
  const owner = useSharedNoteOwner(note.id);
  const editable = !note.deletedAt && !shared && !historyOpen;
  const hasLink = useNoteShares().has(note.id);
  const [controls, setControls] = useState<EditorControls | null>(null);
  useEditorDock(note, historyOpen ? null : controls, isPresent);
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
  // size it to the card, which can be taller than the screen. Its content keeps the
  // editor's size and is cut off at the surface's edge, so text is never scaled and stays
  // crisp. A pane slides in from the right edge instead. Every value is read up front, so
  // each transform follows all of them whichever branch it takes.
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
  // The surface's own box does the cutting, not a `clip-path`: a clip path that changes is
  // drawn again with everything under it on every frame, and a phone cannot keep up with
  // a screen of text. A box that changes size only moves the edge its layers are cut at.
  const width = useTransform(() => {
    const card = cardRect.current;
    const t = targetRef.current;
    const p = progress.get();
    layoutTick.get();
    return card && !splitRef.current ? lerp(card.width, t.width, p) : t.width;
  });
  const height = useTransform(() => {
    const card = cardRect.current;
    const t = targetRef.current;
    const p = progress.get();
    layoutTick.get();
    return card && !splitRef.current ? lerp(card.height, t.height, p) : t.height;
  });
  const borderRadius = useTransform(() => {
    const card = cardRect.current;
    const t = targetRef.current;
    const p = progress.get();
    const drag = dragY.get();
    layoutTick.get();
    // The pane's toolbars and card sit on its left edge, and it does not cut them off.
    if (splitRef.current) return 0;
    if (!card) return t.radius;
    return lerp(card.radius, t.radius || 28 * Math.min(1, Math.abs(drag) / 80), p);
  });
  const ghostOpacity = useTransform(() =>
    cardRect.current ? 1 - progress.get() / CARD_FACE_FADE_END : 0,
  );
  const contentOpacity = useTransform(
    () => (cardRect.current ? (progress.get() - 0.25) / 0.45 : fade.get()) * textFade.get(),
  );
  const contentY = useTransform(() => (1 - swap.get()) * 12);
  const backdropOpacity = useTransform(() => progress.get() * 0.35);

  // Recompute the surface's box before painting a newly measured size, including when the
  // destination card grew while the note was being edited.
  const cardWidth = cardRect.current?.width;
  const cardHeight = cardRect.current?.height;
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidate transforms when their referenced geometry changes
  useLayoutEffect(() => {
    layoutTick.set(layoutTick.get() + 1);
  }, [layoutTick, cardWidth, cardHeight, target.x, target.y, target.width, target.height]);

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
    void flush().catch(() => {});
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
    const follow = () => {
      const card = findCard(note.id);
      if (!card || !cardRect.current) return;
      const box = card.getBoundingClientRect();
      cardRect.current = { ...cardRect.current, x: box.left, y: box.top };
      layoutTick.set(layoutTick.get() + 1);
    };
    const frame = requestAnimationFrame(() => {
      cardRect.current = discarded ? null : measureCard(note.id);
      if (cardRect.current) hideCard(note.id);
      rerender((n) => n + 1);
      // The page behind is live again and can be scrolled while the editor shrinks, which
      // moves the card. Any scroller counts (the Deck's columns), hence the capture.
      if (cardRect.current) document.addEventListener('scroll', follow, SCROLL_OPTIONS);

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
          document.removeEventListener('scroll', follow, SCROLL_OPTIONS);
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
      document.removeEventListener('scroll', follow, SCROLL_OPTIONS);
    };
  }, [isPresent, flush, note.id, progress, dragY, fade, textFade, layoutTick, self, safeToRemove]);

  // A pane is part of the layout, not a sheet over it, so it does not swipe away.
  const scrollRef = useSwipeToDismiss({
    dragY,
    onDismiss: requestClose,
    enabled: isPresent && !split,
  });
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!scrollElement) return;
    if (historyOpen) {
      historyReturnScroll.current ??= scrollElement.scrollTop;
      return;
    }
    const top = historyReturnScroll.current;
    if (top === null) return;
    historyReturnScroll.current = null;
    scrollElement.scrollTop = top;
    // BlockNote updates its editable view after commit. Restore again after that work,
    // and focus the footer without scrolling the caret into view or raising the keyboard.
    const frame = requestAnimationFrame(() => {
      scrollElement
        .querySelector<HTMLElement>('[data-note-history-entry]')
        ?.focus({ preventScroll: true });
      scrollElement.scrollTop = top;
    });
    return () => cancelAnimationFrame(frame);
  }, [historyOpen, scrollElement]);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false, far: false });
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
      const below =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      const bottom = below > 1;
      const far = below > END_FAR;
      setScrollEdges((edges) =>
        edges.top === top && edges.bottom === bottom && edges.far === far
          ? edges
          : { top, bottom, far },
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

  const offerScrollToBottom = fullscreen && isPresent && scrollEdges.far;
  useEffect(() => {
    if (!offerScrollToBottom || !scrollElement) return;
    const scrollToBottom = () =>
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    editorScrollToBottom.set(scrollToBottom);
    return () => {
      if (editorScrollToBottom.get() === scrollToBottom) editorScrollToBottom.set(null);
    };
  }, [offerScrollToBottom, scrollElement]);

  const reducedMotion = useReducedMotion();
  const closeHistory = () => {
    noteHistoryOpen.set(false);
  };
  // The reader leaves by the pull that closes a note, and the note it was over stays.
  const historyScrollRef = useSwipeToDismiss({
    dragY,
    onDismiss: () => {
      closeHistory();
      animate(dragY, 0, springs.snappy);
    },
    enabled: isPresent && !split && historyOpen,
  });
  // Shared with the reader, whose toolbar takes this one's place without moving.
  const headerSpacing = cn(
    // In the pane the toolbars line up with the card's edges below them.
    split ? 'pr-3 pb-3' : 'px-3 pb-1 sm:px-4',
    target.radius === 0 ? 'pt-[calc(var(--safe-top)+0.5rem)]' : 'pt-3',
  );
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
              // The editor reads its content once, and a shared note changes under its reader.
              key={shared ? note.updatedAt.getTime() : editorGeneration}
              noteId={note.id}
              initialContent={restoredContent ?? note.content}
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
          {shared && (
            <p className="px-4 pt-6 text-center text-muted-foreground text-xs">
              {owner ? `Shared by ${owner}` : 'Shared with you'} · Read only
            </p>
          )}
          <NoteTimestamp updatedAt={note.updatedAt} history={!shared} />
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
            // Its own layer, so dimming the page does not draw the page again each frame.
            className="pointer-events-none fixed inset-0 z-[49] bg-black will-change-[opacity]"
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
            // Fold a picker or editor menu before Escape leaves the note.
            if (
              historyOpen ||
              noteDockPanelOpen.get() ||
              document.querySelector('.bn-menu-dropdown[data-open]')
            ) {
              event.preventDefault();
            }
          }}
          // Using the dock (or a toast) is not leaving the editor. On touch, Radix checks the
          // target on click, after a re-render may have replaced it (Pin becomes Unpin), so a
          // detached target counts as ours too. Beside the page, the page is not outside.
          onInteractOutside={(event) => {
            if (historyOpen || split || tagFormOpen.get() || capture) {
              event.preventDefault();
              return;
            }
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (
              !target.isConnected ||
              target.closest(
                '[data-dock], [data-sonner-toaster], [aria-label="New note"], [data-link-overlay], [data-link-scrim], [data-attachment-menu], [data-share-panel], .bn-suggestion-menu, .bn-file-panel, .bn-toolbar',
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
              width,
              height,
              borderRadius,
              x,
              y,
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
                className="pointer-events-none absolute top-0 left-0 will-change-[opacity]"
                style={{ width: cardRect.current.width, opacity: ghostOpacity }}
              >
                <NoteCardFace note={note} />
              </motion.div>
            )}

            <motion.div
              className={cn(
                'relative flex min-h-0 shrink-0 flex-col',
                // Layers of their own while the surface morphs, so its moving edge cuts
                // them off without either being drawn again.
                (!settled || !isPresent) && 'will-change-[opacity]',
              )}
              // The surface can be any size; the editor keeps its viewport and scroll.
              style={{
                width: target.width,
                height: target.height,
                opacity: contentOpacity,
                y: contentY,
              }}
            >
              <motion.div
                inert={historyOpen}
                aria-hidden={historyOpen || undefined}
                className="flex min-h-0 flex-1 flex-col"
                initial={false}
                animate={{
                  opacity: historyOpen ? 0 : 1,
                  x: historyOpen && !reducedMotion ? -16 : 0,
                }}
                transition={reducedMotion ? { duration: 0 } : springs.smooth}
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
                    headerSpacing,
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
                        className={cn(
                          'absolute top-0 left-[calc(100%+0.25rem)] hidden',
                          !narrowPane && 'sm:flex',
                        )}
                      />
                    )}
                  </div>
                  <div
                    className={cn(
                      'pointer-events-none relative h-[50px] min-w-0 flex-1',
                      // Balance the buttons on the right so the centered pill clears history in
                      // narrow panes. A phone has no history there and no width to spare.
                      editable &&
                        !narrowPane &&
                        (note.isArchived ? 'sm:ml-20' : 'sm:ml-[8.0625rem]'),
                    )}
                  >
                    <SaveStatus state={state} compact={narrowPane} />
                  </div>
                  <div className="glass flex shrink-0 items-center rounded-[var(--dock-radius)] p-1">
                    {!note.deletedAt && !note.isArchived && (
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
                        <span aria-hidden className="mx-1 h-6 w-px bg-foreground/15" />
                      </>
                    )}
                    {editable && !isVaultNote(note.id) && (
                      <>
                        <Popover>
                          <PopoverTrigger asChild>
                            <IconButton
                              label="Share"
                              onClick={() => haptics.toggle()}
                              className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
                            >
                              <Share2 className={cn(hasLink && 'fill-current')} />
                            </IconButton>
                          </PopoverTrigger>
                          <PopoverContent
                            aria-label="Share"
                            align="end"
                            sideOffset={12}
                            collisionPadding={16}
                            // Named so the note does not take a tap in here for a tap outside it.
                            data-share-panel
                            className="z-[70] w-96 max-w-[calc(100vw-2rem)] rounded-3xl p-1 pb-2"
                          >
                            <SharePanel note={note} getContent={controls?.getContent} />
                          </PopoverContent>
                        </Popover>
                        <span aria-hidden className="mx-1 h-6 w-px bg-foreground/15" />
                      </>
                    )}
                    {!note.deletedAt && (
                      <IconButton
                        label={note.isArchived ? 'Unarchive' : 'Archive'}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          haptics.selection();
                          void flush().catch(() => {});
                          setNoteArchived(note.id, !note.isArchived);
                          if (!note.isArchived) requestClose();
                        }}
                        className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
                      >
                        {note.isArchived ? <ArchiveRestore /> : <Archive />}
                      </IconButton>
                    )}
                    {/* A shared note is not the reader's to trash; the dock removes it. */}
                    {!shared && (
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
                    )}
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
              <AnimatePresence>
                {historyOpen && (
                  <motion.div
                    key="note-history"
                    className={cn(
                      'absolute inset-0 z-30 flex min-h-0 flex-col',
                      // Full screen it covers the note and stops above the dock, which holds
                      // its versions; a panel or a pane already ends there.
                      fullscreen &&
                        'bg-note pb-[calc(var(--dock-height)+var(--dock-bottom)+0.5rem)]',
                    )}
                    initial={{ opacity: 0, x: reducedMotion ? 0 : 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: reducedMotion ? 0 : 24, pointerEvents: 'none' }}
                    transition={reducedMotion ? { duration: 0 } : springs.smooth}
                  >
                    {historyReady ? (
                      <NoteHistory
                        note={note}
                        onClose={closeHistory}
                        onRestored={historyRestored}
                        split={split}
                        wide={target.width >= HISTORY_LIST_MIN}
                        headerClassName={headerSpacing}
                        scrollRef={historyScrollRef}
                      />
                    ) : (
                      <div className="flex flex-1 flex-col">
                        <div className={cn('flex', headerSpacing)}>
                          <div className="glass flex rounded-[var(--dock-radius)] p-1">
                            <IconButton
                              label="Back to note"
                              onClick={closeHistory}
                              className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
                            >
                              <ChevronLeft />
                            </IconButton>
                          </div>
                        </div>
                        <p role="status" className="px-5 pt-4 text-muted-foreground text-sm">
                          Saving the current version…
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
