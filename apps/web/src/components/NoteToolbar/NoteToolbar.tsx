import { DEFAULT_BOARD_STATUS, type Note } from '@catch/shared';
import {
  Archive,
  ArchiveRestore,
  Bell,
  CircleMinus,
  Columns3,
  LayoutDashboard,
  RotateCcw,
  Share2,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { NoteColorPicker } from '@/components/ColorPicker/ColorPicker';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteMovePicker } from '@/components/NoteMovePicker/NoteMovePicker';
import { ReminderPanel } from '@/components/ReminderPanel/ReminderPanel';
import { SharePanel } from '@/components/SharePanel/SharePanel';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns, useNoteShares, useReminders } from '@/lib/collections';
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
import { isSharedNote, removeSharedNote } from '@/lib/sharing';
import { setPrimaryTag, useNoteColor } from '@/lib/tags';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  /** Called after an action that moves the note out of view (archive, trash, delete). */
  onDone?: () => void;
  className?: string;
};

/**
 * Actions for one note. Trashed notes can only be restored or deleted, and a note someone
 * else shared (ADR 0020) only archived or removed.
 */
export function NoteToolbar({ note, onDone, className }: Props) {
  const [moving, setMoving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const isShared = useNoteShares().has(note.id);
  const reminder = useReminders().get(note.id);
  const color = useNoteColor(note);
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

  if (isSharedNote(note)) {
    return (
      <div className={cn('flex items-center gap-0.5', className)}>
        {note.isArchived ? (
          <IconButton label="Unarchive" onClick={() => setNoteArchived(note.id, false)}>
            <ArchiveRestore />
          </IconButton>
        ) : (
          <IconButton label="Archive" onClick={then(() => setNoteArchived(note.id, true))}>
            <Archive />
          </IconButton>
        )}
        <IconButton label="Remove from my notes" onClick={then(() => removeSharedNote(note.id))}>
          <CircleMinus />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col',
        className,
        (moving || tagging || reminding || sharing) && 'opacity-100',
      )}
    >
      <div className="flex min-w-0 items-center gap-0.5 [&>button]:min-w-0 [&>button]:shrink">
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
            collisionPadding={16}
            sticky="always"
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
        <Popover open={reminding} onOpenChange={setReminding}>
          <PopoverTrigger asChild>
            <IconButton label="Reminder" onClick={() => haptics.toggle()}>
              <Bell className={cn(reminder && 'fill-current')} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Reminder"
            // Beside an open note the page is only as wide as the pane leaves it.
            className="w-96 max-w-[calc(100vw-var(--note-pane)-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <ReminderPanel
              note={note}
              color={color}
              reminder={reminder}
              onDone={() => setReminding(false)}
              // Less the panel's action row, which sits under this.
              className="max-h-[min(30rem,calc(var(--radix-popover-content-available-height)-5.25rem))]"
            />
          </PopoverContent>
        </Popover>
        <Popover open={sharing} onOpenChange={setSharing}>
          <PopoverTrigger asChild>
            <IconButton label="Share" onClick={() => haptics.toggle()}>
              <Share2 className={cn(isShared && 'fill-current')} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Share"
            className="w-96 max-w-[calc(100vw-var(--note-pane)-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <SharePanel note={note} />
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
