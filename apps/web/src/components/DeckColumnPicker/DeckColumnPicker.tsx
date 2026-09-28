import { type BoardColumn, DEFAULT_BOARD_STATUS } from '@catch/shared';
import { motion } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The column under a point on screen, for a finger sliding up from the dock's deck button.
 * The button holds pointer capture, so this is a geometric hit test rather than
 * elementFromPoint. Rows take the finger anywhere across the dock's width and in the gaps
 * between them, so the gesture does not need fingertip precision.
 */
export function deckColumnAt(root: HTMLElement | null, x: number, y: number): string | null {
  const list = root?.querySelector<HTMLElement>('[data-deck-columns]');
  if (!list) return null;
  const bounds = list.getBoundingClientRect();
  if (x < bounds.left - 24 || x > bounds.right + 24) return null;
  if (y < bounds.top - 32 || y > bounds.bottom + 8) return null;
  let nearest: { id: string; distance: number } | null = null;
  for (const row of list.querySelectorAll<HTMLElement>('[data-deck-column]')) {
    const rect = row.getBoundingClientRect();
    // Rows scrolled out of the list are not under the finger.
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
    const distance = Math.abs(y - (rect.top + rect.bottom) / 2);
    const id = row.dataset.deckColumn;
    if (id && (!nearest || distance < nearest.distance)) nearest = { id, distance };
  }
  return nearest?.id ?? null;
}

type Props = {
  /** In Deck order. */
  columns: readonly BoardColumn[];
  /** The column under a finger held on the deck button. */
  hovered: string | null;
  onSelect: (id: string) => void;
};

/** The Deck's columns as drop targets for the open note, stacked in the dock above its actions. */
export function DeckColumnPicker({ columns, hovered, onSelect }: Props) {
  return (
    <section
      data-deck-columns
      aria-label="Deck columns"
      className="flex max-h-[50dvh] touch-pan-y flex-col gap-1.5 overflow-y-auto px-2 pt-2 pb-1 [scrollbar-width:none]"
    >
      {columns.map((column) => {
        const active = hovered === column.id;
        return (
          <motion.button
            key={column.id}
            type="button"
            data-deck-column={column.id}
            data-column-color={column.color}
            onClick={() => onSelect(column.id)}
            animate={{ scale: active ? 1.03 : 1 }}
            transition={springs.snappy}
            className={cn(
              'relative flex h-12 shrink-0 items-center gap-3 overflow-hidden rounded-[calc(var(--dock-radius)-0.25rem)] pr-4 pl-5 text-left font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
              active
                ? 'bg-foreground/[0.1] text-foreground shadow-[inset_0_1px_0_var(--glass-highlight)]'
                : 'bg-foreground/[0.04] text-foreground/80',
            )}
          >
            <span
              aria-hidden
              className="absolute inset-y-2.5 left-2 w-1 rounded-full bg-[var(--column-accent)]"
            />
            <span className="min-w-0 flex-1 truncate">{column.name}</span>
            {column.id === DEFAULT_BOARD_STATUS && (
              <span className="text-muted-foreground text-xs">Default</span>
            )}
          </motion.button>
        );
      })}
    </section>
  );
}
