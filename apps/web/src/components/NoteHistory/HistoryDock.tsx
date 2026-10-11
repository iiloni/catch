import { motion, useIsPresent } from 'motion/react';
import { useEffect, useState } from 'react';
import { historyDockSlot } from '@/lib/dockState';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

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
    historyDockSlot.set(element);
    // The page's dock and a pane's can pass each other; the newer one keeps the reader.
    return () => {
      if (historyDockSlot.get() === element) historyDockSlot.set(null);
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
