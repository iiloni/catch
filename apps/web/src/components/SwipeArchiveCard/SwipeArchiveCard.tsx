import type { Note } from '@catch/shared';
import { Archive } from 'lucide-react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { type PointerEvent, useEffect, useRef } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { useIsCardHidden } from '@/lib/noteTransition';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  onOpen: (note: Note, card: HTMLElement) => void;
  onArchive: (note: Note) => void;
  /** The card has been picked up to be rearranged, so it no longer swipes. */
  lifted?: boolean;
  /** Set while notes are being selected, when cards do not swipe (see `NoteCard`). */
  selected?: boolean;
  onSelect?: (note: Note) => void;
};

type Swipe = {
  pointerId: number;
  startX: number;
  startY: number;
  locked: boolean;
  crossed: boolean;
};

/**
 * The swipe's backing stays under the card itself, clear of the narrower link underlay's
 * visible strip below it (see LinkUnderlay).
 */
const UNDER_CARD_ONLY = 'group-has-[[data-link-underlay]]/swipe:bottom-9';

const MAX_SWIPE = 96;
const ARCHIVE_THRESHOLD = MAX_SWIPE / 2;

/** A gallery card follows a sideways touch, then archives after crossing the edge cue. */
export function SwipeArchiveCard({
  note,
  onOpen,
  onArchive,
  lifted = false,
  selected,
  onSelect,
}: Props) {
  const swipeable = !lifted && selected === undefined;
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  // Clip the moving card to its slot, but let resting shadows and focus rings extend outside it.
  const overflow = useTransform(x, (offset) => (offset === 0 ? 'visible' : 'hidden'));
  const cueOpacity = useMotionValue(0);
  const iconX = useMotionValue(0);
  const iconScale = useMotionValue(1);
  const iconColor = useTransform(
    cueOpacity,
    (opacity) =>
      `color-mix(in oklab, var(--brand-foreground) ${opacity * 100}%, var(--foreground))`,
  );
  const swipe = useRef<Swipe | null>(null);
  const suppressClick = useRef(false);
  const committing = useRef(false);
  // No backing under a card that is lifted into the editor: its slot reads as empty.
  const hidden = useIsCardHidden(note.id);
  const bare = lifted || hidden;

  // A held finger that starts dragging (or selecting) the card must not also swipe it.
  useEffect(() => {
    if (!swipeable) swipe.current = null;
  }, [swipeable]);

  function setCue(active: boolean) {
    animate(cueOpacity, active ? 1 : 0, { duration: reducedMotion ? 0 : 0.14, ease: 'easeOut' });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || committing.current || !swipeable) return;
    const button = (event.target as Element).closest('button');
    // The card and its link underlay swipe; its other buttons (the pin) do not.
    if (button && !button.matches('[aria-label="Open note"], [data-link-underlay]')) return;
    x.stop();
    suppressClick.current = false;
    swipe.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      locked: false,
      crossed: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = swipe.current;
    if (!state || state.pointerId !== event.pointerId || !swipeable) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.locked) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      state.locked = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    x.set(Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, dx)));
    // Keep one icon on the exposed edge, including when the finger reverses direction.
    iconX.set(-Math.sign(dx) * (event.currentTarget.clientWidth / 2 - 30));
    const crossed = Math.abs(dx) >= ARCHIVE_THRESHOLD;
    if (crossed !== state.crossed) {
      if (crossed) haptics.threshold();
      setCue(crossed);
    }
    state.crossed = crossed;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = swipe.current;
    if (!state || state.pointerId !== event.pointerId) return;
    swipe.current = null;
    const dx = event.clientX - state.startX;
    if (!state.locked || Math.abs(dx) < ARCHIVE_THRESHOLD) {
      animate(x, 0, reducedMotion ? { duration: 0 } : springs.snappy);
      setCue(false);
      return;
    }
    committing.current = true;
    if (!state.crossed) {
      haptics.threshold();
      setCue(true);
    }
    haptics.success();
    animate(x, Math.sign(dx) * (event.currentTarget.clientWidth + 32), {
      duration: reducedMotion ? 0 : 0.16,
      ease: 'easeOut',
    });
    // The revealed icon travels into the slot as the card clears it, then settles.
    animate(iconX, 0, {
      duration: reducedMotion ? 0 : 0.22,
      delay: reducedMotion ? 0 : 0.06,
      ease: 'easeOut',
    });
    if (!reducedMotion) {
      animate(iconScale, [1, 1.2, 1], { duration: 0.18, delay: 0.16, ease: 'easeInOut' });
    }
    // Commit independently of the animation, which may stop if the view unmounts.
    window.setTimeout(() => onArchive(note), reducedMotion ? 120 : 360);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (swipe.current?.pointerId !== event.pointerId) return;
    swipe.current = null;
    animate(x, 0, reducedMotion ? { duration: 0 } : springs.snappy);
    setCue(false);
  }

  return (
    <motion.div
      data-swipe-archive
      className="group/swipe relative rounded-2xl touch-pan-y"
      style={{ overflow }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={(event) => {
        if (!suppressClick.current && !committing.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 grid place-items-center rounded-2xl bg-foreground/[0.07]',
          UNDER_CARD_ONLY,
          bare && 'invisible',
        )}
      >
        <motion.div
          data-swipe-archive-cue
          className="absolute inset-0 rounded-2xl bg-brand/70"
          style={{ opacity: cueOpacity }}
        />
        <motion.div
          data-swipe-archive-icon
          className="relative"
          style={{ x: iconX, scale: iconScale, color: iconColor }}
        >
          <Archive className="size-5" />
        </motion.div>
      </div>
      <motion.div style={{ x }}>
        <NoteCard
          note={note}
          onOpen={onOpen}
          pressable={!lifted}
          selected={selected}
          onSelect={onSelect}
        />
      </motion.div>
    </motion.div>
  );
}
