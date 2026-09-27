import type { Note } from '@catch/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';

const MIN_COLUMN_WIDTH = 240;
const GAP = 16;

type Props = {
  notes: Note[];
  onOpen: (note: Note) => void;
};

/**
 * Masonry grid. Notes fill columns round-robin, so reading order runs across
 * rows (newest top-left) the way Keep lays them out.
 */
export function NoteGrid({ notes, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setColumnCount(Math.max(1, Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Array.from({ length: columnCount }, (_, column) =>
    notes.filter((_, index) => index % columnCount === column),
  );

  return (
    <div ref={ref} className="flex items-start gap-4">
      {columns.map((column, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
        <div key={index} className="flex min-w-0 flex-1 flex-col gap-4">
          {column.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}
