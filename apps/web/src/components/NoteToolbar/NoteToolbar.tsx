import type { Note } from '@catch/shared';
import {
  Archive,
  ArchiveRestore,
  Columns3,
  LayoutGrid,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { IconButton } from '@/components/IconButton/IconButton';
import {
  deleteNoteForever,
  moveNoteToDeck,
  restoreNote,
  sendNoteToGallery,
  setNoteArchived,
  setNoteColor,
  trashNote,
} from '@/lib/notes';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  /** Called after an action that moves the note out of view (archive, trash, delete). */
  onDone?: () => void;
  className?: string;
};

/** Actions for one note. Trashed notes can only be restored or deleted. */
export function NoteToolbar({ note, onDone, className }: Props) {
  const then = (action: () => unknown) => () => {
    action();
    onDone?.();
  };

  if (note.deletedAt) {
    return (
      <div className={cn('flex items-center gap-0.5', className)}>
        <IconButton label="Restore" onClick={then(() => restoreNote(note.id))}>
          <RotateCcw />
        </IconButton>
        <IconButton label="Delete forever" onClick={then(() => deleteNoteForever(note.id))}>
          <TriangleAlert />
        </IconButton>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <ColorPicker value={note.color} onChange={(color) => setNoteColor(note.id, color)} />
      {note.status === null ? (
        <IconButton label="Add to deck" onClick={() => moveNoteToDeck(note.id)}>
          <Columns3 />
        </IconButton>
      ) : (
        <IconButton label="Send to gallery" onClick={() => sendNoteToGallery(note.id)}>
          <LayoutGrid />
        </IconButton>
      )}
      {note.isArchived ? (
        <IconButton label="Unarchive" onClick={() => setNoteArchived(note.id, false)}>
          <ArchiveRestore />
        </IconButton>
      ) : (
        <IconButton label="Archive" onClick={then(() => setNoteArchived(note.id, true))}>
          <Archive />
        </IconButton>
      )}
      <IconButton label="Move to trash" onClick={then(() => trashNote(note.id))}>
        <Trash2 />
      </IconButton>
    </div>
  );
}
