import type { Note } from '@catch/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { Pin } from 'lucide-react';
import { useEffect } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteToolbar } from '@/components/NoteToolbar/NoteToolbar';
import { SaveStatus } from '@/components/SaveStatus/SaveStatus';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { notesCollection } from '@/lib/collections';
import { setNotePinned } from '@/lib/notes';
import { useOpenNote } from '@/lib/openNote';
import { useNoteAutosave } from '@/lib/useNoteAutosave';
import { cn } from '@/lib/utils';

type Props = {
  noteId: string | undefined;
};

export function NoteEditorDialog({ noteId }: Props) {
  const { close } = useOpenNote();
  const { data: matches = [], isReady } = useLiveQuery(
    (q) => q.from({ note: notesCollection }).where(({ note }) => eq(note.id, noteId ?? '')),
    [noteId],
  );
  const note = matches[0];

  // A deleted or unknown note id in the URL closes the editor.
  useEffect(() => {
    if (noteId && isReady && !note) close();
  }, [noteId, isReady, note, close]);

  return (
    <Dialog open={Boolean(note)} onOpenChange={(open) => !open && close()}>
      {note && <NoteEditorContent key={note.id} note={note} onClose={close} />}
    </Dialog>
  );
}

function NoteEditorContent({ note, onClose }: { note: Note; onClose: () => void }) {
  const { state, save, flush } = useNoteAutosave(note.id);
  const editable = !note.deletedAt;

  return (
    <DialogContent
      data-note-color={note.color}
      showCloseButton={false}
      // Neither the pin button nor the card should grab focus (and a tooltip).
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      className="flex max-h-[85dvh] flex-col gap-0 bg-note p-0 sm:max-w-2xl max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
    >
      <DialogTitle className="sr-only">Edit note</DialogTitle>
      <DialogDescription className="sr-only">Changes are saved automatically.</DialogDescription>
      {editable && !note.isArchived && (
        <IconButton
          label={note.isPinned ? 'Unpin' : 'Pin'}
          onClick={() => setNotePinned(note.id, !note.isPinned)}
          className="absolute top-2 right-2 z-10"
        >
          <Pin className={cn(note.isPinned && 'fill-current')} />
        </IconButton>
      )}
      <div className="min-h-40 flex-1 overflow-y-auto pt-4 pb-2">
        <LazyNoteEditor initialContent={note.content} onChange={save} editable={editable} />
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-foreground/10 border-t px-3 py-2">
        <SaveStatus state={state} updatedAt={note.updatedAt} />
        <NoteToolbar
          note={note}
          onDone={() => {
            flush();
            onClose();
          }}
          className="ml-auto"
        />
        <Button
          variant="ghost"
          onClick={() => {
            flush();
            onClose();
          }}
        >
          Close
        </Button>
      </footer>
    </DialogContent>
  );
}
