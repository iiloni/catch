import { and, eq, isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { notesCollection } from '@/lib/collections';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';

export const Route = createFileRoute('/_app/archive')({
  component: ArchivePage,
});

function ArchivePage() {
  const { open } = useOpenNote();
  const { data: notes = [] } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) => and(isNull(note.deletedAt), eq(note.isArchived, true))),
  });

  return (
    <section aria-labelledby="archive-heading" className="flex flex-col gap-4">
      <h1 id="archive-heading" className="font-semibold text-lg">
        Archive
      </h1>
      {notes.length > 0 ? (
        <NoteGrid notes={sortNotes(notes)} onOpen={(note) => open(note.id)} />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          Archived notes appear here.
        </p>
      )}
    </section>
  );
}
