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
import { useEffect, useRef, useState } from 'react';
import { AttachmentPicker } from '@/components/AttachmentPicker/AttachmentPicker';
import { ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteCardFace } from '@/components/NoteCard/NoteCard';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { useNoteAttachments } from '@/lib/attachments';
import { getSignedInUser } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import { useTagReadiness, useTags } from '@/lib/collections';
import { quickNote, quickNoteCanSave, tabFor } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { linkCaptureOpen, linkCaptureOrigin, linkCaptureReturnFocus } from '@/lib/linkCapture';
import { animateSteady, curves, springs } from '@/lib/motion';
import { createNote, discardIfEmpty, getNote, setNoteColor, updateNote } from '@/lib/notes';
import { findCard, hideCard, showCard } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { cn } from '@/lib/utils';
import { useQuickNoteSwipe } from './useQuickNoteSwipe';

type Destination = 'gallery' | 'deck';

/** How the window leaves: back into the button, into the saved note's card, or at once. */
type Exit =
  | { kind: 'button' }
  | { kind: 'card'; noteId: string }
  | { kind: 'instant' }
  | { kind: 'capture' };

/**
 * The quick-note window that opens above the dock from the compose button. Closing it
 * saves the note (if it has content) and flies the window into the new card.
 */
export function QuickNote() {
  const state = quickNote.use();
  const open = state === 'open';
  const retained = open || state === 'capture';
  const exit = useRef<Exit>({ kind: 'button' });

  return (
    <>
      <AnimatePresence custom={exit.current.kind}>
        {open && (
          <motion.div
            key="scrim"
            aria-hidden
            // touch-none: swipes starting on the scrim never become a scroll or
            // overscroll, so the page behind can't stretch while the window is up.
            className="fixed inset-0 z-[65] touch-none bg-black/25"
            initial={{ opacity: linkCaptureOrigin.get() ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit="leave"
            variants={{
              leave: (kind: Exit['kind']) => ({
                opacity: 0,
                transition: { duration: kind === 'capture' ? 0 : 0.25 },
              }),
            }}
            transition={{ duration: 0.25 }}
            // Tapping away saves, like the close button.
            onClick={() => quickNote.set('closed')}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {retained && <QuickNoteWindow key="window" exit={exit} suspended={!open} />}
      </AnimatePresence>
    </>
  );
}

function QuickNoteWindow({ exit, suspended }: { exit: { current: Exit }; suspended: boolean }) {
  const [isPresent, safeToRemove] = usePresence();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open: openNote } = useOpenNote();
  const ref = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState<Note['content']>([]);
  const tags = useTags();
  const { awaitingTags } = useTagReadiness();
  const [color, setColor] = useState<NoteColor>('default');
  const [controls, setControls] = useState<EditorControls | null>(null);
  // The footer's tool row shows either formatting or the color swatches.
  const [attachmentPanel, setAttachmentPanel] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const attachments = useNoteAttachments(draftId ?? '');
  const draft = useRef<string | null>(null);
  const [tools, setTools] = useState<'format' | 'color'>('format');
  const [destination, setDestination] = useState<Destination>(
    tabFor(pathname) === '/deck' ? 'deck' : 'gallery',
  );
  // Read by the exit effect, which runs after the last render.
  const latest = useRef({ content, color, destination });
  latest.current = { content, color, destination };

  const y = useMotionValue(0);
  const flight = useMotionValue(0);
  const landing = useRef<{ card: HTMLElement; self: DOMRect; box: DOMRect } | null>(null);
  // Measured on every frame of the flight: the new card is still sliding into its place in
  // the grid when the window sets off, and a spot measured once would be where it was.
  const flightTarget = useTransform(() => {
    flight.get();
    const to = landing.current;
    if (!to) return null;
    // The grid may stop rendering the card; the window then finishes where it last was.
    if (to.card.isConnected) to.box = to.card.getBoundingClientRect();
    return {
      dx: to.box.left - to.self.left,
      dy: to.box.top - to.self.top,
      right: Math.max(0, to.self.width - to.box.width),
      bottom: Math.max(0, to.self.height - to.box.height),
    };
  });
  const flightX = useTransform(() => (flightTarget.get()?.dx ?? 0) * flight.get());
  const flightY = useTransform(() => (flightTarget.get()?.dy ?? 0) * flight.get() + y.get());
  const borderRadius = useTransform(() => 28 - 12 * flight.get());
  const clipPath = useTransform(() => {
    const target = flightTarget.get();
    const p = flight.get();
    // A clip path also cuts off the surface's own shadow; only the flight needs one.
    if (!target) return 'none';
    return `inset(0px ${target.right * p}px ${target.bottom * p}px 0px round ${borderRadius.get()}px)`;
  });
  // The window lands looking like the card it becomes: its own contents fade out early in
  // the flight and the saved note's card face fades in over them, so showing the real card
  // at the end changes nothing on screen.
  const [face, setFace] = useState<{ note: Note; width: number } | null>(null);
  const contentOpacity = useTransform(flight, [0, 0.4], [1, 0]);
  const faceOpacity = useTransform(flight, [0.3, 0.75], [0, 1]);

  useEffect(() => {
    quickNoteCanSave.set(blocksHaveContent(content) || attachments.length > 0);
  }, [content, attachments.length]);
  useEffect(() => () => quickNoteCanSave.set(false), []);

  useEffect(() => {
    if (!suspended) {
      exit.current = { kind: 'button' };
    }
  }, [suspended, exit]);

  function create() {
    const { content, color, destination } = latest.current;
    // Remembered rather than fetched, so notes can be created offline.
    const user = getSignedInUser();
    if (!user) return null;
    if (draft.current) {
      updateNote(draft.current, {
        content,
        status: destination === 'deck' ? DEFAULT_BOARD_STATUS : null,
      });
      setNoteColor(draft.current, color);
      return draft.current;
    }
    return createNote({
      userId: user.id,
      content,
      color,
      status: destination === 'deck' ? DEFAULT_BOARD_STATUS : null,
    }).id;
  }

  function ensureNote() {
    if (!draft.current) {
      draft.current = create();
      setDraftId(draft.current);
    }
    return draft.current;
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

  function captureLink() {
    haptics.toggle();
    linkCaptureReturnFocus.set(controls ? () => controls.focus() : null);
    const box = ref.current?.getBoundingClientRect();
    linkCaptureOrigin.set(
      box ? { x: box.x, y: box.y, width: box.width, height: box.height, radius: 28 } : null,
    );
    const candidate = blocksHaveContent(latest.current.content) || draft.current ? create() : null;
    draft.current = candidate && !discardIfEmpty(candidate) ? candidate : null;
    setDraftId(draft.current);
    exit.current = { kind: 'capture' };
    quickNote.set('capture');
    linkCaptureOpen.set(true);
  }

  // Closing (from the button, a tap outside, a swipe or the back gesture) saves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when removed
  useEffect(() => {
    if (isPresent) return;
    const kind = exit.current.kind;
    exit.current = { kind: 'button' };
    if (kind === 'instant' || suspended) {
      // Let the editor paint over this window first.
      requestAnimationFrame(() => requestAnimationFrame(() => safeToRemove()));
      return;
    }

    const hasContent = blocksHaveContent(latest.current.content);
    const candidate = hasContent || draft.current ? create() : null;
    const id = candidate && !discardIfEmpty(candidate) ? candidate : null;
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

    const finish = () => {
      showCard(id);
      safeToRemove();
    };
    // Wait for the new card to render, then fly into it if it is on screen.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const card = findCard(id);
        const box = card?.getBoundingClientRect();
        const self = ref.current?.getBoundingClientRect();
        const note = getNote(id);
        const visible = box && box.bottom > 0 && box.top < window.innerHeight;
        if (!card || !box || !self || !note || !visible) {
          void shrinkIntoButton().then(finish);
          return;
        }
        landing.current = { card, self, box };
        setFace({ note, width: box.width });
        // A frame later again, once the card's face is mounted on the window. A curve ends
        // on time; a spring's promise waits out a tail nobody can see, holding the card back.
        requestAnimationFrame(() => void animateSteady(flight, 1, curves.collapse).then(finish));
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

  useBackHandler(isPresent && !suspended, () => quickNote.set('closed'));

  useQuickNoteSwipe({
    surface: ref,
    handle: handleRef,
    y,
    enabled: isPresent && !suspended,
    onSave: () => quickNote.set('closed'),
    onExpand: expand,
  });

  return (
    <motion.section
      ref={ref}
      aria-label="New note"
      aria-hidden={suspended || undefined}
      inert={suspended}
      data-note-color={color}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
          if (attachmentPanel) setAttachmentPanel(false);
          else quickNote.set('closed');
        }
      }}
      className={cn(
        'fixed inset-x-3 z-[70] mx-auto flex max-w-md flex-col overflow-hidden rounded-[28px] bg-note text-card-foreground shadow-[0_24px_60px_-12px_oklch(0_0_0/0.45)]',
        'bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.75rem)] max-h-[calc(100dvh-var(--safe-top)-var(--dock-bottom)-var(--dock-height)-2rem)]',
        (!isPresent || suspended) && 'pointer-events-none',
        suspended && 'invisible',
      )}
      style={{
        x: flightX,
        y: flightY,
        scale,
        opacity,
        borderRadius,
        clipPath,
        // Grow out of the compose button, below the window's bottom-right corner.
        transformOrigin: 'calc(100% - 32px) calc(100% + 44px)',
      }}
    >
      <motion.div
        ref={handleRef}
        aria-hidden
        data-testid="quick-note-handle"
        className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1"
        // A card has no handle, so it leaves with the rest of the window's contents.
        style={{ opacity: contentOpacity }}
      >
        <span className="h-1 w-9 rounded-full bg-foreground/20" />
      </motion.div>
      <motion.div
        data-quick-note-body
        className="flex min-h-0 flex-1 flex-col"
        style={{ opacity: contentOpacity }}
      >
        <motion.div
          data-quick-note-scroll
          className="min-h-28 flex-1 overflow-y-auto overscroll-contain"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.06 }}
        >
          <LazyNoteEditor
            noteId={draftId ?? undefined}
            ensureNote={ensureNote}
            onChange={(next) => {
              setContent(next);
              if (draft.current) updateNote(draft.current, { content: next });
            }}
            onControls={setControls}
            autoFocus
          />
        </motion.div>
        <AnimatePresence initial={false}>
          {attachmentPanel && draftId && (
            <motion.div
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.smooth}
            >
              <AttachmentPicker
                noteId={draftId}
                controls={controls}
                onDone={() => setAttachmentPanel(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
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
                  <FormattingBar
                    controls={controls}
                    onLink={captureLink}
                    attachmentsOpen={attachmentPanel}
                    onAttachments={() => {
                      ensureNote();
                      setAttachmentPanel(!attachmentPanel);
                    }}
                    className="flex-1"
                  />
                ) : (
                  <ColorSwatches
                    tags={tags}
                    disabled={awaitingTags}
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
      {face && (
        <motion.div
          aria-hidden
          data-quick-note-face
          className="pointer-events-none absolute top-0 left-0"
          style={{ width: face.width, opacity: faceOpacity }}
        >
          <NoteCardFace note={face.note} />
        </motion.div>
      )}
    </motion.section>
  );
}
