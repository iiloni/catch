import type { Note } from '@catch/shared';
import {
  DndContext,
  type DragMoveEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { animate, type MotionValue, motion, motionValue } from 'motion/react';
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SwipeArchiveCard } from '@/components/SwipeArchiveCard/SwipeArchiveCard';
import { haptics } from '@/lib/haptics';
import { dropIndex, masonry, type Point } from '@/lib/masonry';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const MIN_COLUMN_WIDTH = 220;
const GAP = 12;
/** A held card rides above the page header (30) and the dock (40), below sheets (50). */
const LIFTED_Z = 45;

type Props = {
  notes: Note[];
  onOpen: (note: Note, card: HTMLElement) => void;
  onArchive?: (note: Note) => void;
  /**
   * Lets notes be rearranged by dragging (after a long press on touch). Receives the
   * other notes, in order, and the index the note was dropped at among them.
   */
  onMove?: (id: string, others: Note[], index: number) => void;
};

/** Two columns on phones (as in Keep), more as space allows. */
export function columnsFor(width: number) {
  if (width < 280) return 1;
  return Math.max(2, Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP)));
}

type Drag = {
  id: string;
  /** Where the card was when it was picked up. */
  origin: Point;
  height: number;
  /** Where it would land: an index among the other notes. */
  index: number;
};

/** A card's animated position. `target` is the slot it is at or moving to. */
type Place = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  z: MotionValue<number>;
  target?: Point;
  /** Just let go of, so it springs to its slot even if that is where it started. */
  released?: boolean;
};

/** Stops the click that ends a mouse drag, or a long press without a move, from opening the note. */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300);
}

/**
 * Masonry grid: each note goes to the top of the shortest column, so reading order runs
 * across rows (first note top-left), as in Keep. Cards are positioned absolutely from
 * their measured heights, which lets them spring out of the way while one is dragged.
 */
export function NoteGrid({ notes, onOpen, onArchive, onMove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const heights = useRef(new Map<string, number>());
  const [, remeasured] = useReducer((count: number) => count + 1, 0);
  const elements = useRef(new Map<string, HTMLElement>());
  const resizes = useRef<ResizeObserver | null>(null);
  const places = useRef(new Map<string, Place>());
  const [drag, setDrag] = useState<Drag | null>(null);
  // The order just dropped, shown until the move comes back through `notes`.
  const [dropped, setDropped] = useState<{ ids: string[]; basis: string } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A long press before dragging keeps touch scrolling (and swiping to archive) working.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const columns = columnsFor(width);
  const columnWidth = Math.max(0, (width - GAP * (columns - 1)) / columns);
  const grid = { columns, columnWidth, gap: GAP };

  const basis = notes.map((note) => note.id).join();
  if (dropped && dropped.basis !== basis) setDropped(null);
  const ordered = useMemo(() => {
    if (dropped?.basis !== basis) return notes;
    const byId = new Map(notes.map((note) => [note.id, note]));
    return dropped.ids.flatMap((id) => byId.get(id) ?? []);
  }, [notes, dropped, basis]);

  const dragged = drag ? ordered.find((note) => note.id === drag.id) : undefined;
  const others = dragged ? ordered.filter((note) => note !== dragged) : ordered;
  const shown =
    dragged && drag
      ? [...others.slice(0, drag.index), dragged, ...others.slice(drag.index)]
      : ordered;
  const measured = width > 0 && shown.every((note) => heights.current.has(note.id));
  const layout = measured
    ? masonry(
        shown.map((note) => heights.current.get(note.id) ?? 0),
        grid,
      )
    : null;

  function placeOf(id: string) {
    let place = places.current.get(id);
    if (!place) {
      place = { x: motionValue(0), y: motionValue(0), z: motionValue(0) };
      places.current.set(id, place);
    }
    return place;
  }

  const measure = useCallback(() => {
    let changed = false;
    for (const [id, element] of elements.current) {
      const height = element.offsetHeight;
      if (heights.current.get(id) !== height) {
        heights.current.set(id, height);
        changed = true;
      }
    }
    if (changed) remeasured();
  }, []);

  const register = useCallback((id: string, element: HTMLElement | null) => {
    const previous = elements.current.get(id);
    if (previous && previous !== element) resizes.current?.unobserve(previous);
    if (element) {
      elements.current.set(id, element);
      resizes.current?.observe(element);
    } else {
      elements.current.delete(id);
    }
  }, []);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const widths = new ResizeObserver(() => setWidth(element.clientWidth));
    widths.observe(element);
    // Content can change size later, such as when a note is edited elsewhere.
    resizes.current = new ResizeObserver(measure);
    for (const card of elements.current.values()) resizes.current.observe(card);
    return () => {
      widths.disconnect();
      resizes.current?.disconnect();
      resizes.current = null;
    };
  }, [measure]);

  // Measure new cards before the first paint, so they appear already in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure when the notes or width change
  useLayoutEffect(measure, [measure, basis, columnWidth]);

  // Send every card to its slot: new cards jump there, moved ones spring.
  useLayoutEffect(() => {
    if (!layout) return;
    shown.forEach((note, index) => {
      const slot = layout.slots[index];
      if (!slot || note.id === drag?.id) return;
      const place = placeOf(note.id);
      if (!place.target) {
        place.x.jump(slot.x);
        place.y.jump(slot.y);
      } else if (place.released || place.target.x !== slot.x || place.target.y !== slot.y) {
        animate(place.x, slot.x, springs.smooth);
        // A card let go of drops back under the header and dock once it lands.
        animate(place.y, slot.y, { ...springs.smooth, onComplete: () => place.z.set(0) });
      }
      place.target = slot;
      place.released = false;
    });
  });

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const index = ordered.findIndex((note) => note.id === id);
    const height = heights.current.get(id);
    if (index < 0 || height === undefined) return;
    const place = placeOf(id);
    place.x.stop();
    place.y.stop();
    place.z.set(LIFTED_Z);
    haptics.longPress();
    setDrag({ id, origin: { x: place.x.get(), y: place.y.get() }, height, index });
  }

  function handleDragMove(event: DragMoveEvent) {
    if (!drag) return;
    const place = placeOf(drag.id);
    // The delta includes page scrolling, so the card stays under the finger as it scrolls.
    const x = drag.origin.x + event.delta.x;
    const y = drag.origin.y + event.delta.y;
    place.x.set(x);
    place.y.set(y);
    const index = dropIndex({
      ...grid,
      heights: others.map((note) => heights.current.get(note.id) ?? 0),
      height: drag.height,
      center: { x: x + columnWidth / 2, y: y + drag.height / 2 },
      current: drag.index,
    });
    if (index !== drag.index) setDrag({ ...drag, index });
  }

  function handleDragEnd(commit: boolean) {
    if (!drag) return;
    setDrag(null);
    swallowNextClick();
    placeOf(drag.id).released = true;
    const from = ordered.findIndex((note) => note.id === drag.id);
    if (!commit || !dragged || drag.index === from) return;
    haptics.success();
    setDropped({ ids: shown.map((note) => note.id), basis });
    onMove?.(drag.id, others, drag.index);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={() => handleDragEnd(true)}
      onDragCancel={() => handleDragEnd(false)}
    >
      <div ref={container} className="relative" style={{ height: layout?.height }}>
        {ordered.map((note) => (
          <GridCard
            key={note.id}
            note={note}
            place={placeOf(note.id)}
            width={columnWidth}
            placed={layout !== null}
            lifted={note.id === drag?.id}
            movable={Boolean(onMove)}
            register={register}
            onOpen={onOpen}
            onArchive={onArchive}
          />
        ))}
      </div>
    </DndContext>
  );
}

function GridCard({
  note,
  place,
  width,
  placed,
  lifted,
  movable,
  register,
  onOpen,
  onArchive,
}: {
  note: Note;
  place: Place;
  width: number;
  placed: boolean;
  lifted: boolean;
  movable: boolean;
  register: (id: string, element: HTMLElement | null) => void;
  onOpen: (note: Note, card: HTMLElement) => void;
  onArchive?: (note: Note) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners } = useDraggable({
    id: note.id,
    disabled: !movable,
    attributes: { roleDescription: 'movable note' },
  });
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      // Only keys pressed on the card itself pick it up, not Enter on its buttons.
      setActivatorNodeRef(element);
      register(note.id, element);
    },
    [note.id, register, setNodeRef, setActivatorNodeRef],
  );
  // dnd-kit re-renders every draggable as the pointer moves; the card itself need not.
  const card = useMemo(
    () =>
      onArchive ? (
        <SwipeArchiveCard note={note} onOpen={onOpen} onArchive={onArchive} lifted={lifted} />
      ) : (
        <NoteCard note={note} onOpen={onOpen} pressable={!lifted} />
      ),
    [note, onOpen, onArchive, lifted],
  );

  return (
    <motion.div
      ref={ref}
      {...(movable ? { ...attributes, ...listeners, 'aria-label': 'Move note' } : {})}
      style={{
        x: place.x,
        y: place.y,
        zIndex: place.z,
        width,
        visibility: placed ? undefined : 'hidden',
      }}
      animate={{ scale: lifted ? 1.04 : 1 }}
      transition={springs.snappy}
      className={cn(
        'absolute top-0 left-0 rounded-2xl outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50',
        movable && 'touch-manipulation select-none [-webkit-touch-callout:none]',
        lifted && 'shadow-xl',
      )}
    >
      {card}
    </motion.div>
  );
}
