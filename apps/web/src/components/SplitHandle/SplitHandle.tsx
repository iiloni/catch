import { motion } from 'motion/react';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { GUTTER, listRatio, listWidthLimits, saveListRatio } from '@/lib/splitView';
import { cn } from '@/lib/utils';

/** Arrow keys move the split this far; with Shift, four times as far. */
const KEY_STEP = 32;

type Props = {
  listWidth: number;
  viewportWidth: number;
};

/** The grip in the gutter between the page and an open note. Drag it to resize both. */
export function SplitHandle({ listWidth, viewportWidth }: Props) {
  const { min, max } = listWidthLimits(viewportWidth);
  const [dragging, setDragging] = useState(false);
  // Where on the grip the finger landed, and whether the split is held at a limit.
  const drag = useRef<{ offset: number; atLimit: boolean } | null>(null);

  /** Resizes the page, within its limits. Returns whether a limit stopped it. */
  function resize(width: number) {
    const clamped = Math.min(max, Math.max(min, width));
    listRatio.set(clamped / viewportWidth);
    return clamped !== width;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // No text selection, and no focus ring, from dragging.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { offset: event.clientX - listWidth, atLimit: false };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    const atLimit = resize(event.clientX - state.offset);
    if (atLimit && !state.atLimit) haptics.threshold();
    state.atLimit = atLimit;
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    saveListRatio();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const next =
      event.key === 'ArrowLeft'
        ? listWidth - step
        : event.key === 'ArrowRight'
          ? listWidth + step
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    resize(next);
    saveListRatio();
  }

  const percent = (width: number) => Math.round((width / viewportWidth) * 100);

  return (
    <motion.div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize note"
      aria-valuemin={percent(min)}
      aria-valuemax={percent(max)}
      aria-valuenow={percent(listWidth)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      // Wider than the gutter, so a finger does not have to land exactly on it.
      className="group fixed top-0 bottom-0 z-[55] flex w-6 cursor-col-resize touch-none select-none items-center justify-center outline-none"
      // Centered on the gutter, following the pane's edge as it slides.
      style={{ left: `calc(100% - var(--note-pane) + ${GUTTER / 2 - 12}px)` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, delay: 0.15 }}
    >
      <motion.span
        aria-hidden
        className={cn(
          'w-1.5 rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring/70',
          dragging ? 'bg-brand' : 'bg-foreground/25 group-hover:bg-foreground/40',
        )}
        initial={false}
        animate={{ height: dragging ? 72 : 48 }}
        transition={springs.snappy}
      />
    </motion.div>
  );
}
