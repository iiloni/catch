import { motion, useIsPresent } from 'motion/react';
import { useEffect, useState } from 'react';
import { historyDockSlot } from '@/lib/dockState';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** Every slot on the page, oldest first: the page's dock and a pane's can pass each other. */
const slots: HTMLDivElement[] = [];

/**
 * What the dock shows while a note's versions are reviewed, in the note's dock's place. It
 * is only the room: the reader fills it (see `historyDockSlot`), growing it upward for the
 * list of versions as the note's dock grows for a palette.
 */
export function HistoryDockSlot() {
  const isPresent = useIsPresent();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    slots.push(element);
    historyDockSlot.set(element);
    // The newest one keeps the reader, and gives it back to one that outlives it.
    return () => {
      slots.splice(slots.indexOf(element), 1);
      historyDockSlot.set(slots.at(-1) ?? null);
    };
  }, [element]);
  return (
    <motion.div
      ref={setElement}
      data-history-dock
      // Leaving, it stops taking up room so the dock can settle back to one row.
      className={cn('flex flex-col', !isPresent && 'absolute inset-x-0 bottom-0')}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16 } }}
      transition={springs.smooth}
    />
  );
}
