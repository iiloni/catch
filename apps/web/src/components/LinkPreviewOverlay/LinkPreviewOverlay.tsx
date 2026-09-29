import type { Note } from '@catch/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { useRouterState } from '@tanstack/react-router';
import { SquareArrowOutUpRight, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  usePresence,
  useTransform,
} from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { LinkPreviewCard } from '@/components/LinkPreviewCard/LinkPreviewCard';
import { Button } from '@/components/ui/button';
import { useBackHandler } from '@/lib/backButton';
import { notesCollection } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { linkOverlay, showLinkInNote, useNoteLinks } from '@/lib/linkPreviews';
import { springs } from '@/lib/motion';
import { findCard } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { GUTTER, useNotePane } from '@/lib/splitView';
import { cn } from '@/lib/utils';

const close = () => linkOverlay.set(null);
const DISMISS_DISTANCE = 110;
const MAX_DRAG = 180;

/**
 * Every link in a note, as a list that slides up from behind the dock it was opened from:
 * the page's dock for an underlay under a card, the note's for the tray on it.
 */
export function LinkPreviewOverlay() {
  const state = linkOverlay.use();
  const { data: matches = [] } = useLiveQuery(
    (q) => q.from({ note: notesCollection }).where(({ note }) => eq(note.id, state?.noteId ?? '')),
    [state?.noteId],
  );
  const note = matches[0];

  // The list belongs to the page it was opened on, so any navigation closes it.
  const href = useRouterState({ select: (router) => router.location.href });
  const lastHref = useRef(href);
  useEffect(() => {
    if (lastHref.current === href) return;
    lastHref.current = href;
    close();
  }, [href]);

  useBackHandler(state !== null, close);

  return (
    <AnimatePresence>
      {state && note && (
        <OverlayPanel key={state.noteId} note={note} fromEditor={state.fromEditor} />
      )}
    </AnimatePresence>
  );
}

/** How far the panel travels to hide below its container's bottom, which runs through the dock. */
function hiddenOffset(panel: HTMLElement, y: number) {
  const bottom = panel.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
  return bottom - (panel.getBoundingClientRect().top - y);
}

function OverlayPanel({ note, fromEditor }: { note: Note; fromEditor: boolean }) {
  const [isPresent, safeToRemove] = usePresence();
  const links = useNoteLinks(note);
  const { open } = useOpenNote();
  const pane = useNotePane();
  const inPane = fromEditor && pane.shown;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const hidden = useRef(0);
  const hiddenAbove = useRef(0);
  const exitDirection = useRef(1);
  const y = useMotionValue(0);
  // Reads `y` unconditionally: the transform follows only the values its first run reads.
  const backdropOpacity = useTransform(() => {
    const offset = y.get();
    const distance = offset < 0 ? hiddenAbove.current : hidden.current;
    return distance > 0 ? 0.35 * Math.max(0, 1 - Math.abs(offset) / distance) : 0;
  });

  // A ref callback rather than a layout effect: the portal mounts its children a render late,
  // after this component's effects have run.
  const attachPanel = useCallback(
    (panel: HTMLDivElement | null) => {
      panelRef.current = panel;
      setPanel(panel);
      if (!panel || hidden.current > 0) return;
      hidden.current = hiddenOffset(panel, 0);
      hiddenAbove.current = panel.getBoundingClientRect().bottom + 8;
      y.set(hidden.current);
      void animate(y, 0, springs.smooth);
    },
    [y],
  );

  useEffect(() => {
    if (isPresent) return;
    const panel = panelRef.current;
    // The list may have changed height since it opened.
    if (panel) {
      hidden.current = hiddenOffset(panel, y.get());
      hiddenAbove.current = panel.getBoundingClientRect().bottom - y.get() + 8;
    }
    const target = exitDirection.current < 0 ? -hiddenAbove.current : hidden.current;
    void animate(y, target, { ...springs.pane, visualDuration: 0.35 }).then(safeToRemove);
  }, [isPresent, y, safeToRemove]);

  useEffect(() => {
    if (!panel || !isPresent) return;
    const scrollArea = panel.querySelector<HTMLElement>('[data-link-overlay-scroll]');
    let startX: number | null = null;
    let startY: number | null = null;
    let dragging = false;
    let armed = false;
    let direction = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let startedInList = false;
    let startOffset = 0;

    function onStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        if (dragging) void animate(y, 0, springs.snappy);
        startX = null;
        startY = null;
        dragging = false;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      startOffset = y.get();
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      dragging = false;
      armed = false;
      velocity = 0;
      startedInList = scrollArea?.contains(event.target as Node) ?? false;
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (event.touches.length !== 1) {
        if (dragging) void animate(y, 0, springs.snappy);
        startX = null;
        startY = null;
        dragging = false;
        return;
      }
      if (startY === null || startX === null || !touch) return;
      const delta = touch.clientY - startY;
      if (!dragging) {
        if (Math.abs(delta) < 8 && Math.abs(touch.clientX - startX) < 8) return;
        if (Math.abs(touch.clientX - startX) > Math.abs(delta)) {
          startY = null;
          return;
        }
        if (startedInList && scrollArea) {
          const atTop = scrollArea.scrollTop <= 1;
          const atBottom =
            scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 1;
          if ((delta > 0 && !atTop) || (delta < 0 && !atBottom)) {
            startY = null;
            return;
          }
        }
        direction = Math.sign(delta);
        dragging = true;
        y.stop();
      }
      event.preventDefault();
      velocity = (touch.clientY - lastY) / Math.max(1, event.timeStamp - lastTime);
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      const distance = Math.max(0, delta * direction - 8);
      y.set(startOffset + direction * Math.min(distance * 0.75, MAX_DRAG));
      const past = distance > DISMISS_DISTANCE;
      if (past !== armed) {
        armed = past;
        if (past) haptics.threshold();
      }
    }

    function onEnd(event: TouchEvent) {
      const flung = Math.abs(y.get() - startOffset) >= 24 && velocity * direction > 0.6;
      if (
        dragging &&
        event.type !== 'touchcancel' &&
        event.touches.length === 0 &&
        (armed || flung)
      ) {
        if (!armed) haptics.threshold();
        exitDirection.current = direction;
        close();
      } else if (dragging) {
        void animate(y, 0, springs.snappy);
      }
      startX = null;
      startY = null;
      dragging = false;
    }

    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd);
    panel.addEventListener('touchcancel', onEnd);
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
    };
  }, [panel, isPresent, y]);

  // Removing the last preview leaves nothing to list.
  useEffect(() => {
    if (links.length === 0) close();
  }, [links.length]);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay asChild forceMount>
          <motion.div
            className={cn('fixed inset-0 bg-black', layer(fromEditor))}
            style={{ opacity: backdropOpacity }}
          />
        </DialogPrimitive.Overlay>
        {/*
          Clipped halfway down the dock and stacked under it, so the panel slides out from
          behind the dock. `overflow: clip` rather than a clip path, which would stop the
          panel's glass from blurring; it also leaves the shadow its sides.
        */}
        <div
          className={cn(
            'pointer-events-none fixed top-0 bottom-[calc(var(--dock-bottom)+var(--dock-height)/2)] flex items-end justify-center overflow-x-visible overflow-y-clip pt-[calc(var(--safe-top)+0.75rem)]',
            layer(fromEditor),
            inPane
              ? 'right-0 left-[calc(100%-var(--note-pane))] pr-3'
              : 'right-[var(--note-pane)] left-0 px-3',
          )}
          style={inPane ? { paddingLeft: GUTTER + 12 } : undefined}
        >
          <DialogPrimitive.Content
            asChild
            forceMount
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <motion.div
              ref={attachPanel}
              data-link-overlay
              className="glass-thick pointer-events-auto mb-[calc(var(--dock-height)/2+0.5rem)] flex max-h-[calc(100%-var(--dock-height)/2-0.5rem)] w-full max-w-md flex-col rounded-3xl outline-none"
              style={{ y, pointerEvents: isPresent ? 'auto' : 'none' }}
            >
              <header className="flex shrink-0 items-center gap-2 py-2 pr-2 pl-5">
                <DialogPrimitive.Title className="min-w-0 flex-1 font-display font-semibold text-lg tracking-[-0.01em]">
                  {links.length === 1 ? 'Link' : `${links.length} links`}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  Previews of the links in this note.
                </DialogPrimitive.Description>
                {!fromEditor && (
                  <Button
                    variant="ghost"
                    className="h-9 rounded-full px-3"
                    onClick={() => {
                      close();
                      open(note.id, findCard(note.id) ?? undefined);
                    }}
                  >
                    <SquareArrowOutUpRight /> Open note
                  </Button>
                )}
                <IconButton label="Close" onClick={close} className="size-9">
                  <X />
                </IconButton>
              </header>
              <ul
                data-link-overlay-scroll
                className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pb-3"
              >
                {links.map((link) => (
                  <li key={link.url}>
                    <LinkPreviewCard
                      link={link}
                      noteId={note.id}
                      readOnly={Boolean(note.deletedAt)}
                      onShowInNote={
                        fromEditor
                          ? () => {
                              close();
                              showLinkInNote(link.url);
                            }
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </motion.div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Under the dock it slides from and over everything else there: the page (above its headers
 * at 30, under the dock at 40), or the open note (above the editor at 50, under its dock at 60).
 */
function layer(fromEditor: boolean) {
  return fromEditor ? 'z-[55]' : 'z-[35]';
}
