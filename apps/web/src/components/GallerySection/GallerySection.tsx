import type { Note } from '@catch/shared';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { z } from 'zod';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { sortNotes } from '@/lib/sortNotes';
import { usePersistentState } from '@/lib/storage';

const sortSchema = z.object({
  field: z.enum(['updatedAt', 'createdAt']),
  direction: z.enum(['desc', 'asc']),
});

type Props = {
  notes: Note[];
  onOpen: (note: Note) => void;
};

/** Every note not in the deck. */
export function GallerySection({ notes, onOpen }: Props) {
  const [sort, setSort] = usePersistentState('catch-gallery-sort', sortSchema, {
    field: 'updatedAt',
    direction: 'desc',
  });
  const sorted = sortNotes(notes, sort.field, sort.direction);

  return (
    <section aria-labelledby="gallery-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="gallery-heading" className="font-semibold text-lg">
          Gallery
        </h2>
        <div className="flex items-center gap-1">
          <ToggleGroup
            type="single"
            value={sort.field}
            onValueChange={(field) =>
              field && setSort({ ...sort, field: field as typeof sort.field })
            }
            aria-label="Sort by"
          >
            <ToggleGroupItem value="updatedAt">Edited</ToggleGroupItem>
            <ToggleGroupItem value="createdAt">Created</ToggleGroupItem>
          </ToggleGroup>
          <IconButton
            label={sort.direction === 'desc' ? 'Newest first' : 'Oldest first'}
            onClick={() =>
              setSort({ ...sort, direction: sort.direction === 'desc' ? 'asc' : 'desc' })
            }
          >
            {sort.direction === 'desc' ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
          </IconButton>
        </div>
      </div>
      {sorted.length > 0 ? (
        <NoteGrid notes={sorted} onOpen={onOpen} />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          Notes you take appear here.
        </p>
      )}
    </section>
  );
}
