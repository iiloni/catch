import { blocksToPlainText, type Note } from '@catch/shared';
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
import { memo, useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SelectCheck } from '@/components/SelectCheck/SelectCheck';
import { SwipeArchiveCard } from '@/components/SwipeArchiveCard/SwipeArchiveCard';
import { haptics } from '@/lib/haptics';
import {
  LONG_PRESS_MS,
  LONG_PRESS_TOLERANCE,
  swallowNextClick,
  useLongPress,
} from '@/lib/longPress';
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
  /**
   * The selected notes' ids. With `onSelect`, a long press selects a note and, while any
   * note is selected, a tap selects or deselects one instead of opening it.
   */
  selected?: ReadonlySet<string>;
  onSelect?: (note: Note, selected: boolean) => void;
};

/** Two columns on phones (as in Keep), more as space allows. */
export function columnsFor(width: number) {
  if (width < 280) return 1;
  return Math.max(2, Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP)));
}

// A card's parts (see NoteCard and NotePreview), for guessing heights.
const CARD_PADDING_X = 28;
const CARD_PADDING_Y = 26;
const CARD_MIN_HEIGHT = 48;
/** The card's actions, which take no room on touch screens. */
const TOOLBAR_HEIGHT = 36;
/** `text-sm leading-snug`, and a rough average glyph width at that size. */
const LINE_HEIGHT = 19.25;
const CHAR_WIDTH = 7;
const BLOCK_GAP = 4;
const PREVIEW_BLOCKS = 10;

const hasToolbar = () =>
  typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches;

/**
 * A guess at a card's height from its content, for a card that has not been rendered.
 * It only has to be close: cards are measured before they scroll into view.
 */
export function estimateCardHeight(content: Note['content'], width: number, toolbar: boolean) {
  const perLine = Math.max(1, (width - CARD_PADDING_X) / CHAR_WIDTH);
  const lines = blocksToPlainText(content).split('\n').slice(0, PREVIEW_BLOCKS);
  let height = CARD_PADDING_Y;
  for (const line of lines) {
    if (line) height += Math.ceil(line.length / perLine) * LINE_HEIGHT + BLOCK_GAP;
  }
  for (const block of content.slice(0, PREVIEW_BLOCKS)) {
    if (block.type === 'image') height += width * 0.75;
  }
  return Math.max(CARD_MIN_HEIGHT, height) + (toolbar ? TOOLBAR_HEIGHT : 0);
}

type Size = { width: number; height: number };

/**
 * Card heights by note id, and the column width each was measured at. Shared by every
 * grid and kept across pages, so a page comes back laid out as it was left.
 */
const measured = new Map<string, Size>();
const estimates = new WeakMap<Note['content'], Size>();

const isMeasured = (note: Note, width: number) => measured.get(note.id)?.width === width;

function heightOf(note: Note, width: number) {
  const measurement = measured.get(note.id);
  if (measurement?.width === width) return measurement.height;
  if (measurement) {
    // Measured at another width, as after a resize: its text reflows, its padding does not.
    const fixed = CARD_PADDING_Y + (hasToolbar() ? TOOLBAR_HEIGHT : 0);
    const text = Math.max(0, measurement.height - fixed);
    return fixed + (text * (measurement.width - CARD_PADDING_X)) / (width - CARD_PADDING_X);
  }
  let estimate = estimates.get(note.content);
  if (estimate?.width !== width) {
    estimate = { width, height: estimateCardHeight(note.content, width, hasToolbar()) };
    estimates.set(note.content, estimate);
  }
  return estimate.height;
}

/**
 * The page's viewport in the grid's coordinates, rounded to half a screen so scrolling
 * only re-renders the grid now and then.
 */
type View = { top: number; screen: number };

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

/**
 * Masonry grid: each note goes to the top of the shortest column, so reading order runs
 * across rows (first note top-left), as in Keep. Cards are positioned absolutely from
 * their measured heights, which lets them spring out of the way while one is dragged.
 *
 * Only cards within a screen of the viewport are rendered, so thousands of notes stay
 * cheap. The rest are laid out from their last measured height, or a guess from their
 * content, and measured as they come near.
 */
export function NoteGrid({ notes, onOpen, onArchive, onMove, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View | null>(null);
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
    useSensor(TouchSensor, {
      activationConstraint: { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_TOLERANCE },
    }),
    useSensor(KeyboardSensor),
  );

  const selecting = Boolean(onSelect && selected && selected.size > 0);

  const columns = columnsFor(width);
  const columnWidth = Math.max(0, (width - GAP * (columns - 1)) / columns);
  const grid = { columns, columnWidth, gap: GAP };
  const measuredWidth = useRef(columnWidth);

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
  const heights = shown.map((note) => heightOf(note, columnWidth));
  const layout = width > 0 ? masonry(heights, grid) : null;

  const rendered = new Set<string>();
  if (layout && view) {
    const from = view.top - view.screen;
    const to = view.top + view.screen / 2 + 2 * view.screen;
    shown.forEach((note, index) => {
      const slot = layout.slots[index];
      if (slot && slot.y <= to && slot.y + (heights[index] ?? 0) >= from) rendered.add(note.id);
    });
  }
  if (drag) rendered.add(drag.id);
  // Cards rendered for the first time (at this width) are measured before anything moves,
  // so nothing springs from a guessed height to its real one.
  const pending = shown.some((note) => rendered.has(note.id) && !isMeasured(note, columnWidth));

  function placeOf(id: string) {
    let place = places.current.get(id);
    if (!place) {
      place = { x: motionValue(0), y: motionValue(0), z: motionValue(0) };
      places.current.set(id, place);
    }
    return place;
  }

  const measure = useCallback(() => {
    const width = measuredWidth.current;
    if (width === 0) return;
    let changed = false;
    for (const [id, element] of elements.current) {
      const height = element.offsetHeight;
      const previous = measured.get(id);
      if (previous?.width !== width || previous.height !== height) {
        measured.set(id, { width, height });
        changed = true;
      }
    }
    if (changed) remeasured();
  }, []);

  const updateView = useCallback(() => {
    const element = container.current;
    if (!element) return;
    const screen = window.innerHeight;
    const step = screen / 2;
    const top = Math.floor(-element.getBoundingClientRect().top / step) * step;
    setView((view) => (view?.top === top && view.screen === screen ? view : { top, screen }));
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
    // Captured, so it also hears a scrolling element around the page.
    window.addEventListener('scroll', updateView, { capture: true, passive: true });
    window.addEventListener('resize', updateView);
    const stopListening = () => {
      window.removeEventListener('scroll', updateView, { capture: true });
      window.removeEventListener('resize', updateView);
    };
    if (typeof ResizeObserver === 'undefined') return stopListening;
    const widths = new ResizeObserver(() => setWidth(element.clientWidth));
    widths.observe(element);
    // Content can change size later, such as when a note is edited elsewhere.
    resizes.current = new ResizeObserver(measure);
    for (const card of elements.current.values()) resizes.current.observe(card);
    return () => {
      stopListening();
      widths.disconnect();
      resizes.current?.disconnect();
      resizes.current = null;
    };
  }, [measure, updateView]);

  useLayoutEffect(() => {
    measuredWidth.current = columnWidth;
  });

  // Measure new cards before the first paint, so they appear already in place.
  useLayoutEffect(measure);

  // The grid also moves without scrolling, such as when the pinned notes above it change.
  useLayoutEffect(updateView);

  // Send every card to its slot: new cards jump there, moved ones spring. Only cards that
  // are or will be on screen spring; the rest are just outside it and jump.
  useLayoutEffect(() => {
    for (const id of places.current.keys()) {
      if (!rendered.has(id)) places.current.delete(id);
    }
    if (!layout || pending) return;
    let visible: { top: number; bottom: number } | undefined;
    const onScreen = (y: number, height: number) => {
      if (!visible) {
        // A margin, so cards scrolled into view while the grid settles are already moving.
        const margin = window.innerHeight / 2;
        const top = -(container.current?.getBoundingClientRect().top ?? 0) - margin;
        visible = { top, bottom: top + window.innerHeight + 2 * margin };
      }
      return y + height >= visible.top && y <= visible.bottom;
    };
    shown.forEach((note, index) => {
      const slot = layout.slots[index];
      if (!slot || note.id === drag?.id || !rendered.has(note.id)) return;
      const place = placeOf(note.id);
      if (!place.target) {
        place.x.jump(slot.x);
        place.y.jump(slot.y);
      } else if (place.released || place.target.x !== slot.x || place.target.y !== slot.y) {
        const height = heights[index] ?? 0;
        if (onScreen(place.y.get(), height) || onScreen(slot.y, height)) {
          animate(place.x, slot.x, springs.smooth);
          // A card let go of drops back under the header and dock once it lands.
          animate(place.y, slot.y, { ...springs.smooth, onComplete: () => place.z.set(0) });
        } else {
          place.x.jump(slot.x);
          place.y.jump(slot.y);
          place.z.set(0);
        }
      }
      place.target = slot;
      place.released = false;
    });
  });

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const index = ordered.findIndex((note) => note.id === id);
    const note = ordered[index];
    if (!note) return;
    const height = heightOf(note, columnWidth);
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
      heights: others.map((note) => heightOf(note, columnWidth)),
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
        {ordered.map(
          (note) =>
            rendered.has(note.id) && (
              <GridCard
                key={note.id}
                note={note}
                place={placeOf(note.id)}
                width={columnWidth}
                placed={isMeasured(note, columnWidth)}
                lifted={note.id === drag?.id}
                movable={Boolean(onMove)}
                selected={selecting ? Boolean(selected?.has(note.id)) : undefined}
                onSelect={onSelect}
                register={register}
                onOpen={onOpen}
                onArchive={onArchive}
              />
            ),
        )}
      </div>
    </DndContext>
  );
}

// Memoized, so scrolling renders only the cards it brings in.
const GridCard = memo(function GridCard({
  note,
  place,
  width,
  placed,
  lifted,
  movable,
  selected,
  onSelect,
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
  /** Undefined unless notes are being selected. */
  selected: boolean | undefined;
  onSelect?: (note: Note, selected: boolean) => void;
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
  const longPress = useLongPress(
    onSelect &&
      (() => {
        // On a movable card the same press picks it up, and that buzzes already.
        if (!movable) haptics.longPress();
        onSelect(note, true);
      }),
  );
  // dnd-kit re-renders every draggable as the pointer moves; the card itself need not.
  const card = useMemo(() => {
    const toggle =
      onSelect &&
      ((note: Note) => {
        haptics.selection();
        onSelect(note, !selected);
      });
    return onArchive ? (
      <SwipeArchiveCard
        note={note}
        onOpen={onOpen}
        onArchive={onArchive}
        lifted={lifted}
        selected={selected}
        onSelect={toggle}
      />
    ) : (
      <NoteCard
        note={note}
        onOpen={onOpen}
        pressable={!lifted}
        selected={selected}
        onSelect={toggle}
      />
    );
  }, [note, onOpen, onArchive, lifted, selected, onSelect]);

  return (
    <motion.div
      ref={ref}
      data-note-cell={note.id}
      {...(movable ? { ...attributes, ...listeners, 'aria-label': 'Move note' } : {})}
      {...longPress}
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
        'group/cell absolute top-0 left-0 rounded-2xl outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50',
        (movable || onSelect) && 'touch-manipulation select-none [-webkit-touch-callout:none]',
        lifted && 'shadow-xl',
      )}
    >
      {card}
      {onSelect && <SelectCheck selected={selected} onSelect={() => onSelect(note, true)} />}
    </motion.div>
  );
});
