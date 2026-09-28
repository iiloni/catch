import { and, eq, isNull, not, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Columns3 } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteBoard } from '@/components/NoteBoard/NoteBoard';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { notesCollection } from '@/lib/collections';
import { useOpenNote } from '@/lib/openNote';

export const Route = createFileRoute('/_app/deck')({
  component: DeckPage,
});

/** Notes being actively worked on: the ones with a board status. */
function DeckPage() {
  const { open } = useOpenNote();
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) =>
          and(isNull(note.deletedAt), eq(note.isArchived, false), not(isNull(note.status))),
        ),
  });

  return (
    <>
      <PageHeader title="Deck" />
      <div className="mx-auto max-w-7xl pt-3">
        {isLoading ? null : notes.length > 0 ? (
          <NoteBoard notes={notes} onOpen={(note, card) => open(note.id, card)} />
        ) : (
          <EmptyState icon={Columns3} title="No notes in the deck">
            Notes you are working on live here. Choose Deck when catching a note, or add one from
            its toolbar.
          </EmptyState>
        )}
      </div>
    </>
  );
}
