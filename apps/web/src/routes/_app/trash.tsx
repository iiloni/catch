import { isNull, not, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { BackToGallery, PageHeader } from '@/components/PageHeader/PageHeader';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { notesCollection } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { useNoteSelection } from '@/lib/noteSelection';
import { deleteNotesForever } from '@/lib/notes';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';

export const Route = createFileRoute('/_app/trash')({
  component: TrashPage,
});

function TrashPage() {
  const { open } = useOpenNote();
  const [confirming, setConfirming] = useState(false);
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) =>
      q.from({ note: notesCollection }).where(({ note }) => not(isNull(note.deletedAt))),
  });
  const sorted = sortNotes(notes);
  const selection = useNoteSelection(sorted);

  function emptyTrash() {
    haptics.warning();
    deleteNotesForever(notes.map((note) => note.id));
    setConfirming(false);
  }

  return (
    <>
      <PageHeader
        title="Trash"
        leading={<BackToGallery />}
        trailing={
          notes.length > 0 && (
            <Button
              variant="ghost"
              className="h-10 rounded-full px-4 text-[1.0625rem] text-destructive"
              onClick={() => setConfirming(true)}
            >
              Empty trash
            </Button>
          )
        }
        selection={selectionHeader(selection, 'trash')}
      />
      <section aria-label="Trash" className="mx-auto max-w-7xl px-3 pt-3 sm:px-6">
        {isLoading ? null : notes.length > 0 ? (
          <NoteGrid
            notes={sorted}
            onOpen={(note, card) => open(note.id, card)}
            selected={selection.ids}
            onSelect={selection.select}
          />
        ) : (
          <EmptyState icon={Trash2} title="No notes in the trash.">
            Notes you move to the trash can be restored until you empty it.
          </EmptyState>
        )}
      </section>
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
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" className="rounded-full" onClick={emptyTrash}>
              Empty trash
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
