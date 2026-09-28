import type { Note } from '@catch/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SwipeArchiveCard } from '@/components/SwipeArchiveCard/SwipeArchiveCard';

const MIN_COLUMN_WIDTH = 220;
const GAP = 12;

type Props = {
  notes: Note[];
  onOpen: (note: Note, card: HTMLElement) => void;
  onArchive?: (note: Note) => void;
};

/** Two columns on phones (as in Keep), more as space allows. */
export function columnsFor(width: number) {
  if (width < 280) return 1;
  return Math.max(2, Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP)));
}

/**
 * Masonry grid. Notes fill columns round-robin, so reading order runs across
 * rows (newest top-left) the way Keep lays them out.
 */
export function NoteGrid({ notes, onOpen, onArchive }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(2);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setColumnCount(columnsFor(width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Array.from({ length: columnCount }, (_, column) =>
    notes.filter((_, index) => index % columnCount === column),
  );

  return (
    <div ref={ref} className="flex items-start gap-3">
      {columns.map((column, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
        <div key={index} className="flex min-w-0 flex-1 flex-col gap-3">
          {column.map((note) =>
            onArchive ? (
              <SwipeArchiveCard key={note.id} note={note} onOpen={onOpen} onArchive={onArchive} />
            ) : (
              <NoteCard key={note.id} note={note} onOpen={onOpen} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
