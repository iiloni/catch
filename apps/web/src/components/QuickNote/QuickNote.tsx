import { blocksHaveContent, DEFAULT_BOARD_STATUS, type Note, type NoteColor } from '@catch/shared';
import { useRouterState } from '@tanstack/react-router';
import { Columns3, LayoutGrid, Maximize2, Palette, Type } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  usePresence,
  useTransform,
} from 'motion/react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { IconButton } from '@/components/IconButton/IconButton';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { authClient } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import { quickNote, tabFor } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { createNote } from '@/lib/notes';
import { findCard, hideCard, showCard } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { cn } from '@/lib/utils';

type Destination = 'gallery' | 'deck';

/** How the window leaves: back into the button, into the saved note's card, or at once. */
type Exit = { kind: 'button' } | { kind: 'card'; noteId: string } | { kind: 'instant' };

/**
 * The quick-note window that opens above the dock from the compose button. Closing it
 * saves the note (if it has content) and flies the window into the new card.
 */
export function QuickNote() {
  const state = quickNote.use();
  const open = state === 'open';
  const exit = useRef<Exit>({ kind: 'button' });

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            aria-hidden
            // touch-none: swipes starting on the scrim never become a scroll or
            // overscroll, so the page behind can't stretch while the window is up.
            className="fixed inset-0 z-30 touch-none bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            // Tapping away saves, like the close button.
            onClick={() => quickNote.set('closed')}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{open && <QuickNoteWindow key="window" exit={exit} />}</AnimatePresence>
    </>
  );
}

function QuickNoteWindow({ exit }: { exit: { current: Exit } }) {
  const [isPresent, safeToRemove] = usePresence();
  const { data: session } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open: openNote } = useOpenNote();
  const ref = useRef<HTMLElement>(null);

  const [content, setContent] = useState<Note['content']>([]);
  const [color, setColor] = useState<NoteColor>('default');
  const [controls, setControls] = useState<EditorControls | null>(null);
  // The footer's tool row shows either formatting or the color swatches.
  const [tools, setTools] = useState<'format' | 'color'>('format');
  const [destination, setDestination] = useState<Destination>(
    tabFor(pathname) === '/deck' ? 'deck' : 'gallery',
  );
  // Read by the exit effect, which runs after the last render.
  const latest = useRef({ content, color, destination });
  latest.current = { content, color, destination };

  const y = useMotionValue(0);
  const flight = useMotionValue(0);
  const flightTarget = useRef<{ dx: number; dy: number; right: number; bottom: number } | null>(
    null,
  );
  const flightX = useTransform(() => (flightTarget.current?.dx ?? 0) * flight.get());
  const flightY = useTransform(() => (flightTarget.current?.dy ?? 0) * flight.get() + y.get());
  const clipPath = useTransform(() => {
    const target = flightTarget.current;
    const p = flight.get();
    if (!target) return 'inset(0px round 28px)';
    return `inset(0px ${target.right * p}px ${target.bottom * p}px 0px round ${28 - 12 * p}px)`;
  });
  const contentOpacity = useTransform(flight, [0, 0.5], [1, 0]);

  function create() {
    const { content, color, destination } = latest.current;
    if (!session) return null;
    return createNote({
      userId: session.user.id,
      content,
      color,
      status: destination === 'deck' ? DEFAULT_BOARD_STATUS : null,
    }).id;
  }

  function expand() {
    const element = ref.current;
    const id = create();
    if (!element || !id) return;
    haptics.toggle();
    exit.current = { kind: 'instant' };
    // The editor grows out of this window's rectangle, so the swap is seamless.
    openNote(id, element);
    quickNote.set('closed');
  }

  // Closing (from the button, a tap outside, a swipe or the back gesture) saves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when removed
  useEffect(() => {
    if (isPresent) return;
    const kind = exit.current.kind;
    exit.current = { kind: 'button' };
    if (kind === 'instant') {
      // Let the editor paint over this window first.
      requestAnimationFrame(() => requestAnimationFrame(() => safeToRemove()));
      return;
    }

    const hasContent = blocksHaveContent(latest.current.content);
    const id = hasContent ? create() : null;
    if (!id) {
      void shrinkIntoButton().then(() => safeToRemove());
      return;
    }

    haptics.success();
    hideCard(id);
    quickNote.set('saved');
    window.setTimeout(() => {
      if (quickNote.get() === 'saved') quickNote.set('closed');
    }, 900);

    // Wait for the new card to render, then fly into it if it is on screen.
    requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        const card = findCard(id);
        const box = card?.getBoundingClientRect();
        const self = ref.current?.getBoundingClientRect();
        const visible = box && box.bottom > 0 && box.top < window.innerHeight;
        if (box && self && visible) {
          flightTarget.current = {
            dx: box.left - self.left,
            dy: box.top - self.top,
            right: Math.max(0, self.width - box.width),
            bottom: Math.max(0, self.height - box.height),
          };
          await animate(flight, 1, springs.smooth);
        } else {
          await shrinkIntoButton();
        }
        showCard(id);
        safeToRemove();
      }),
    );
  }, [isPresent]);

  const scale = useMotionValue(0.3);
  const opacity = useMotionValue(0);

  useEffect(() => {
    animate(scale, 1, springs.bouncy);
    animate(opacity, 1, { duration: 0.18 });
  }, [scale, opacity]);

  // The gallery behind stays put while the window is up (including its exit
  // animation); the editor inside still scrolls. Cleanup restores the overflow.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prevBody = body.style.overflow;
    const prevHtml = html.style.overflow;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevBody;
      html.style.overflow = prevHtml;
    };
  }, []);

  function shrinkIntoButton() {
    return Promise.all([
      animate(scale, 0.3, springs.smooth),
      animate(opacity, 0, { duration: 0.2 }),
      animate(y, 0, springs.smooth),
    ]);
  }

  useBackHandler(isPresent, () => quickNote.set('closed'));

  // Swiping the grab handle down closes (and saves), like a sheet. The drag is
  // capped so the window stops instead of following the finger off screen.
  const DISMISS_DISTANCE = 90;
  const MAX_DRAG = 160;
  const swipe = useRef<{
    startY: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    armed: boolean;
  }>(null);
  function onHandleDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    swipe.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      armed: false,
    };
  }
  function onHandleMove(event: PointerEvent<HTMLDivElement>) {
    const state = swipe.current;
    if (!state) return;
    state.velocity = (event.clientY - state.lastY) / Math.max(1, event.timeStamp - state.lastTime);
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    const delta = event.clientY - state.startY;
    if (delta < 0) {
      // Resist upward pulls; follow downward ones, up to the cap.
      y.set(delta * 0.1);
      if (state.armed) state.armed = false;
      return;
    }
    y.set(Math.min(delta * 0.8, MAX_DRAG));
    const past = delta > DISMISS_DISTANCE;
    if (past !== state.armed) {
      state.armed = past;
      if (past) haptics.threshold();
    }
  }
  function onHandleUp(event: PointerEvent<HTMLDivElement>) {
    const state = swipe.current;
    swipe.current = null;
    if (!state) return;
    if (event.clientY - state.startY > DISMISS_DISTANCE || state.velocity > 0.6)
      quickNote.set('closed');
    else animate(y, 0, springs.snappy);
  }

  return (
    <motion.section
      ref={ref}
      aria-label="New note"
      data-note-color={color}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
          quickNote.set('closed');
        }
      }}
      className={cn(
        'fixed right-[calc(var(--note-pane)+0.75rem)] left-3 z-40 mx-auto flex max-w-md flex-col rounded-[28px] bg-note text-card-foreground shadow-[0_24px_60px_-12px_oklch(0_0_0/0.45)]',
        'bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.75rem)] max-h-[calc(100dvh-var(--safe-top)-var(--dock-bottom)-var(--dock-height)-2rem)]',
        !isPresent && 'pointer-events-none',
      )}
      style={{
        x: flightX,
        y: flightY,
        scale,
        opacity,
        clipPath,
        // Grow out of the compose button, below the window's bottom-right corner.
        transformOrigin: 'calc(100% - 32px) calc(100% + 44px)',
      }}
    >
      <div
        aria-hidden
        className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        <span className="h-1 w-9 rounded-full bg-foreground/20" />
      </div>
      <motion.div className="flex min-h-0 flex-1 flex-col" style={{ opacity: contentOpacity }}>
        <motion.div
          className="min-h-28 flex-1 overflow-y-auto overscroll-contain"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.06 }}
        >
          <LazyNoteEditor onChange={setContent} onControls={setControls} autoFocus />
        </motion.div>
        <motion.footer
          className="flex shrink-0 items-center gap-1.5 px-3 pt-1 pb-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.12 }}
        >
          <motion.button
            type="button"
            aria-label={tools === 'format' ? 'Colors' : 'Formatting'}
            // Keeps the keyboard up, like the formatting buttons.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              haptics.toggle();
              setTools(tools === 'format' ? 'color' : 'format');
            }}
            whileTap={{ scale: 0.86 }}
            transition={springs.snappy}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.07] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={tools}
                initial={{ opacity: 0, rotate: -60, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 60, scale: 0.6 }}
                transition={springs.snappy}
              >
                {tools === 'format' ? (
                  <Palette className="size-[18px]" aria-hidden />
                ) : (
                  <Type className="size-[18px]" aria-hidden />
                )}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <div className="relative flex min-w-0 flex-1 items-center overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={tools}
                className="flex min-w-0 flex-1"
                // Picking a color keeps the keyboard up too.
                onPointerDown={(event) => event.preventDefault()}
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
                transition={springs.snappy}
              >
                {tools === 'format' ? (
                  <FormattingBar controls={controls} className="flex-1" />
                ) : (
                  <ColorSwatches
                    value={color}
                    onChange={setColor}
                    layout="row"
                    className="min-w-0 flex-1"
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <IconButton
            label={`Save to ${destination === 'gallery' ? 'Gallery' : 'Deck'}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              haptics.selection();
              setDestination(destination === 'gallery' ? 'deck' : 'gallery');
            }}
            className="size-9 shrink-0 rounded-xl bg-foreground/[0.07]"
          >
            {destination === 'gallery' ? <LayoutGrid /> : <Columns3 />}
          </IconButton>
          <IconButton label="Expand" onClick={expand} className="size-9 shrink-0 rounded-xl">
            <Maximize2 />
          </IconButton>
        </motion.footer>
      </motion.div>
    </motion.section>
  );
}
