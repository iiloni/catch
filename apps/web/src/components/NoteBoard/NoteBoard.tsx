import { BOARD_COLUMNS, type Note } from '@catch/shared';
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
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
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { sendNoteToGallery, updateNote } from '@/lib/notes';
import { cn } from '@/lib/utils';

const GALLERY_DROP_ID = '__gallery__';
const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((column) => column.id));

// Drop where the pointer is; keyboard drags have no pointer, so fall back to overlap.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** How close to the pager's side (as a share of its width) a dragged card turns the page. */
const PAGE_EDGE = 0.14;
/** Hold at the edge this long before the first page turn, then between further turns. */
const FIRST_TURN_MS = 350;
const NEXT_TURN_MS = 800;

/** The pointer's position on screen from a touch or mouse event. */
function clientX(event: TouchEvent | MouseEvent) {
  return 'touches' in event ? (event.touches[0]?.clientX ?? null) : event.clientX;
}

type Props = {
  notes: Note[];
  onOpen: (note: Note, card: HTMLElement) => void;
};

/**
 * Kanban board of deck notes. On phones each column is a page of a horizontal pager;
 * wider screens show all columns side by side. Dragging a card reveals a "Send to
 * gallery" target above the dock.
 */
export function NoteBoard({ notes, onOpen }: Props) {
  const [active, setActive] = useState<{ note: Note; width: number } | null>(null);
  const [page, setPage] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  // The page being shown or scrolled to; `page` lags behind while the pager scrolls.
  const pageTarget = useRef(0);
  // Which edge the dragged card is held against, and the timer for the next page turn.
  const edge = useRef<{ side: -1 | 0 | 1; timer: number }>({ side: 0, timer: 0 });
  // Removes the pointer listeners that follow a drag.
  const unfollow = useRef<() => void>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A long press before dragging keeps touch scrolling (and the pager) working.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Notes with a status the board does not know about show in the first column.
  const columnOf = (note: Note) =>
    note.status && COLUMN_IDS.has(note.status) ? note.status : BOARD_COLUMNS[0].id;

  function handleDragStart(event: DragStartEvent) {
    const note = notes.find((n) => n.id === event.active.id);
    if (!note) return;
    haptics.longPress();
    setActive({ note, width: event.active.rect.current.initial?.width ?? 280 });
    // Raw pointer events: dnd-kit's drag delta also counts the pager's own scrolling, so
    // after a page turn it no longer says where the finger is.
    const follow = (moveEvent: TouchEvent | MouseEvent) => {
      const x = clientX(moveEvent);
      if (x !== null) followPointer(x);
    };
    window.addEventListener('touchmove', follow, { passive: true });
    window.addEventListener('mousemove', follow, { passive: true });
    unfollow.current = () => {
      window.removeEventListener('touchmove', follow);
      window.removeEventListener('mousemove', follow);
    };
  }

  function stopEdgeTurns() {
    window.clearTimeout(edge.current.timer);
    edge.current = { side: 0, timer: 0 };
  }

  function endDrag() {
    unfollow.current?.();
    unfollow.current = null;
    stopEdgeTurns();
    setActive(null);
  }

  // Unmounting mid-drag (say, the tab changes) must not leave listeners or a turn behind.
  useEffect(
    () => () => {
      unfollow.current?.();
      window.clearTimeout(edge.current.timer);
    },
    [],
  );

  // Holding a card against the pager's side turns one page after a pause, then one more
  // each NEXT_TURN_MS. (dnd-kit's own auto-scroll would race through every column.)
  function followPointer(pointer: number) {
    const element = pager.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    const box = element.getBoundingClientRect();
    const zone = box.width * PAGE_EDGE;
    const side = pointer < box.left + zone ? -1 : pointer > box.right - zone ? 1 : 0;
    if (side === edge.current.side) return;

    stopEdgeTurns();
    if (side === 0) return;
    const turn = (delay: number) => {
      edge.current = {
        side,
        timer: window.setTimeout(() => {
          const next = pageTarget.current + side;
          if (next < 0 || next >= BOARD_COLUMNS.length) return;
          haptics.selection();
          showPage(next);
          turn(NEXT_TURN_MS);
        }, delay),
      };
    };
    turn(FIRST_TURN_MS);
  }

  function handleDragEnd(event: DragEndEvent) {
    endDrag();
    const note = notes.find((n) => n.id === event.active.id);
    const target = event.over?.id;
    if (!note || !target) return;
    if (target === GALLERY_DROP_ID) {
      haptics.success();
      sendNoteToGallery(note.id);
    } else if (target !== columnOf(note)) {
      haptics.success();
      updateNote(note.id, { status: String(target) });
    }
  }

  function showPage(index: number) {
    pageTarget.current = index;
    const element = pager.current;
    const column = element?.children[index] as HTMLElement | undefined;
    if (element && column) element.scrollTo({ left: column.offsetLeft - 12, behavior: 'smooth' });
  }

  function onPagerScroll() {
    const element = pager.current;
    const first = element?.children[0] as HTMLElement | undefined;
    if (!element || !first) return;
    const next = Math.round(element.scrollLeft / (first.offsetWidth + 12));
    if (next !== page) {
      // Page turns during a drag already tick when they start.
      if (!active) haptics.selection();
      setPage(next);
    }
    // While dragging, only page turns move the pager, and they set the target themselves.
    if (!active) pageTarget.current = next;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      // Columns turn one at a time (followPointer); still scroll up and down on their own.
      autoScroll={{ canScroll: (element) => element !== pager.current }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <div
        role="tablist"
        aria-label="Columns"
        className="mx-3 mb-3 flex gap-1 rounded-2xl bg-foreground/[0.05] p-1 md:hidden"
      >
        {BOARD_COLUMNS.map((column, index) => (
          <button
            key={column.id}
            type="button"
            role="tab"
            aria-selected={page === index}
            onClick={() => showPage(index)}
            className={cn(
              'relative flex-1 rounded-xl py-1.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
              page === index ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {page === index && (
              <motion.span
                layoutId="board-page"
                aria-hidden
                className="absolute inset-0 rounded-xl bg-background shadow-sm"
                transition={springs.snappy}
              />
            )}
            <span className="relative">
              {column.name}
              <span className="ml-1.5 text-muted-foreground tabular-nums">
                {notes.filter((note) => columnOf(note) === column.id).length}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div
        ref={pager}
        onScroll={onPagerScroll}
        className="flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 [scrollbar-width:none] md:grid md:snap-none md:grid-cols-3 md:overflow-visible md:px-6"
      >
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            id={column.id}
            name={column.name}
            notes={notes.filter((note) => columnOf(note) === column.id)}
            onOpen={onOpen}
          />
        ))}
      </div>
      <AnimatePresence>{active && <GalleryDropZone key="gallery" />}</AnimatePresence>
      <DragOverlay dropAnimation={{ duration: 180 }}>
        {active && (
          <div style={{ width: active.width }}>
            <NoteCard
              note={active.note}
              withActions={false}
              className="rotate-2 scale-105 shadow-2xl"
            />
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
  onOpen: (note: Note, card: HTMLElement) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${name} column`}
      className={cn(
        // Large-container radius matches dialogs and empty states; cards inside keep
        // the card radius (rounded-2xl). The height fills the viewport down to the
        // dock so the column lands on the page's dock-space padding.
        'flex min-h-[calc(100dvh-var(--safe-top)-var(--dock-space)-11rem)] w-[86%] max-w-sm shrink-0 snap-start flex-col gap-2.5 rounded-3xl bg-foreground/[0.035] p-2.5 transition-colors md:min-h-[calc(100dvh-var(--safe-top)-var(--dock-space)-8rem)] md:w-auto md:max-w-none',
        isOver && 'bg-brand/15 ring-2 ring-brand/60',
      )}
    >
      <h3 className="hidden items-center justify-between px-2 pt-1 font-semibold text-sm md:flex">
        {name}
        <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
          {notes.length}
        </span>
      </h3>
      {notes.map((note) => (
        <DraggableNote key={note.id} note={note} onOpen={onOpen} />
      ))}
      {notes.length === 0 && (
        <p className="flex flex-1 items-center justify-center rounded-2xl border border-foreground/10 border-dashed p-6 text-center text-muted-foreground text-sm">
          Drop notes here
        </p>
      )}
    </section>
  );
}

function DraggableNote({
  note,
  onOpen,
}: {
  note: Note;
  onOpen: (note: Note, card: HTMLElement) => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: note.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('touch-manipulation transition-opacity', isDragging && 'opacity-30')}
    >
      <NoteCard note={note} onOpen={onOpen} />
    </div>
  );
}

function GalleryDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: GALLERY_DROP_ID });
  return (
    <motion.section
      ref={setNodeRef}
      aria-label="Send to gallery"
      initial={{ opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: isOver ? 1.06 : 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.9 }}
      transition={springs.bouncy}
      className={cn(
        'glass fixed inset-x-0 bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.75rem)] z-50 mx-auto flex h-16 w-[calc(100%-1.5rem)] max-w-md items-center justify-center gap-2 rounded-full font-medium text-sm',
        isOver && 'bg-brand text-brand-foreground',
      )}
    >
      <LayoutGrid className="size-5" aria-hidden />
      Send to gallery
    </motion.section>
  );
}
