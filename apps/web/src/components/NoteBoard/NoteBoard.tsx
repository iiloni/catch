import { BOARD_COLUMNS, comparePositions, type Note } from '@catch/shared';
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
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
import { moveDeckNote, sendNoteToGallery } from '@/lib/notes';
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
const DROP_ANIMATION_MS = 180;

type Props = {
  notes: Note[];
  onOpen: (note: Note, card: HTMLElement) => void;
};

type Point = { x: number; y: number };
type DropTarget = { column: string; index: number };

function eventPoint(event: Event): Point | null {
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
  return null;
}

/** The slot before the first card whose midpoint is below the drag pointer. */
function dropIndex(column: HTMLElement, y: number, activeId: string) {
  const cards = [...column.querySelectorAll<HTMLElement>('[data-board-card]')].filter(
    (card) => card.dataset.boardCard !== activeId,
  );
  const index = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return index < 0 ? cards.length : index;
}

/**
 * Kanban board of deck notes. When narrow, each column is a page of a horizontal pager;
 * wider boards show all columns side by side. Dragging a card reveals a "Send to
 * gallery" target above the dock.
 */
export function NoteBoard({ notes, onOpen }: Props) {
  const [active, setActive] = useState<{ note: Note; width: number; height: number } | null>(null);
  const activeNote = useRef<Note | null>(null);
  const pointer = useRef<Point | null>(null);
  const target = useRef<DropTarget | null>(null);
  const [preview, setPreview] = useState<DropTarget | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const settlingTimer = useRef(0);
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

  // Position controls the order inside each column, including pinned notes.
  const ordered = [...notes].sort(
    (a, b) =>
      comparePositions(a.position, b.position) || b.createdAt.getTime() - a.createdAt.getTime(),
  );

  function setDropTarget(next: DropTarget | null) {
    if (target.current?.column === next?.column && target.current?.index === next?.index) return;
    target.current = next;
    setPreview(next);
  }

  function dropAtPoint(point: Point, note: Note): DropTarget | null {
    const columns = pager.current?.querySelectorAll<HTMLElement>('[data-board-column]');
    if (!columns) return null;
    for (const column of columns) {
      const rect = column.getBoundingClientRect();
      if (
        point.x < rect.left ||
        point.x > rect.right ||
        point.y < rect.top ||
        point.y > rect.bottom
      )
        continue;
      const id = column.dataset.boardColumn;
      if (id) return { column: id, index: dropIndex(column, point.y, note.id) };
    }
    return null;
  }

  function updateDropTarget(point: Point, note: Note) {
    setDropTarget(dropAtPoint(point, note));
  }

  function handleDragStart(event: DragStartEvent) {
    const note = notes.find((n) => n.id === event.active.id);
    if (!note) return;
    window.clearTimeout(settlingTimer.current);
    setSettlingId(null);
    haptics.longPress();
    // dnd-kit can call onDragStart before its initial rectangle is measured.
    const card = [
      ...(pager.current?.querySelectorAll<HTMLElement>('[data-board-card]') ?? []),
    ].find((element) => element.dataset.boardCard === note.id);
    const rect = card?.getBoundingClientRect() ?? event.active.rect.current.initial;
    setActive({ note, width: rect?.width ?? 280, height: rect?.height ?? 96 });
    activeNote.current = note;
    pointer.current = eventPoint(event.activatorEvent);
    setDropTarget({
      column: columnOf(note),
      index: ordered.filter((other) => columnOf(other) === columnOf(note)).indexOf(note),
    });
    // Raw pointer events: dnd-kit's drag delta also counts the pager's own scrolling, so
    // after a page turn it no longer says where the finger is.
    const follow = (moveEvent: TouchEvent | MouseEvent) => {
      const point = eventPoint(moveEvent);
      if (!point) return;
      pointer.current = point;
      followPointer(point.x);
      updateDropTarget(point, note);
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

  function endDrag(id?: string) {
    unfollow.current?.();
    unfollow.current = null;
    stopEdgeTurns();
    activeNote.current = null;
    pointer.current = null;
    setDropTarget(null);
    setActive(null);
    if (id) {
      // The overlay stays for its drop animation; keep the placed card's controls
      // visible until hover has settled underneath it.
      setSettlingId(id);
      settlingTimer.current = window.setTimeout(() => setSettlingId(null), DROP_ANIMATION_MS + 60);
    }
  }

  function handleDragMove(event: DragMoveEvent) {
    // Keyboard drags have no pointer events to follow.
    if (pointer.current || !activeNote.current) return;
    const rect = event.active.rect.current.translated;
    if (rect)
      updateDropTarget(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        activeNote.current,
      );
  }

  // Unmounting mid-drag (say, the tab changes) must not leave listeners or a turn behind.
  useEffect(
    () => () => {
      unfollow.current?.();
      window.clearTimeout(edge.current.timer);
      window.clearTimeout(settlingTimer.current);
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
    const note = notes.find((n) => n.id === event.active.id);
    const over = event.over?.id;
    const point =
      pointer.current ??
      (event.active.rect.current.translated
        ? {
            x:
              event.active.rect.current.translated.left +
              event.active.rect.current.translated.width / 2,
            y:
              event.active.rect.current.translated.top +
              event.active.rect.current.translated.height / 2,
          }
        : null);
    const destination = note && point ? dropAtPoint(point, note) : target.current;
    endDrag(note?.id);
    if (!note || !over) return;
    if (over === GALLERY_DROP_ID) {
      haptics.success();
      sendNoteToGallery(note.id);
    } else if (COLUMN_IDS.has(String(over)) && destination?.column === over) {
      const others = ordered.filter((other) => other.id !== note.id && columnOf(other) === over);
      const from = ordered.filter((other) => columnOf(other) === over).indexOf(note);
      if (over === columnOf(note) && destination.index === from) return;
      haptics.success();
      moveDeckNote(note.id, String(over), others, destination.index);
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
    else if (pointer.current && activeNote.current)
      updateDropTarget(pointer.current, activeNote.current);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      // Columns turn one at a time (followPointer); still scroll up and down on their own.
      autoScroll={{ canScroll: (element) => element !== pager.current }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => endDrag(activeNote.current?.id)}
    >
      {/* Sized by its own width, which a note open beside the page narrows. */}
      <div className="@container">
        <div
          role="tablist"
          aria-label="Columns"
          className="mx-3 mb-3 flex gap-1 rounded-2xl bg-foreground/[0.05] p-1 @3xl:hidden"
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
                  {ordered.filter((note) => columnOf(note) === column.id).length}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div
          ref={pager}
          onScroll={onPagerScroll}
          className="flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 [scrollbar-width:none] @3xl:grid @3xl:snap-none @3xl:grid-cols-3 @3xl:overflow-visible @3xl:px-6"
        >
          {BOARD_COLUMNS.map((column) => (
            <BoardColumn
              key={column.id}
              id={column.id}
              name={column.name}
              notes={ordered.filter((note) => columnOf(note) === column.id)}
              active={active}
              preview={preview}
              settlingId={settlingId}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      <AnimatePresence>{active && <GalleryDropZone key="gallery" />}</AnimatePresence>
      <DragOverlay dropAnimation={{ duration: DROP_ANIMATION_MS }}>
        {active && (
          <div style={{ width: active.width }}>
            <NoteCard note={active.note} pressable={false} forceHover />
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
  active,
  preview,
  settlingId,
  onOpen,
}: {
  id: string;
  name: string;
  notes: Note[];
  active: { note: Note; height: number } | null;
  preview: DropTarget | null;
  settlingId: string | null;
  onOpen: (note: Note, card: HTMLElement) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const shown = [...notes];
  const activeInColumn = active && notes.some((note) => note.id === active.note.id);
  if (activeInColumn && preview?.column === id) {
    shown.splice(
      shown.findIndex((note) => note.id === active.note.id),
      1,
    );
    shown.splice(preview.index, 0, active.note);
  }
  const showPlaceholder = active && preview?.column === id && !activeInColumn;
  return (
    <section
      ref={setNodeRef}
      data-board-column={id}
      aria-label={`${name} column`}
      className={cn(
        // Large-container radius matches dialogs and empty states; cards inside keep
        // the card radius (rounded-2xl). The height fills the viewport down to the
        // dock so the column lands on the page's dock-space padding.
        'flex min-h-[calc(100dvh-var(--safe-top)-var(--dock-space)-11rem)] w-[86%] max-w-sm shrink-0 snap-start flex-col gap-2.5 rounded-3xl bg-foreground/[0.035] p-2.5 transition-colors @3xl:min-h-[calc(100dvh-var(--safe-top)-var(--dock-space)-8rem)] @3xl:w-auto @3xl:max-w-none',
        isOver && 'bg-brand/15 ring-2 ring-brand/60',
      )}
    >
      <h3 className="hidden items-center justify-between px-2 pt-1 font-semibold text-sm @3xl:flex">
        {name}
        <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
          {notes.length}
        </span>
      </h3>
      {shown.map((note, index) => (
        <div key={note.id}>
          {showPlaceholder && preview.index === index && <DropPlaceholder height={active.height} />}
          <DraggableNote note={note} settling={settlingId === note.id} onOpen={onOpen} />
        </div>
      ))}
      {showPlaceholder && preview.index === shown.length && (
        <DropPlaceholder height={active.height} />
      )}
      {notes.length === 0 && !showPlaceholder && (
        <p className="flex flex-1 items-center justify-center rounded-2xl border border-foreground/10 border-dashed p-6 text-center text-muted-foreground text-sm">
          Drop notes here
        </p>
      )}
    </section>
  );
}

function DropPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      style={{ height }}
      className="mb-2.5 rounded-2xl border-2 border-brand/60 border-dashed bg-brand/10"
    />
  );
}

function DraggableNote({
  note,
  settling,
  onOpen,
}: {
  note: Note;
  settling: boolean;
  onOpen: (note: Note, card: HTMLElement) => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: note.id });
  return (
    <div
      ref={setNodeRef}
      data-board-card={note.id}
      {...attributes}
      {...listeners}
      // dnd-kit hides this node during the overlay's drop animation. An opacity
      // transition would fade it out and back in after release, making it flash.
      className={cn('touch-manipulation', isDragging && 'opacity-30')}
    >
      <NoteCard note={note} onOpen={onOpen} forceHover={isDragging || settling} />
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
        'glass fixed right-[calc(var(--note-pane)+0.75rem)] bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.75rem)] left-3 z-50 mx-auto flex h-16 max-w-md items-center justify-center gap-2 rounded-full font-medium text-sm',
        isOver && 'bg-brand text-brand-foreground',
      )}
    >
      <LayoutGrid className="size-5" aria-hidden />
      Send to gallery
    </motion.section>
  );
}
