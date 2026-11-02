import {
  blocksHaveContent,
  DEFAULT_BOARD_STATUS,
  type Note,
  type NoteColor,
  tagColor,
} from '@catch/shared';
import { useRouterState } from '@tanstack/react-router';
import { Columns3, LayoutGrid, Maximize2, Palette } from 'lucide-react';
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
import { ColorTagSelector } from '@/components/ColorPicker/ColorPicker';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteCardFace } from '@/components/NoteCard/NoteCard';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNoteAttachments } from '@/lib/attachments';
import { getSignedInUser } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import { useTags } from '@/lib/collections';
import {
  quickNote,
  quickNoteCanSave,
  quickNoteColumn,
  quickNoteFocusRequest,
  quickNoteMounted,
  tabFor,
} from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { useKeyboardHeight } from '@/lib/keyboard';
import { linkCaptureOpen, linkCaptureOrigin, linkCaptureReturnFocus } from '@/lib/linkCapture';
import { animateSteady, curves, springs } from '@/lib/motion';
import { createNote, discardIfEmpty, getNote, setNoteColor, updateNote } from '@/lib/notes';
import { findCard, hideCard, showCard } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { setPrimaryTag } from '@/lib/tags';
import { cn } from '@/lib/utils';
import { beforeVaultLock, isVaultMode, vaultStatus } from '@/lib/vault';
import { focusWidgetInput } from '@/lib/widgetInputFocus';
import { useQuickNoteSwipe } from './useQuickNoteSwipe';

type Destination = 'gallery' | 'deck';
type Panel = 'attachments' | 'colors';

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

/** Radix would move focus into and out of the color picker, closing the keyboard. */
function keepEditorFocus(event: Event) {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.isContentEditable) event.preventDefault();
}

/**
 * The chooser every other note color picker uses, so a new note can take a child tag too. It
 * floats over the window: with the keyboard up the window has no room to grow around it.
 */
function QuickNoteColors({
  open,
  onOpenChange,
  ...selector
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: NoteColor;
  primaryTagId: string | null;
  onChange: (color: NoteColor) => void;
  onTagChange: (id: string) => void;
}) {
  const keyboard = useKeyboardHeight();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          label="Background color"
          // Keeps the keyboard up, like the formatting buttons.
          onPointerDown={(event) => event.preventDefault()}
          onClick={haptics.toggle}
          className="size-9 shrink-0 rounded-xl bg-foreground/[0.07]"
        >
          <Palette />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={12}
        collisionPadding={{ top: 12, right: 12, left: 12, bottom: keyboard + 12 }}
        className="z-[80] max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-3xl p-1"
        onOpenAutoFocus={keepEditorFocus}
        onCloseAutoFocus={keepEditorFocus}
        // Focus stays in the editor, so without this the window would close along with it.
        onEscapeKeyDown={(event) => event.stopPropagation()}
        // Picking a color keeps the keyboard up too. The new tag form renders through this
        // element, and needs its presses to reach its fields.
        onPointerDown={(event) => {
          if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
        }}
      >
        {/* A new note owns its assignment and can use cached tags offline. */}
        <ColorTagSelector disabled={false} {...selector} />
      </PopoverContent>
    </Popover>
  );
}

/** Where the window sits once its opening spring has settled, whether or not it has yet. */
function restingBox(element: HTMLElement) {
  const { transform } = element.style;
  element.style.transform = 'none';
  const box = element.getBoundingClientRect();
  element.style.transform = transform;
  return box;
}

function QuickNoteWindow({ exit, suspended }: { exit: { current: Exit }; suspended: boolean }) {
  const [isPresent, safeToRemove] = usePresence();
  useEffect(() => {
    quickNoteMounted.set(true);
    return () => quickNoteMounted.set(false);
  }, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open: openNote } = useOpenNote();
  const ref = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState<Note['content']>([]);
  const tags = useTags();
  const [color, setColor] = useState<NoteColor>('default');
  const [chosenTagId, setChosenTagId] = useState<string | null>(null);
  // The tag may have been deleted on another device while this note was being written.
  const primaryTag = tags.find((tag) => tag.id === chosenTagId);
  const primaryTagId = primaryTag?.id ?? null;
  const shownColor = primaryTagId ? tagColor(tags, primaryTagId) : color;
  const [controls, setControls] = useState<EditorControls | null>(null);
  const requestedFocus = quickNoteFocusRequest.use();
  useEffect(() => {
    if (!isPresent || suspended) {
      quickNoteFocusRequest.set(0);
      return;
    }
    if (!requestedFocus || !controls) return;
    return focusWidgetInput(
      () => controls.focus(),
      () => {
        if (quickNoteFocusRequest.get() === requestedFocus) quickNoteFocusRequest.set(0);
      },
    );
  }, [requestedFocus, controls, isPresent, suspended]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  function toggleAttachments() {
    if (panel === 'attachments') return setPanel(null);
    setEditorHeight(scrollRef.current?.offsetHeight ?? null);
    setPanel('attachments');
  }
  const [draftId, setDraftId] = useState<string | null>(null);
  const attachments = useNoteAttachments(draftId ?? '');
  const draft = useRef<string | null>(null);
  const [widgetColumn] = useState(() => quickNoteColumn.get());
  useEffect(() => {
    quickNoteColumn.set(null);
  }, []);
  const [destination, setDestination] = useState<Destination>(
    widgetColumn || tabFor(pathname) === '/deck' ? 'deck' : 'gallery',
  );
  // Read by the exit effect, which runs after the last render.
  const latest = useRef({ content, color, primaryTagId, destination });
  latest.current = { content, color, primaryTagId, destination };

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
  // A swipe's offset is not part of where the window rests, so the flight sheds it.
  const flightY = useTransform(
    () => (flightTarget.get()?.dy ?? 0) * flight.get() + y.get() * (1 - flight.get()),
  );
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

  // Which kind of note this window writes is settled when it opens. Read at save time
  // instead, a vault that locked in between would have its words saved as an ordinary note.
  const inVault = useRef(isVaultMode());
  const locked = useRef(false);

  function create() {
    const { content, color, primaryTagId, destination } = latest.current;
    if (inVault.current && (locked.current || vaultStatus.get() !== 'unlocked')) return null;
    // Remembered rather than fetched, so notes can be created offline.
    const user = getSignedInUser();
    if (!user) return null;
    if (draft.current) {
      updateNote(draft.current, {
        content,
        status: destination === 'deck' ? (widgetColumn ?? DEFAULT_BOARD_STATUS) : null,
      });
      if (primaryTagId) setPrimaryTag(draft.current, primaryTagId);
      else setNoteColor(draft.current, color);
      return draft.current;
    }
    return createNote({
      userId: user.id,
      content,
      color,
      primaryTagId,
      status: destination === 'deck' ? (widgetColumn ?? DEFAULT_BOARD_STATUS) : null,
      vault: inVault.current,
    }).id;
  }

  // A vault about to lock takes its key with it: seal what has been typed while it can
  // still be sealed, and close, since nothing typed afterwards could be saved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `create` reads refs only
  useEffect(() => {
    if (!inVault.current) return;
    const save = () => {
      if (blocksHaveContent(latest.current.content) || draft.current) {
        const id = create();
        if (id) discardIfEmpty(id);
      }
      locked.current = true;
      exit.current = { kind: 'instant' };
      quickNote.set('closed');
    };
    beforeVaultLock.add(save);
    return () => void beforeVaultLock.delete(save);
  }, []);

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

    // Presence keeps the editor mounted through the exit animation. Release its focus
    // now so the keyboard closes alongside the window rather than after it disappears.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && ref.current?.contains(focused)) focused.blur();

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
        const self = ref.current ? restingBox(ref.current) : undefined;
        const note = getNote(id);
        const visible = box && box.bottom > 0 && box.top < window.innerHeight;
        if (!card || !box || !self || !note || !visible) {
          void shrinkIntoButton().then(finish);
          return;
        }
        landing.current = { card, self, box };
        // Saved straight after opening, the window is still springing to its size. The
        // flight is measured from where it rests, so it has to be there when it lands.
        animate(scale, 1, { duration: 0.15 });
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

  useBackHandler(isPresent && !suspended, () => {
    if (panel) setPanel(null);
    else quickNote.set('closed');
  });

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
      data-note-color={shownColor}
      onKeyDown={(event) => {
        // Keys pressed in the tag form bubble here through its portal.
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
          if (panel) setPanel(null);
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
          ref={scrollRef}
          data-quick-note-scroll
          className="min-h-28 flex-1 overflow-y-auto overscroll-contain"
          // With the keyboard up the window has little height, and the picker needs it more.
          // The editor starts from the height it has, so the window grows from where it is,
          // and gives that height up first: the window's height is not definite, so a flex
          // basis alone would not.
          style={
            panel === 'attachments' && editorHeight !== null
              ? { flexBasis: editorHeight, flexShrink: 1000, minHeight: 0 }
              : undefined
          }
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
              // The picker covers the words being typed, so typing puts it away.
              setPanel((current) => (current === 'colors' ? null : current));
            }}
            onControls={setControls}
            autoFocus={isPresent && !suspended}
          />
        </motion.div>
        <AnimatePresence initial={false}>
          {primaryTag && (
            <motion.div
              key="tag"
              className={cn(
                'flex overflow-hidden px-4',
                panel === 'attachments' ? 'shrink-[1000]' : 'shrink-0',
              )}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.smooth}
            >
              <span className="flex min-w-0 pt-1 pb-1">
                <TagBadge tag={primaryTag} tags={tags} primary interactive={false} />
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {panel === 'attachments' && (
            <motion.div
              key="attachments"
              // Scrolls only if even the whole window is shorter than the picker.
              className="overflow-y-auto [scrollbar-width:none]"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.smooth}
            >
              <AttachmentPicker
                noteId={draftId ?? undefined}
                ensureNote={ensureNote}
                controls={controls}
                onDone={() => setPanel(null)}
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
          <QuickNoteColors
            open={panel === 'colors'}
            onOpenChange={(next) => setPanel(next ? 'colors' : null)}
            value={shownColor}
            primaryTagId={primaryTagId}
            onChange={(next) => {
              setColor(next);
              setChosenTagId(null);
            }}
            onTagChange={(id) => {
              setColor('default');
              setChosenTagId(id);
            }}
          />
          <FormattingBar
            controls={controls}
            // Capturing a link has the server read its page, which a vault note's links are
            // kept from (ADR 0020).
            onLink={inVault.current ? undefined : captureLink}
            attachmentsOpen={panel === 'attachments'}
            onAttachments={toggleAttachments}
            className="flex-1"
          />
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
