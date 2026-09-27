import { and, eq, isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Archive } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { BackToGallery, PageHeader } from '@/components/PageHeader/PageHeader';
import { notesCollection } from '@/lib/collections';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';

export const Route = createFileRoute('/_app/archive')({
  component: ArchivePage,
});

function ArchivePage() {
  const { open } = useOpenNote();
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) => and(isNull(note.deletedAt), eq(note.isArchived, true))),
  });

  return (
    <>
      <PageHeader title="Archive" leading={<BackToGallery />} />
      <section aria-label="Archive" className="mx-auto max-w-7xl px-3 pt-3 sm:px-6">
        {isLoading ? null : notes.length > 0 ? (
          <NoteGrid notes={sortNotes(notes)} onOpen={(note, card) => open(note.id, card)} />
        ) : (
          <EmptyState icon={Archive} title="No archived notes">
            Archive a note to keep it out of the gallery without deleting it.
          </EmptyState>
        )}
      </section>
    </>
  );
}
