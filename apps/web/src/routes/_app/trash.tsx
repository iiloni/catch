import { isNull, not, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { notesCollection } from '@/lib/collections';
import { deleteNoteForever } from '@/lib/notes';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';

export const Route = createFileRoute('/_app/trash')({
  component: TrashPage,
});

function TrashPage() {
  const { open } = useOpenNote();
  const [confirming, setConfirming] = useState(false);
  const { data: notes = [] } = useLiveQuery({
    query: (q) =>
      q.from({ note: notesCollection }).where(({ note }) => not(isNull(note.deletedAt))),
  });

  function emptyTrash() {
    for (const note of notes) deleteNoteForever(note.id);
    setConfirming(false);
  }

  return (
    <section aria-labelledby="trash-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 id="trash-heading" className="font-semibold text-lg">
          Trash
        </h1>
        {notes.length > 0 && (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Empty trash
          </Button>
        )}
      </div>
      {notes.length > 0 ? (
        <NoteGrid notes={sortNotes(notes)} onOpen={(note) => open(note.id)} />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          No notes in the trash.
        </p>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>Empty trash?</DialogTitle>
          <DialogDescription>
            {notes.length === 1
              ? 'The note in the trash will be deleted forever.'
              : `All ${notes.length} notes in the trash will be deleted forever.`}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={emptyTrash}>
              Empty trash
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
