import type { Note } from '@catch/shared';
import { Archive } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
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
  const x = useMotionValue(0);
  const cueOpacity = useMotionValue(0);
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
    animate(cueOpacity, active ? 1 : 0, { duration: 0.14, ease: 'easeOut' });
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
      animate(x, 0, springs.snappy);
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
      duration: 0.16,
      ease: 'easeOut',
    });
    // Commit independently of the animation, which may stop if the view unmounts.
    window.setTimeout(() => onArchive(note), 160);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (swipe.current?.pointerId !== event.pointerId) return;
    swipe.current = null;
    animate(x, 0, springs.snappy);
    setCue(false);
  }

  return (
    <div
      data-swipe-archive
      className="group/swipe relative overflow-hidden rounded-2xl touch-pan-y"
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
          'absolute inset-0 flex items-center justify-between rounded-2xl bg-foreground/[0.07] px-5 text-foreground/60',
          UNDER_CARD_ONLY,
          bare && 'invisible',
        )}
      >
        <Archive className="size-5" />
        <Archive className="size-5" />
      </div>
      <motion.div
        data-swipe-archive-cue
        aria-hidden
        className={cn(
          'absolute inset-0 flex items-center justify-between rounded-2xl bg-brand/70 px-5 text-brand-foreground',
          UNDER_CARD_ONLY,
        )}
        style={{ opacity: cueOpacity }}
      >
        <Archive className="size-5" />
        <Archive className="size-5" />
      </motion.div>
      <motion.div style={{ x }}>
        <NoteCard
          note={note}
          onOpen={onOpen}
          pressable={!lifted}
          selected={selected}
          onSelect={onSelect}
        />
      </motion.div>
    </div>
  );
}
