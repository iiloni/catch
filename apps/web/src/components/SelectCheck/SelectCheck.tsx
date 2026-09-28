import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const CHECK_CLASS =
  'absolute -top-2 -left-2 z-10 flex size-6 items-center justify-center rounded-full ring-2 ring-background [&_svg]:size-3.5';

/**
 * The check at a card's corner, shown while the note is selected. With a mouse it also
 * appears on hover, as a way to start selecting (touch uses a long press). Place it in a
 * positioned `group/cell` around the card.
 */
export function SelectCheck({
  selected,
  onSelect,
}: {
  /** Undefined unless notes are being selected. */
  selected: boolean | undefined;
  onSelect: () => void;
}) {
  return (
    <>
      {selected === undefined && (
        <button
          type="button"
          aria-label="Select note"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className={cn(
            CHECK_CLASS,
            'cursor-pointer bg-background text-foreground/60 opacity-0 shadow-sm outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-ring/50 group-hover/cell:opacity-100 pointer-coarse:hidden',
          )}
        >
          <Check strokeWidth={3} aria-hidden />
        </button>
      )}
      <AnimatePresence>
        {selected && (
          <motion.span
            key="check"
            aria-hidden
            className={cn(CHECK_CLASS, 'pointer-events-none bg-foreground text-background')}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={springs.bouncy}
          >
            <Check strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}
