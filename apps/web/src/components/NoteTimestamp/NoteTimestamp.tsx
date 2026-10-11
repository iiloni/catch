import { History } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { formatTime, useHour12 } from '@/lib/clock';
import { noteHistoryOpen } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function NoteTimestamp({
  updatedAt,
  history = false,
}: {
  updatedAt: Date;
  history?: boolean;
}) {
  // Redraws the times below when the clock setting changes.
  useHour12();
  const reducedMotion = useReducedMotion();
  const sameDay = updatedAt.toDateString() === new Date().toDateString();
  const edited = sameDay ? formatTime(updatedAt) : dateFormat.format(updatedAt);

  return (
    <p className="px-4 pt-6 pb-2 text-center text-muted-foreground text-xs">
      Edited <time dateTime={updatedAt.toISOString()}>{edited}</time>
      {history && (
        <motion.button
          type="button"
          data-note-history-entry
          whileTap={reducedMotion ? undefined : { scale: 0.96 }}
          transition={springs.snappy}
          className="mx-auto flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            haptics.toggle();
            noteHistoryOpen.set(true);
          }}
        >
          <History className="size-4" />
          Version history
        </motion.button>
      )}
    </p>
  );
}
