import { DEFAULT_BOARD_STATUS, type Note } from '@catch/shared';
import {
  Archive,
  ArchiveRestore,
  Columns3,
  LayoutDashboard,
  RotateCcw,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { NoteColorPicker } from '@/components/ColorPicker/ColorPicker';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteMovePicker } from '@/components/NoteMovePicker/NoteMovePicker';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import {
  deleteNoteForever,
  moveNoteToDeck,
  restoreNote,
  sendNoteToGallery,
  setNoteArchived,
  setNoteColor,
  trashNote,
} from '@/lib/notes';
import { setPrimaryTag } from '@/lib/tags';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  /** Called after an action that moves the note out of view (archive, trash, delete). */
  onDone?: () => void;
  className?: string;
};

/** Actions for one note. Trashed notes can only be restored or deleted. */
export function NoteToolbar({ note, onDone, className }: Props) {
  const [moving, setMoving] = useState(false);
  const [tagging, setTagging] = useState(false);
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
    <div className={cn('flex flex-col', className, (moving || tagging) && 'opacity-100')}>
      <div className="flex items-center gap-0.5">
        <NoteColorPicker
          note={note}
          onChange={(color) => setNoteColor(note.id, color)}
          onTagChange={(id) => setPrimaryTag(note.id, id)}
        />
        <Popover open={tagging} onOpenChange={setTagging}>
          <PopoverTrigger asChild>
            <IconButton label="Tags" onClick={haptics.toggle}>
              <Tags />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 max-w-[calc(100vw-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <TagPicker noteId={note.id} />
          </PopoverContent>
        </Popover>
        <Popover open={moving} onOpenChange={setMoving}>
          <PopoverTrigger asChild>
            <IconButton label="Move note" onClick={() => haptics.toggle()}>
              {note.status === null ? <LayoutDashboard /> : <CardMoveIcon status={note.status} />}
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Move note"
            className="w-80 max-w-[calc(100vw-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <CardMovePicker
              current={note.status}
              onSelect={(status) => {
                setMoving(false);
                if (status === note.status) return;
                haptics.success();
                if (status === null) sendNoteToGallery(note.id);
                else moveNoteToDeck(note.id, status);
              }}
            />
          </PopoverContent>
        </Popover>
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
    </div>
  );
}

function CardMovePicker({
  current,
  onSelect,
}: {
  current: string | null;
  onSelect: (status: string | null) => void;
}) {
  const columns = sortBoardColumns(useBoardColumns());
  return (
    <NoteMovePicker columns={columns} current={current} hovered={undefined} onSelect={onSelect} />
  );
}

function CardMoveIcon({ status }: { status: string }) {
  const columns = useBoardColumns();
  const column =
    columns.find((column) => column.id === status) ??
    columns.find((column) => column.id === DEFAULT_BOARD_STATUS);
  return (
    <span
      className="relative flex size-4 items-center justify-center"
      data-column-color={column?.color ?? 'amber'}
    >
      <Columns3 className="size-4" aria-hidden />
      <span
        aria-hidden
        className="absolute -bottom-1 inset-x-0 h-0.5 rounded-full bg-[var(--column-accent)]"
      />
    </span>
  );
}
