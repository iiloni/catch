import { BOARD_COLUMNS, type Note } from '@catch/shared';
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { sendNoteToGallery, updateNote } from '@/lib/notes';
import { cn } from '@/lib/utils';

const GALLERY_DROP_ID = '__gallery__';
const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((column) => column.id));

// Drop where the pointer is; keyboard drags have no pointer, so fall back to overlap.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

type Props = {
  notes: Note[];
  onOpen: (note: Note) => void;
};

/** Kanban board of deck notes. Dropping on "Send to gallery" clears the status. */
export function NoteBoard({ notes, onOpen }: Props) {
  const [active, setActive] = useState<{ note: Note; width: number } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A short press before dragging keeps touch scrolling working.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Notes with a status the board does not know about show in the first column.
  const columnOf = (note: Note) =>
    note.status && COLUMN_IDS.has(note.status) ? note.status : BOARD_COLUMNS[0].id;

  function handleDragStart(event: DragStartEvent) {
    const note = notes.find((n) => n.id === event.active.id);
    if (note) setActive({ note, width: event.active.rect.current.initial?.width ?? 280 });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActive(null);
    const note = notes.find((n) => n.id === event.active.id);
    const target = event.over?.id;
    if (!note || !target) return;
    if (target === GALLERY_DROP_ID) sendNoteToGallery(note.id);
    else if (target !== columnOf(note)) updateNote(note.id, { status: String(target) });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            id={column.id}
            name={column.name}
            notes={notes.filter((note) => columnOf(note) === column.id)}
            onOpen={onOpen}
          />
        ))}
        <GalleryDropZone dragging={active !== null} />
      </div>
      <DragOverlay dropAnimation={{ duration: 150 }}>
        {active && (
          <div style={{ width: active.width }}>
            <NoteCard note={active.note} withActions={false} className="rotate-1 shadow-xl" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  id,
  name,
  notes,
  onOpen,
}: {
  id: string;
  name: string;
  notes: Note[];
  onOpen: (note: Note) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${name} column`}
      className={cn(
        'flex min-h-40 flex-col gap-3 rounded-lg border bg-secondary/50 p-3 transition-colors md:max-h-[70dvh]',
        isOver && 'border-ring bg-accent',
      )}
    >
      <h3 className="flex items-center justify-between font-medium text-sm">
        {name}
        <span className="text-muted-foreground">{notes.length}</span>
      </h3>
      <div className="flex flex-col gap-3 overflow-y-auto">
        {notes.map((note) => (
          <DraggableNote key={note.id} note={note} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function DraggableNote({ note, onOpen }: { note: Note; onOpen: (note: Note) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: note.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('touch-manipulation', isDragging && 'opacity-30')}
    >
      <NoteCard note={note} onOpen={onOpen} />
    </div>
  );
}

function GalleryDropZone({ dragging }: { dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: GALLERY_DROP_ID });
  return (
    <section
      ref={setNodeRef}
      aria-label="Send to gallery"
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-muted-foreground transition-colors',
        dragging && 'border-ring text-foreground',
        isOver && 'bg-accent',
      )}
    >
      <LayoutGrid className="size-6" aria-hidden />
      <p className="font-medium text-sm">Send to gallery</p>
    </section>
  );
}
