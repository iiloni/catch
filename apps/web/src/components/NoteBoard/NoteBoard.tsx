import {
  type BoardColumn as BoardColumnData,
  comparePositions,
  DEFAULT_BOARD_STATUS,
  type Note,
} from '@catch/shared';
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
import { LayoutGrid, type LucideIcon, X } from 'lucide-react';
import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SelectCheck } from '@/components/SelectCheck/SelectCheck';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { sortBoardColumns } from '@/lib/boardColumns';
import { haptics } from '@/lib/haptics';
import { LONG_PRESS_MS, LONG_PRESS_TOLERANCE, useLongPress } from '@/lib/longPress';
import { springs } from '@/lib/motion';
import { moveDeckNotes, sendNotesToGallery, sendNoteToGallery } from '@/lib/notes';
import { usePersistentState } from '@/lib/storage';
import { cn } from '@/lib/utils';

const GALLERY_DROP_ID = '__gallery__';
const CANCEL_DROP_ID = '__cancel__';
const DROP_ZONE_IDS = new Set<unknown>([GALLERY_DROP_ID, CANCEL_DROP_ID]);

// Drop where the pointer is; keyboard drags have no pointer, so fall back to overlap.
// The targets above the dock float over the columns and take precedence over them.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const zone = hits.find((hit) => DROP_ZONE_IDS.has(hit.id));
  if (zone) return [zone];
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** How close to the pager's side (as a share of its width) a dragged card turns the page. */
const PAGE_EDGE = 0.14;
/** Hold at the edge this long before the first page turn, then between further turns. */
const FIRST_TURN_MS = 350;
const NEXT_TURN_MS = 800;
const DROP_ANIMATION_MS = 180;
/** How many of a held stack's other cards fly into it; the rest just join the count. */
const STACK_FLYERS = 6;

type Props = {
  notes: Note[];
  columns: BoardColumnData[];
  onOpen: (note: Note, card: HTMLElement) => void;
  /**
   * The selected notes' ids. With `onSelect`, a long press selects a note and, while any
   * note is selected, a tap selects or deselects one instead of opening it, and dragging
   * one carries every selected note along in a stack.
   */
  selected?: ReadonlySet<string>;
  onSelect?: (note: Note, selected: boolean) => void;
  /** Ends selecting, after a stack of selected notes has been moved. */
  onSelectionDone?: () => void;
};

type Point = { x: number; y: number };
type DropTarget = { column: string; index: number };

/** The card being dragged and, when it carries a stack, every note in it. */
type Held = {
  note: Note;
  /** The notes being moved in board order: the held note alone, or the selection. */
  group: Note[];
  width: number;
  height: number;
  /** Where the stack's other cards started, relative to the held card. */
  origins: Map<string, Point>;
};

/** Notes just dropped as a stack, kept out of sight until they reach their column. */
type Landing = { ids: ReadonlySet<string>; column: string | null };

function eventPoint(event: Event): Point | null {
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
  return null;
}

/** The slot before the first card whose midpoint is below the drag pointer. */
function dropIndex(column: HTMLElement, y: number, moving: ReadonlySet<string>) {
  const cards = [...column.querySelectorAll<HTMLElement>('[data-board-card]')].filter(
    (card) => !moving.has(card.dataset.boardCard ?? ''),
  );
  const index = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return index < 0 ? cards.length : index;
}

function isOverDropZone(point: Point) {
  return [...document.querySelectorAll('[data-drop-zone]')].some((zone) => {
    const rect = zone.getBoundingClientRect();
    return (
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    );
  });
}

/**
 * Kanban board of deck notes. When narrow, each column is a page of a horizontal pager;
 * wider boards show all columns side by side. Dragging a card reveals "Send to gallery"
 * and "Cancel" targets above the dock.
 */
export function NoteBoard({ notes, columns, onOpen, selected, onSelect, onSelectionDone }: Props) {
  const orderedColumns = sortBoardColumns(columns);
  const columnIds = new Set(orderedColumns.map((column) => column.id));
  const [collapsed, setCollapsed] = usePersistentState(
    `catch-deck-collapsed:${orderedColumns[0]?.userId ?? ''}`,
    z.array(z.string()),
    [],
  );
  const collapsedIds = new Set(collapsed);
  const toggleCollapsed = (id: string) =>
    setCollapsed(
      collapsedIds.has(id) ? collapsed.filter((item) => item !== id) : [...collapsed, id],
    );
  const [active, setActive] = useState<Held | null>(null);
  // The held note and the ids moving with it, for handlers that outlive a render.
  const held = useRef<{ note: Note; ids: ReadonlySet<string> } | null>(null);
  // Whether the last drag carried a stack, which drops without flying back to a card.
  const [heldStack, setHeldStack] = useState(false);
  const [landing, setLanding] = useState<Landing | null>(null);
  const landingTimer = useRef(0);
  const pointer = useRef<Point | null>(null);
  const target = useRef<DropTarget | null>(null);
  const [preview, setPreview] = useState<DropTarget | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const settlingTimer = useRef(0);
  const [page, setPage] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  // The page being shown or scrolled to; `page` lags behind while the pager scrolls.
  const pageTarget = useRef(0);
  useEffect(() => {
    const last = Math.max(0, orderedColumns.length - 1);
    if (page > last) setPage(last);
    if (pageTarget.current > last) pageTarget.current = last;
  }, [orderedColumns.length, page]);
  // Which edge the dragged card is held against, and the timer for the next page turn.
  const edge = useRef<{ side: -1 | 0 | 1; timer: number }>({ side: 0, timer: 0 });
  // Removes the pointer listeners that follow a drag.
  const unfollow = useRef<() => void>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A long press before dragging keeps touch scrolling (and the pager) working.
    useSensor(TouchSensor, {
      activationConstraint: { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_TOLERANCE },
    }),
    useSensor(KeyboardSensor),
  );

  // A deleted column can remain in a pending local note write until sync catches up.
  const columnOf = (note: Note) =>
    note.status && columnIds.has(note.status) ? note.status : DEFAULT_BOARD_STATUS;

  // Position controls the order inside each column, including pinned notes.
  const ordered = [...notes].sort(
    (a, b) =>
      comparePositions(a.position, b.position) || b.createdAt.getTime() - a.createdAt.getTime(),
  );

  const selecting = Boolean(onSelect && selected && selected.size > 0);
  const stacked = active !== null && active.group.length > 1;
  // A held stack's cards leave their columns, and dropped ones stay hidden until they
  // arrive (a synced move can take a moment to come back through `notes`).
  const hidden = new Set<string>(stacked ? active.group.map((note) => note.id) : []);
  let landed = true;
  if (landing) {
    for (const note of notes) {
      if (!landing.ids.has(note.id) || columnOf(note) === landing.column) continue;
      hidden.add(note.id);
      landed = false;
    }
  }
  useEffect(() => {
    if (landing && landed) setLanding(null);
  }, [landing, landed]);

  function setDropTarget(next: DropTarget | null) {
    if (target.current?.column === next?.column && target.current?.index === next?.index) return;
    target.current = next;
    setPreview(next);
  }

  function dropAtPoint(point: Point, moving: ReadonlySet<string>): DropTarget | null {
    const columns = pager.current?.querySelectorAll<HTMLElement>('[data-board-column]');
    if (!columns || isOverDropZone(point)) return null;
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
      if (id) return { column: id, index: dropIndex(column, point.y, moving) };
    }
    return null;
  }

  function updateDropTarget(point: Point, moving: ReadonlySet<string>) {
    setDropTarget(dropAtPoint(point, moving));
  }

  function handleDragStart(event: DragStartEvent) {
    const note = notes.find((n) => n.id === event.active.id);
    if (!note) return;
    window.clearTimeout(settlingTimer.current);
    window.clearTimeout(landingTimer.current);
    setSettlingId(null);
    setLanding(null);
    haptics.longPress();
    const cards = new Map(
      [...(pager.current?.querySelectorAll<HTMLElement>('[data-board-card]') ?? [])].map(
        (element) => [element.dataset.boardCard, element],
      ),
    );
    // dnd-kit can call onDragStart before its initial rectangle is measured.
    const rect = cards.get(note.id)?.getBoundingClientRect() ?? event.active.rect.current.initial;

    // While selecting, the held note gathers every selected note (and joins them). The
    // long press that picks a card up also selects it, so it may be the only one.
    const alongside = selecting && selected ? [...selected].filter((id) => id !== note.id) : [];
    if (alongside.length > 0 && !selected?.has(note.id)) onSelect?.(note, true);
    const ids = new Set([note.id, ...alongside]);
    const rank = new Map(orderedColumns.map((column, index) => [column.id, index]));
    const group = ordered
      .filter((other) => ids.has(other.id))
      .sort((a, b) => (rank.get(columnOf(a)) ?? 0) - (rank.get(columnOf(b)) ?? 0));
    const origins = new Map<string, Point>();
    for (const other of group) {
      const box = cards.get(other.id)?.getBoundingClientRect();
      if (other === note || !box || !rect) continue;
      origins.set(other.id, { x: box.left - rect.left, y: box.top - rect.top });
    }

    setActive({ note, group, width: rect?.width ?? 280, height: rect?.height ?? 96, origins });
    setHeldStack(group.length > 1);
    held.current = { note, ids };
    pointer.current = eventPoint(event.activatorEvent);
    setDropTarget({
      column: columnOf(note),
      index: ordered
        .filter((other) => columnOf(other) === columnOf(note))
        .filter((other) => other === note || !ids.has(other.id))
        .indexOf(note),
    });
    // Raw pointer events: dnd-kit's drag delta also counts the pager's own scrolling, so
    // after a page turn it no longer says where the finger is.
    const follow = (moveEvent: TouchEvent | MouseEvent) => {
      const point = eventPoint(moveEvent);
      if (!point) return;
      pointer.current = point;
      followPointer(point.x);
      updateDropTarget(point, ids);
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
    held.current = null;
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
    if (pointer.current || !held.current) return;
    const rect = event.active.rect.current.translated;
    if (rect)
      updateDropTarget(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        held.current.ids,
      );
  }

  // Unmounting mid-drag (say, the tab changes) must not leave listeners or a turn behind.
  useEffect(
    () => () => {
      unfollow.current?.();
      window.clearTimeout(edge.current.timer);
      window.clearTimeout(settlingTimer.current);
      window.clearTimeout(landingTimer.current);
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
          if (next < 0 || next >= orderedColumns.length) return;
          haptics.selection();
          showPage(next);
          turn(NEXT_TURN_MS);
        }, delay),
      };
    };
    turn(FIRST_TURN_MS);
  }

  function handleDragEnd(event: DragEndEvent) {
    const moving = active;
    const over = event.over?.id;
    const translated = event.active.rect.current.translated;
    const point =
      pointer.current ??
      (translated
        ? { x: translated.left + translated.width / 2, y: translated.top + translated.height / 2 }
        : null);
    const ids = held.current?.ids;
    const destination = ids && point ? dropAtPoint(point, ids) : target.current;
    endDrag(moving?.note.id);
    if (!moving || !ids || !over) return;
    const group = moving.group;
    const stack = group.length > 1;
    if (over === CANCEL_DROP_ID) {
      haptics.toggle();
      return;
    }
    if (over === GALLERY_DROP_ID) {
      haptics.success();
      if (stack) {
        land({ ids, column: null });
        sendNotesToGallery(group);
        onSelectionDone?.();
      } else {
        sendNoteToGallery(moving.note.id);
      }
      return;
    }
    const column = String(over);
    if (!columnIds.has(column) || destination?.column !== column) return;
    const current = ordered.filter((note) => columnOf(note) === column);
    const others = current.filter((note) => !ids.has(note.id));
    const next = [
      ...others.slice(0, destination.index),
      ...group,
      ...others.slice(destination.index),
    ];
    if (next.every((note, index) => note.id === current[index]?.id)) return;
    haptics.success();
    if (stack) {
      land({ ids, column });
      onSelectionDone?.();
    }
    moveDeckNotes(
      group.map((note) => note.id),
      column,
      others,
      destination.index,
    );
  }

  function land(next: Landing) {
    setLanding(next);
    // Should the move fail and roll back, the notes must not stay hidden.
    window.clearTimeout(landingTimer.current);
    landingTimer.current = window.setTimeout(() => setLanding(null), 1500);
  }

  function showPage(index: number) {
    const selected = orderedColumns[index];
    if (selected && collapsedIds.has(selected.id)) toggleCollapsed(selected.id);
    pageTarget.current = index;
    const element = pager.current;
    const column = element?.children[index] as HTMLElement | undefined;
    if (element && column) element.scrollTo({ left: column.offsetLeft - 12, behavior: 'smooth' });
  }

  function onPagerScroll() {
    const element = pager.current;
    if (!element) return;
    const children = [...element.children] as HTMLElement[];
    const next = children.reduce(
      (best, child, index) =>
        Math.abs(child.offsetLeft - element.scrollLeft - 12) <
        Math.abs((children[best]?.offsetLeft ?? 0) - element.scrollLeft - 12)
          ? index
          : best,
      0,
    );
    if (next !== page) {
      // Page turns during a drag already tick when they start.
      if (!active) haptics.selection();
      setPage(next);
    }
    // While dragging, only page turns move the pager, and they set the target themselves.
    if (!active) pageTarget.current = next;
    else if (pointer.current && held.current) updateDropTarget(pointer.current, held.current.ids);
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
      onDragCancel={() => endDrag(held.current?.note.id)}
    >
      {/* Sized by its own width, which a note open beside the page narrows. */}
      <div className="@container">
        <div
          role="tablist"
          aria-label="Columns"
          className="mx-3 mb-3 flex gap-1 overflow-x-auto rounded-2xl bg-foreground/[0.05] p-1 [scrollbar-width:none] @3xl:hidden"
        >
          {orderedColumns.map((column, index) => (
            <button
              key={column.id}
              type="button"
              role="tab"
              aria-selected={page === index}
              onClick={() => showPage(index)}
              className={cn(
                'relative shrink-0 rounded-xl px-3 py-1.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
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
              <span
                className="relative inline-flex items-center gap-1.5"
                data-column-color={column.color}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--column-accent)]" />
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
          className="flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 [scrollbar-width:none] @3xl:snap-none @3xl:px-6"
        >
          {orderedColumns.map((column) => (
            <BoardColumn
              key={column.id}
              id={column.id}
              name={column.name}
              color={column.color}
              collapsed={collapsedIds.has(column.id)}
              onToggleCollapsed={() => toggleCollapsed(column.id)}
              notes={ordered.filter((note) => columnOf(note) === column.id)}
              active={active}
              preview={preview}
              hidden={hidden}
              entering={landing?.ids}
              settlingId={settlingId}
              selected={selecting ? selected : undefined}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      {/* Cancel sits between the dock and "Send to gallery", nearest the thumb. */}
      <div className="pointer-events-none fixed right-[calc(var(--note-pane)+0.75rem)] bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.5rem)] left-3 z-50 mx-auto flex max-w-md flex-col gap-2">
        <AnimatePresence>
          {active && (
            <DropZone
              key="gallery"
              id={GALLERY_DROP_ID}
              label="Send to gallery"
              icon={LayoutGrid}
              overClassName="bg-brand/25"
            />
          )}
          {active && (
            <DropZone
              key="cancel"
              id={CANCEL_DROP_ID}
              label="Cancel move"
              icon={X}
              overClassName="bg-foreground/[0.08]"
            >
              Cancel
            </DropZone>
          )}
        </AnimatePresence>
      </div>
      {/* A stack has no one card to fly back to; its cards settle into the column instead. */}
      <DragOverlay dropAnimation={heldStack ? null : { duration: DROP_ANIMATION_MS }}>
        {active && <HeldCards held={active} />}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  id,
  name,
  color,
  collapsed,
  onToggleCollapsed,
  notes,
  active,
  preview,
  hidden,
  entering,
  settlingId,
  selected,
  onSelect,
  onOpen,
}: {
  id: string;
  name: string;
  color: BoardColumnData['color'];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  notes: Note[];
  active: Held | null;
  preview: DropTarget | null;
  /** Cards folded out of sight: a held stack's, and dropped ones still on their way. */
  hidden: ReadonlySet<string>;
  /** Cards that settle in, rather than appear, when they arrive in a column. */
  entering: ReadonlySet<string> | undefined;
  settlingId: string | null;
  /** Undefined unless notes are being selected. */
  selected: ReadonlySet<string> | undefined;
  onSelect?: (note: Note, selected: boolean) => void;
  onOpen: (note: Note, card: HTMLElement) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const shown = [...notes];
  // A single card moves within its own column; a stack leaves a slot wherever it goes.
  const activeInColumn =
    active?.group.length === 1 && notes.some((note) => note.id === active.note.id);
  if (active && activeInColumn && preview?.column === id) {
    shown.splice(
      shown.findIndex((note) => note.id === active.note.id),
      1,
    );
    shown.splice(preview.index, 0, active.note);
  }
  const placeholderAt = active && preview?.column === id && !activeInColumn ? preview.index : null;
  const placeholder = active && (
    <DropPlaceholder key="drop-placeholder" height={active.height} count={active.group.length} />
  );
  const items: ReactNode[] = [];
  let visible = 0;
  for (const note of shown) {
    const isHidden = hidden.has(note.id);
    if (!isHidden) {
      if (visible === placeholderAt) items.push(placeholder);
      visible++;
    }
    items.push(
      <DraggableNote
        key={note.id}
        note={note}
        hidden={isHidden}
        entering={Boolean(entering?.has(note.id))}
        settling={settlingId === note.id}
        selected={selected ? selected.has(note.id) : undefined}
        onSelect={onSelect}
        onOpen={onOpen}
      />,
    );
  }
  if (placeholderAt !== null && placeholderAt >= visible) items.push(placeholder);
  return (
    <section
      ref={setNodeRef}
      data-board-column={id}
      data-column-color={color}
      aria-label={`${name} column`}
      className={cn(
        // Large-container radius matches dialogs and empty states; cards inside keep
        // the card radius (rounded-2xl). The height fills the viewport down to the
        // dock so the column lands on the page's dock-space padding.
        'flex min-h-[calc(100dvh-var(--safe-top)-var(--dock-space)-11rem)] shrink-0 snap-start flex-col gap-2.5 rounded-3xl bg-foreground/[0.035] transition-[width,background-color] @3xl:min-h-[calc(100dvh-var(--safe-top)-var(--dock-space)-8rem)]',
        collapsed
          ? 'w-14 p-1.5'
          : 'w-[86%] max-w-sm p-2.5 @3xl:w-[min(28vw,22rem)] @3xl:min-w-[16rem] @3xl:flex-1 @3xl:max-w-none',
        isOver && 'bg-brand/15 ring-2 ring-brand/60',
      )}
    >
      <div aria-hidden className="mx-2 h-1 shrink-0 rounded-full bg-[var(--column-accent)]" />
      {collapsed ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Expand ${name} column`}
                onClick={onToggleCollapsed}
                className="flex min-h-48 flex-1 flex-col items-center gap-3 rounded-2xl px-1 py-3 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-xs tabular-nums">
                  {notes.length}
                </span>
                <span className="[writing-mode:vertical-rl]">{name}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <>
          <h3 className="px-2 pt-1">
            <button
              type="button"
              aria-label={`Collapse ${name} column`}
              title={`Collapse ${name}`}
              onClick={onToggleCollapsed}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate font-semibold text-sm">{name}</span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-xs tabular-nums">
                  {notes.length}
                </span>
                <span aria-hidden className="px-1.5">
                  −
                </span>
              </span>
            </button>
          </h3>
          {items}
          {visible === 0 && placeholderAt === null && (
            <p className="flex flex-1 items-center justify-center rounded-2xl border border-foreground/10 border-dashed p-6 text-center text-muted-foreground text-sm">
              Drop notes here
            </p>
          )}
        </>
      )}
    </section>
  );
}

function DropPlaceholder({ height, count }: { height: number; count: number }) {
  return (
    <div
      aria-hidden
      style={{ height }}
      className="flex items-center justify-center rounded-2xl border-2 border-brand/60 border-dashed bg-brand/10 font-medium text-brand-link text-sm"
    >
      {count > 1 && `${count} notes`}
    </div>
  );
}

const CARD_SHOWN: TargetAndTransition = {
  height: 'auto',
  opacity: 1,
  scale: 1,
  y: 0,
  marginTop: 0,
  visibility: 'visible',
  transitionEnd: { overflow: 'visible' },
};
// The negative margin takes back the column's gap, so a folded card leaves no trace, and
// once folded it leaves the tab order too.
const CARD_FOLDED: TargetAndTransition = {
  height: 0,
  opacity: 0,
  scale: 0.9,
  marginTop: -10,
  overflow: 'hidden',
  transitionEnd: { visibility: 'hidden' },
};
const CARD_ENTERING: TargetAndTransition = { opacity: 0, scale: 0.92, y: -8 };

function DraggableNote({
  note,
  hidden,
  entering,
  settling,
  selected,
  onSelect,
  onOpen,
}: {
  note: Note;
  hidden: boolean;
  entering: boolean;
  settling: boolean;
  /** Undefined unless notes are being selected. */
  selected: boolean | undefined;
  onSelect?: (note: Note, selected: boolean) => void;
  onOpen: (note: Note, card: HTMLElement) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: note.id,
  });
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      // Only keys pressed on the card itself pick it up, not Enter on its buttons.
      setActivatorNodeRef(element);
    },
    [setNodeRef, setActivatorNodeRef],
  );
  // The same press picks the card up, and that buzzes already.
  const longPress = useLongPress(onSelect && (() => onSelect(note, true)));
  const toggle =
    onSelect &&
    ((note: Note) => {
      haptics.selection();
      onSelect(note, !selected);
    });
  return (
    <motion.div
      initial={entering ? CARD_ENTERING : false}
      animate={hidden ? CARD_FOLDED : CARD_SHOWN}
      transition={springs.smooth}
    >
      <div
        ref={ref}
        data-board-card={note.id}
        {...attributes}
        {...listeners}
        {...longPress}
        // dnd-kit hides this node during the overlay's drop animation. An opacity
        // transition would fade it out and back in after release, making it flash.
        className={cn(
          'group/cell relative touch-manipulation',
          onSelect && 'select-none [-webkit-touch-callout:none]',
          isDragging && 'opacity-30',
        )}
      >
        <NoteCard
          note={note}
          onOpen={onOpen}
          forceHover={isDragging || settling}
          selected={selected}
          onSelect={toggle}
        />
        {onSelect && <SelectCheck selected={selected} onSelect={() => onSelect(note, true)} />}
      </div>
    </motion.div>
  );
}

/**
 * The card under the finger. Carrying a stack, the other cards fly in from where they
 * were and fan out behind it, with the count at its corner.
 */
function HeldCards({ held }: { held: Held }) {
  const behind = held.group.filter((note) => note.id !== held.note.id).slice(0, STACK_FLYERS);
  return (
    <div className="relative" style={{ width: held.width }}>
      {behind
        .map((note, index) => {
          const depth = Math.min(index + 1, 2);
          const origin = held.origins.get(note.id);
          return (
            <motion.div
              key={note.id}
              aria-hidden
              className="absolute inset-x-0 top-0 overflow-hidden rounded-2xl shadow-md"
              style={{ height: held.height }}
              initial={origin ? { x: origin.x, y: origin.y } : { opacity: 0, scale: 0.9 }}
              animate={{
                x: 0,
                y: depth * 6,
                rotate: depth === 1 ? 3 : -3,
                scale: 1 - depth * 0.03,
                // Cards deeper than the second collect out of sight behind it.
                opacity: index < 2 ? 1 : 0,
              }}
              transition={springs.smooth}
            >
              <NoteCard note={note} pressable={false} withActions={false} />
            </motion.div>
          );
        })
        // The first card behind the held one paints last, just under it.
        .reverse()}
      <div className="relative">
        <NoteCard note={held.note} pressable={false} forceHover />
      </div>
      {held.group.length > 1 && (
        <motion.span
          aria-label={`${held.group.length} notes`}
          className="-top-2 -right-2 absolute flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 font-semibold text-brand-foreground text-xs tabular-nums shadow-sm ring-2 ring-background"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springs.bouncy}
        >
          {held.group.length}
        </motion.span>
      )}
    </div>
  );
}

/** A target that floats above the dock while a card is held. */
function DropZone({
  id,
  label,
  icon: Icon,
  overClassName,
  children,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  overClassName: string;
  /** What the target says, when it differs from its accessible label. */
  children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  useEffect(() => {
    if (isOver) haptics.selection();
  }, [isOver]);
  return (
    <motion.section
      ref={setNodeRef}
      data-drop-zone
      aria-label={label}
      initial={{ opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: isOver ? 1.06 : 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.9 }}
      transition={springs.bouncy}
      className="glass pointer-events-auto relative z-0 flex h-[var(--dock-height)] items-center justify-center gap-2 rounded-[var(--dock-radius)] font-medium text-sm"
    >
      {/* Lit like the dock's selected tab, so the glass keeps blurring the page behind it. */}
      <AnimatePresence>
        {isOver && (
          <motion.span
            aria-hidden
            className={cn(
              '-z-10 absolute inset-1 rounded-[calc(var(--dock-radius)-0.25rem)] shadow-[inset_0_1px_0_var(--glass-highlight)]',
              overClassName,
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.snappy}
          />
        )}
      </AnimatePresence>
      <Icon className="size-5" aria-hidden />
      {children ?? label}
    </motion.section>
  );
}
