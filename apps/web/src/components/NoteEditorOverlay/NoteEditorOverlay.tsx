import type { Note } from '@catch/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { ChevronLeft, Pin } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  usePresence,
  useTransform,
} from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteCardFace } from '@/components/NoteCard/NoteCard';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { NoteToolbar } from '@/components/NoteToolbar/NoteToolbar';
import { SaveStatus } from '@/components/SaveStatus/SaveStatus';
import { notesCollection } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { useKeyboardOpen } from '@/lib/keyboard';
import { springs } from '@/lib/motion';
import { discardIfEmpty, setNotePinned } from '@/lib/notes';
import {
  editorProgress,
  hideCard,
  measureCard,
  type Rect,
  showCard,
  takeOrigin,
} from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { useNoteAutosave } from '@/lib/useNoteAutosave';
import { cn } from '@/lib/utils';

/** Pulling the editor down this far (in px) closes it on release. */
const DISMISS_DISTANCE = 110;

type Props = {
  noteId: string | undefined;
};

/**
 * The open note, full screen on phones and a centered panel on wider screens. It grows
 * out of the card that opened it and shrinks back into that card when it closes.
 */
/** Where the surface scales from while it is pulled down. */
const ORIGIN = { x: 0.5, y: 0.2 };
/** How much a spring's overshoot scales the surface (1.04 progress → 1.04 scale). */
const POP_STRENGTH = 1;

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

/** The editor's rectangle: the whole screen on phones, a centered panel otherwise. */
function useTargetRect(): Rect {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (viewport.width < 640) return { x: 0, y: 0, ...viewport, radius: 0 };
  const width = Math.min(672, viewport.width - 64);
  const height = Math.min(Math.round(viewport.height * 0.85), 820);
  return {
    x: Math.round((viewport.width - width) / 2),
    y: Math.round((viewport.height - height) / 2),
    width,
    height,
    radius: 24,
  };
}

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

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
  const target = useTargetRect();
  const targetRef = useRef(target);
  targetRef.current = target;
  const editable = !note.deletedAt;
  const [controls, setControls] = useState<EditorControls | null>(null);
  // While typing on a touch screen, the footer trades the note's actions for formatting.
  const keyboardOpen = useKeyboardOpen();
  const formatting = keyboardOpen && editable && controls !== null;

  // Where the surface morphs from (opening) or to (closing). Null means no card to
  // morph with, so the editor fades instead.
  const [origin] = useState(() => takeOrigin(note.id));
  const cardRect = useRef<Rect | null>(origin);
  const [settled, setSettled] = useState(false);

  const progress = editorProgress;
  const fade = useMotionValue(origin ? 1 : 0);
  const dragY = useMotionValue(0);
  const dragScale = useTransform(dragY, [0, 700], [1, 0.72]);

  // Container transform: translate the surface so its top-left sits on the card, and
  // clip it to the card's size. Content is never scaled, so text stays crisp.
  // The springs overshoot, but the geometry cannot (a full-screen surface pushed past its
  // place would bare the screen edge), so it follows the progress clamped to 0..1 and the
  // overshoot becomes a brief scale instead: a pop past full size on open, a small
  // squash into the card on close.
  const geometry = () => Math.min(1, Math.max(0, progress.get()));
  const pop = () => {
    const overshoot = progress.get() - geometry();
    return 1 + overshoot * POP_STRENGTH;
  };
  // Motion scales about the transform origin; this shifts the surface so the pop centres on
  // the screen (open) or on the card (close) instead.
  const popOffset = (axis: 'x' | 'y') => {
    const t = targetRef.current;
    const card = cardRect.current;
    const size = axis === 'x' ? t.width : t.height;
    const pivot =
      progress.get() < 0.5 && card ? (axis === 'x' ? card.width : card.height) / 2 : size / 2;
    const originAt = size * (axis === 'x' ? ORIGIN.x : ORIGIN.y);
    return (1 - pop()) * (pivot - originAt);
  };
  const x = useTransform(() => {
    const card = cardRect.current;
    const offset = card ? (1 - geometry()) * (card.x - targetRef.current.x) : 0;
    return offset + popOffset('x');
  });
  const y = useTransform(() => {
    const card = cardRect.current;
    const offset = card ? (1 - geometry()) * (card.y - targetRef.current.y) : 0;
    return offset + popOffset('y') + dragY.get() + (1 - fade.get()) * 48;
  });
  const scale = useTransform(() => dragScale.get() * pop());
  const clipPath = useTransform(() => {
    const card = cardRect.current;
    const t = targetRef.current;
    const p = geometry();
    if (!card) return `inset(0px round ${t.radius}px)`;
    const right = (1 - p) * (t.width - card.width);
    const bottom = (1 - p) * (t.height - card.height);
    const radius = lerp(card.radius, t.radius || 28 * Math.min(1, dragY.get() / 80), p);
    return `inset(0px ${Math.max(0, right)}px ${Math.max(0, bottom)}px 0px round ${radius}px)`;
  });
  const ghostOpacity = useTransform(() => (cardRect.current ? 1 - geometry() / 0.35 : 0));
  const contentOpacity = useTransform(() =>
    cardRect.current ? (geometry() - 0.25) / 0.45 : fade.get(),
  );
  const backdropOpacity = useTransform(() => geometry() * 0.35);

  // Open: grow out of the card, then swap the preview for the real editor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; the key fixes the note
  useLayoutEffect(() => {
    if (origin) hideCard(note.id);
    progress.set(0);
    const animations = [animate(progress, 1, springs.expand)];
    if (!origin) animations.push(animate(fade, 1, springs.smooth));
    void Promise.all(animations).then(() => setSettled(true));
  }, []);

  // Close (from any cause, including the back gesture): save, drop an empty note, then
  // shrink into the note's card, or fade out when it has none.
  useEffect(() => {
    if (isPresent) return;
    flush();
    const discarded = discardIfEmpty(note.id);
    cardRect.current = discarded ? null : measureCard(note.id);
    if (cardRect.current) hideCard(note.id);
    rerender((n) => n + 1);

    const animations = [
      animate(progress, 0, springs.collapse),
      animate(dragY, 0, springs.collapse),
    ];
    if (!cardRect.current) animations.push(animate(fade, 0, springs.smooth));
    void Promise.all(animations).then(() => {
      showCard(note.id);
      safeToRemove();
    });
  }, [isPresent, flush, note.id, dragY, fade, safeToRemove]);

  const scrollRef = usePullToDismiss({ dragY, onDismiss: requestClose, enabled: isPresent });

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && requestClose()}>
      <DialogPrimitive.Portal>
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 bg-black"
          style={{ opacity: backdropOpacity }}
        />
        <DialogPrimitive.Content
          asChild
          // Focusing the editor would raise the keyboard before the user asks for it.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <motion.div
            data-note-color={note.color}
            className="fixed z-50 flex flex-col overflow-hidden bg-note text-card-foreground outline-none"
            style={{
              left: target.x,
              top: target.y,
              width: target.width,
              height: target.height,
              x,
              y,
              clipPath,
              scale,
              transformOrigin: `${ORIGIN.x * 100}% ${ORIGIN.y * 100}%`,
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
              style={{ opacity: contentOpacity }}
            >
              <header
                className={cn(
                  'flex shrink-0 items-center gap-1 px-2',
                  target.radius === 0 ? 'pt-[var(--safe-top)]' : 'pt-2',
                )}
              >
                <IconButton label="Close" onClick={requestClose} className="size-10 [&_svg]:size-6">
                  <ChevronLeft />
                </IconButton>
                <div className="flex flex-1 justify-center">
                  <SaveStatus state={state} updatedAt={note.updatedAt} />
                </div>
                {editable && !note.isArchived ? (
                  <IconButton
                    label={note.isPinned ? 'Unpin' : 'Pin'}
                    onClick={() => {
                      haptics.toggle();
                      setNotePinned(note.id, !note.isPinned);
                    }}
                    className="size-10 [&_svg]:size-5"
                  >
                    <Pin className={cn(note.isPinned && 'fill-current')} />
                  </IconButton>
                ) : (
                  <span className="size-10" />
                )}
              </header>

              <div
                ref={scrollRef}
                className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-6"
              >
                {settled ? (
                  <LazyNoteEditor
                    initialContent={note.content}
                    onChange={save}
                    onControls={setControls}
                    editable={editable}
                    fallback={
                      <NotePreview content={note.content} maxBlocks={200} variant="editor" />
                    }
                  />
                ) : (
                  <NotePreview content={note.content} maxBlocks={200} variant="editor" />
                )}
              </div>

              <footer
                className={cn(
                  'relative flex h-[calc(2.875rem+var(--footer-inset))] shrink-0 items-start overflow-hidden border-foreground/10 border-t px-2 pt-1.5',
                  // Rides on top of the keyboard, in step with it.
                  target.radius === 0
                    ? '[--footer-inset:calc(max(var(--safe-bottom),var(--keyboard),0.25rem)+0.25rem)]'
                    : '[--footer-inset:0.375rem]',
                )}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {formatting ? (
                    <motion.div
                      key="format"
                      className="flex w-full justify-center"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 14 }}
                      transition={springs.snappy}
                    >
                      <FormattingBar controls={controls} className="[&_button]:size-10" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="actions"
                      className="flex w-full"
                      initial={{ opacity: 0, y: -14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -14 }}
                      transition={springs.snappy}
                    >
                      <NoteToolbar
                        note={note}
                        onDone={requestClose}
                        className="w-full justify-around [&_button]:size-10 [&_svg]:size-5"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </footer>
            </motion.div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Pulling down on the editor while it is scrolled to the top drags it toward its card;
 * letting go past DISMISS_DISTANCE closes it. Touch events (rather than pointer events)
 * let the gesture take over from scrolling mid-drag.
 */
function usePullToDismiss({
  dragY,
  onDismiss,
  enabled,
}: {
  dragY: MotionValue<number>;
  onDismiss: () => void;
  enabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let startY: number | null = null;
    let dragging = false;
    let armed = false;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;

    function onStart(event: TouchEvent) {
      if (!element || element.scrollTop > 0 || event.touches.length > 1) return;
      startY = event.touches[0]?.clientY ?? null;
      dragging = false;
      armed = false;
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (startY === null || !touch || !element) return;
      const delta = touch.clientY - startY;
      if (!dragging) {
        if (delta < 8 || element.scrollTop > 0) {
          if (delta < 0) startY = null;
          return;
        }
        dragging = true;
        // Typing into a note while pulling it away would be surprising.
        (document.activeElement as HTMLElement | null)?.blur();
      }
      event.preventDefault();
      const now = performance.now();
      velocity = (touch.clientY - lastY) / Math.max(1, now - lastTime);
      lastY = touch.clientY;
      lastTime = now;
      // Rubber-band: the surface follows the finger less the further it goes.
      const distance = delta - 8;
      dragY.set(distance < 0 ? 0 : distance * 0.75);
      const past = distance > DISMISS_DISTANCE;
      if (past !== armed) {
        armed = past;
        if (past) haptics.threshold();
      }
    }

    function onEnd() {
      if (dragging && (armed || velocity > 0.6)) onDismissRef.current();
      else if (dragging) animate(dragY, 0, springs.snappy);
      startY = null;
      dragging = false;
    }

    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, [dragY, enabled]);

  return ref;
}
