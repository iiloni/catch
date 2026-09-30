import { type BoardColumn, DEFAULT_BOARD_STATUS } from '@catch/shared';
import { Check, Columns3, LayoutDashboard } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The column under a point on screen, for a finger sliding up from the dock's move button.
 * The button holds pointer capture, so this is a geometric hit test rather than
 * elementFromPoint. Rows take the finger across the left column and in the gaps
 * between them, so the gesture does not need fingertip precision.
 */
export function noteDestinationAt(
  root: HTMLElement | null,
  x: number,
  y: number,
): string | null | undefined {
  const gallery = root?.querySelector<HTMLElement>('[data-move-gallery]');
  if (gallery) {
    const bounds = gallery.getBoundingClientRect();
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      return null;
    }
  }
  const list = root?.querySelector<HTMLElement>('[data-deck-columns]');
  if (!list) return undefined;
  const bounds = list.getBoundingClientRect();
  if (x < bounds.left - 24 || x > bounds.right + 24) return undefined;
  if (y < bounds.top - 32 || y > bounds.bottom + 8) return undefined;
  let nearest: { id: string; distance: number } | null = null;
  for (const row of list.querySelectorAll<HTMLElement>('[data-deck-column]')) {
    const rect = row.getBoundingClientRect();
    // Rows scrolled out of the list are not under the finger.
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
    const distance = Math.abs(y - (rect.top + rect.bottom) / 2);
    const id = row.dataset.deckColumn;
    if (id && (!nearest || distance < nearest.distance)) nearest = { id, distance };
  }
  return nearest?.id;
}

type Props = {
  /** In Deck order. */
  columns: readonly BoardColumn[];
  current: string | null;
  /** Undefined when the finger is outside all destinations. */
  hovered: string | null | undefined;
  onSelect: (status: string | null) => void;
};

const targetClass =
  'relative flex min-w-0 items-center gap-2 overflow-hidden rounded-[calc(var(--dock-radius)-0.25rem)] border-2 font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70';

/** Deck destinations beside a full-height Gallery target. */
export function NoteMovePicker({ columns, current, hovered, onSelect }: Props) {
  return (
    <fieldset
      aria-label="Move note"
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-1.5 px-2 pt-2 pb-1"
    >
      <section
        data-deck-columns
        aria-label="Deck columns"
        className="flex max-h-[50dvh] touch-pan-y flex-col gap-1.5 overflow-y-auto [scrollbar-width:none]"
      >
        {columns.map((column) => {
          const active = hovered === column.id;
          const selected = current === column.id;
          return (
            <motion.button
              key={column.id}
              type="button"
              data-deck-column={column.id}
              data-column-color={column.color}
              aria-current={selected ? 'location' : undefined}
              onClick={() => onSelect(column.id)}
              animate={{ scale: active ? 1.03 : 1 }}
              transition={springs.snappy}
              className={cn(
                targetClass,
                'h-12 shrink-0 pr-2 pl-5 text-left',
                selected ? 'border-brand' : 'border-transparent',
                active
                  ? 'bg-foreground/[0.1] text-foreground shadow-[inset_0_1px_0_var(--glass-highlight)]'
                  : 'bg-foreground/[0.04] text-foreground/80',
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-2.5 left-2 w-1 rounded-full bg-[var(--column-accent)]"
              />
              <Columns3 className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{column.name}</span>
              {selected ? (
                <Check className="size-4 shrink-0 text-foreground" aria-hidden />
              ) : (
                column.id === DEFAULT_BOARD_STATUS && (
                  <span className="text-muted-foreground text-xs">Default</span>
                )
              )}
            </motion.button>
          );
        })}
      </section>
      <motion.button
        type="button"
        data-move-gallery
        aria-label="Send to gallery"
        aria-current={current === null ? 'location' : undefined}
        onClick={() => onSelect(null)}
        animate={{ scale: hovered === null ? 1.03 : 1 }}
        transition={springs.snappy}
        className={cn(
          targetClass,
          'min-h-12 flex-col justify-center gap-2 px-1 py-4 text-sm',
          current === null ? 'border-brand' : 'border-transparent',
          hovered === null
            ? 'bg-foreground/[0.1] text-foreground'
            : 'bg-foreground/[0.04] text-foreground/80',
        )}
      >
        <LayoutDashboard className="size-5" aria-hidden />
        <span>Gallery</span>
        {current === null && <Check className="size-4" aria-hidden />}
      </motion.button>
    </fieldset>
  );
}
