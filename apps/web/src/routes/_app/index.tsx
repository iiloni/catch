import { and, eq, isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { DeckSection } from '@/components/DeckSection/DeckSection';
import { GallerySection } from '@/components/GallerySection/GallerySection';
import { NoteComposer } from '@/components/NoteComposer/NoteComposer';
import { authClient } from '@/lib/auth';
import { notesCollection } from '@/lib/collections';
import { useOpenNote } from '@/lib/openNote';

export const Route = createFileRoute('/_app/')({
  component: NotesPage,
});

function NotesPage() {
  const { data: session } = authClient.useSession();
  const { open } = useOpenNote();
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) => and(isNull(note.deletedAt), eq(note.isArchived, false))),
  });

  const deck = notes.filter((note) => note.status !== null);
  const gallery = notes.filter((note) => note.status === null);
  const openNote = (note: { id: string }) => open(note.id);

  return (
    <>
      {session && <NoteComposer userId={session.user.id} />}
      {isLoading ? (
        <p className="text-muted-foreground">Loading notes…</p>
      ) : (
        <>
          <DeckSection notes={deck} onOpen={openNote} />
          <GallerySection notes={gallery} onOpen={openNote} />
        </>
      )}
    </>
  );
}
