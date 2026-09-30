import { DEFAULT_BOARD_STATUS, type Note } from '@catch/shared';
import {
  Archive,
  ArchiveRestore,
  Columns3,
  LayoutDashboard,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { IconButton } from '@/components/IconButton/IconButton';
import { NoteMovePicker } from '@/components/NoteMovePicker/NoteMovePicker';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
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
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moving) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMoving(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoving(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moving]);
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
    <div ref={ref} className={cn('flex flex-col', className, moving && 'opacity-100')}>
      <AnimatePresence initial={false}>
        {moving && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
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
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-0.5">
        <ColorPicker value={note.color} onChange={(color) => setNoteColor(note.id, color)} />
        <IconButton
          label="Move note"
          aria-expanded={moving}
          onClick={() => {
            haptics.toggle();
            setMoving(!moving);
          }}
        >
          {note.status === null ? <LayoutDashboard /> : <CardMoveIcon status={note.status} />}
        </IconButton>
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
