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
import { useRef, useState } from 'react';
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
import { isVaultNote } from '@/lib/vault';

type Props = {
  note: Note;
  /** Called after an action that moves the note out of view (archive, trash, delete). */
  onDone?: () => void;
  className?: string;
};

type Panel = 'color' | 'tags' | 'move' | 'reminder' | 'share';

/**
 * Actions for one note. Trashed notes can only be restored or deleted, and a note someone
 * else shared (ADR 0021) only archived or removed.
 */
export function NoteToolbar({ note, onDone, className }: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const lastPanel = useRef<Panel | null>(null);
  function setPanelOpen(next: Panel, open: boolean) {
    if (open) lastPanel.current = next;
    // A closing menu must not dismiss the one that just replaced it.
    setPanel((current) => (open ? next : current === next ? null : current));
  }
  function onCloseAutoFocus(closing: Panel, event: Event) {
    // A departing menu leaves focus with its replacement instead of stealing it back.
    if (panel !== null || lastPanel.current !== closing) event.preventDefault();
  }
  const isShared = useNoteShares().has(note.id);
  const reminder = useReminders().get(note.id);
  const color = useNoteColor(note);
  const then = (action: () => unknown) => () => {
    action();
    onDone?.();
  };

  if (note.deletedAt) {
    return (
      <div data-card-actions className={cn('flex items-center gap-0.5', className)}>
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
      <div data-card-actions className={cn('flex items-center gap-0.5', className)}>
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
      data-card-actions
      className={cn('flex flex-col', className, panel !== null && 'visible opacity-100')}
    >
      <div className="flex min-w-0 items-center gap-0.5 [&>button]:min-w-0 [&>button]:shrink">
        <NoteColorPicker
          note={note}
          onChange={(color) => setNoteColor(note.id, color)}
          onTagChange={(id) => setPrimaryTag(note.id, id)}
          open={panel === 'color'}
          onOpenChange={(open) => setPanelOpen('color', open)}
          onCloseAutoFocus={(event) => onCloseAutoFocus('color', event)}
        />
        <Popover open={panel === 'tags'} onOpenChange={(open) => setPanelOpen('tags', open)}>
          <PopoverTrigger asChild>
            <IconButton label="Tags" onClick={haptics.toggle}>
              <Tags />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            onCloseAutoFocus={(event) => onCloseAutoFocus('tags', event)}
            collisionPadding={16}
            sticky="always"
            className="w-80 max-w-[calc(100vw-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <TagPicker noteId={note.id} />
          </PopoverContent>
        </Popover>
        <Popover open={panel === 'move'} onOpenChange={(open) => setPanelOpen('move', open)}>
          <PopoverTrigger asChild>
            <IconButton label="Move note" onClick={() => haptics.toggle()}>
              {note.status === null ? <LayoutDashboard /> : <CardMoveIcon status={note.status} />}
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Move note"
            onCloseAutoFocus={(event) => onCloseAutoFocus('move', event)}
            className="w-80 max-w-[calc(100vw-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <CardMovePicker
              current={note.status}
              onSelect={(status) => {
                setPanelOpen('move', false);
                if (status === note.status) return;
                haptics.success();
                if (status === null) sendNoteToGallery(note.id);
                else moveNoteToDeck(note.id, status);
              }}
            />
          </PopoverContent>
        </Popover>
        <Popover
          open={panel === 'reminder'}
          onOpenChange={(open) => setPanelOpen('reminder', open)}
        >
          <PopoverTrigger asChild>
            <IconButton label="Reminder" onClick={() => haptics.toggle()}>
              <Bell className={cn(reminder && 'fill-current')} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Reminder"
            onCloseAutoFocus={(event) => onCloseAutoFocus('reminder', event)}
            // Beside an open note the page is only as wide as the pane leaves it.
            className="w-96 max-w-[calc(100vw-var(--note-pane)-2rem)] rounded-3xl p-1 pb-2"
            onClick={(event) => event.stopPropagation()}
          >
            <ReminderPanel
              note={note}
              color={color}
              reminder={reminder}
              onDone={() => setPanelOpen('reminder', false)}
              // Less the panel's action row, which sits under this.
              className="max-h-[min(30rem,calc(var(--radix-popover-content-available-height)-5.25rem))]"
            />
          </PopoverContent>
        </Popover>
        {/* A link would hand the server a vault note to read, which it must never have. */}
        {!isVaultNote(note.id) && (
          <Popover open={panel === 'share'} onOpenChange={(open) => setPanelOpen('share', open)}>
            <PopoverTrigger asChild>
              <IconButton label="Share" onClick={() => haptics.toggle()}>
                <Share2 className={cn(isShared && 'fill-current')} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent
              aria-label="Share"
              onCloseAutoFocus={(event) => onCloseAutoFocus('share', event)}
              className="w-96 max-w-[calc(100vw-var(--note-pane)-2rem)] rounded-3xl p-1 pb-2"
              onClick={(event) => event.stopPropagation()}
            >
              <SharePanel note={note} />
            </PopoverContent>
          </Popover>
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
