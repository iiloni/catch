import { comparePositions } from '@catch/shared';
import { and, eq, isNull, not, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Columns3Cog } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { ColumnManager } from '@/components/NoteBoard/ColumnManager';
import { NoteBoard } from '@/components/NoteBoard/NoteBoard';
import { TabPageHeader } from '@/components/PageHeader/PageHeader';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { boardColumnsCollection, notesCollection } from '@/lib/collections';
import { springs } from '@/lib/motion';
import { useNoteSelection } from '@/lib/noteSelection';
import { useOpenNote } from '@/lib/openNote';

export const Route = createFileRoute('/_app/deck')({
  component: DeckPage,
});

/** Notes being actively worked on: the ones with a board status. */
function DeckPage() {
  const [managing, setManaging] = useState(false);
  const { open } = useOpenNote();
  const { data: columns = [], isLoading: columnsLoading } = useLiveQuery({
    query: (q) => q.from({ column: boardColumnsCollection }),
  });
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) =>
          and(isNull(note.deletedAt), eq(note.isArchived, false), not(isNull(note.status))),
        ),
  });
  const selection = useNoteSelection(
    [...notes].sort((a, b) => comparePositions(a.position, b.position)),
  );

  return (
    <>
      <TabPageHeader
        title="Deck"
        selection={selectionHeader(selection, 'deck')}
        trailing={
          <motion.button
            type="button"
            aria-label="Edit columns"
            onClick={() => setManaging(true)}
            whileTap={{ scale: 0.9 }}
            transition={springs.snappy}
            className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Columns3Cog className="size-[22px]" aria-hidden />
          </motion.button>
        }
      />
      <ColumnManager columns={columns} open={managing} onOpenChange={setManaging} />
      <div className="mx-auto max-w-7xl pt-3">
        {isLoading || columnsLoading ? null : (
          <NoteBoard
            notes={notes}
            columns={columns}
            onOpen={(note, card) => open(note.id, card)}
            selected={selection.ids}
            onSelect={selection.select}
            onSelectionDone={selection.clear}
          />
        )}
      </div>
    </>
  );
}
