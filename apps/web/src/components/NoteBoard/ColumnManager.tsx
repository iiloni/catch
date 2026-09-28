import {
  type BoardColumn,
  COLUMN_COLORS,
  type ColumnColor,
  DEFAULT_BOARD_STATUS,
} from '@catch/shared';
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  addBoardColumn,
  editBoardColumn,
  moveBoardColumn,
  removeBoardColumn,
  sortBoardColumns,
} from '@/lib/boardColumns';

type Props = {
  columns: BoardColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type DragLayout = {
  centerY: number;
  otherCenters: number[];
};

type DraggingColumn = {
  column: BoardColumn;
  width: number;
  height: number;
  top: number;
  left: number;
};

export function ColumnManager({ columns, open, onOpenChange }: Props) {
  const ordered = sortBoardColumns(columns);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColumnColor>('amber');
  const [deleting, setDeleting] = useState<BoardColumn | null>(null);
  const [dragging, setDragging] = useState<DraggingColumn | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const dragLayout = useRef<DragLayout | null>(null);
  const defaultName = columns.find((column) => column.id === DEFAULT_BOARD_STATUS)?.name ?? 'New';
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  function insertionIndex(deltaY: number) {
    const layout = dragLayout.current;
    if (!layout) return null;
    const center = layout.centerY + deltaY;
    return layout.otherCenters.filter((other) => (deltaY >= 0 ? other <= center : other < center))
      .length;
  }

  function onDragStart({ active }: DragStartEvent) {
    const column = ordered.find((item) => item.id === active.id);
    const cards = [...(list.current?.querySelectorAll<HTMLElement>('[data-column-card]') ?? [])];
    const node = cards.find((card) => card.dataset.columnCard === active.id);
    const rect = active.rect.current.initial ?? node?.getBoundingClientRect();
    const listRect = list.current?.getBoundingClientRect();
    if (!column || !rect || !listRect) return;
    // Keep the original centers so the moving placeholder cannot shift its own drop target.
    dragLayout.current = {
      centerY: rect.top + rect.height / 2,
      otherCenters: cards
        .filter((card) => card.dataset.columnCard !== column.id)
        .map((card) => {
          const bounds = card.getBoundingClientRect();
          return bounds.top + bounds.height / 2;
        }),
    };
    // The source leaves the list flow, but its measured position must stay put for DragOverlay.
    setDragging({
      column,
      width: rect.width,
      height: rect.height,
      top: rect.top - listRect.top,
      left: rect.left - listRect.left,
    });
    setPreviewIndex(ordered.indexOf(column));
  }

  function onDragMove({ delta }: DragMoveEvent) {
    const index = insertionIndex(delta.y);
    if (index !== null) setPreviewIndex((current) => (current === index ? current : index));
  }

  function clearDrag() {
    dragLayout.current = null;
    setDragging(null);
    setPreviewIndex(null);
  }

  function onDragEnd({ active, delta }: DragEndEvent) {
    const index = insertionIndex(delta.y);
    const column = ordered.find((item) => item.id === active.id);
    clearDrag();
    if (column && index !== null && index !== ordered.indexOf(column))
      moveBoardColumn(column, ordered, index);
  }

  const others = dragging ? ordered.filter((column) => column.id !== dragging.column.id) : ordered;

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Edit columns" dragHandleOnly>
        <div className="pb-3">
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={clearDrag}
          >
            <div ref={list} className="relative flex flex-col gap-2">
              {ordered.map((column, index) => (
                <Fragment key={column.id}>
                  {dragging && others[previewIndex ?? -1] === column && (
                    <ColumnDropPlaceholder height={dragging.height} />
                  )}
                  <ColumnCard
                    column={column}
                    index={index}
                    ordered={ordered}
                    dragPosition={dragging?.column.id === column.id ? dragging : null}
                    onDelete={() => setDeleting(column)}
                  />
                </Fragment>
              ))}
              {dragging && previewIndex === others.length && (
                <ColumnDropPlaceholder height={dragging.height} />
              )}
            </div>
            {typeof document !== 'undefined' &&
              createPortal(
                <DragOverlay zIndex={70} dropAnimation={null}>
                  {dragging && (
                    <ColumnDragPreview
                      column={dragging.column}
                      width={dragging.width}
                      height={dragging.height}
                    />
                  )}
                </DragOverlay>,
                document.body,
              )}
          </DndContext>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !ordered[0]) return;
              addBoardColumn(ordered[0].userId, name, color, ordered);
              setName('');
            }}
            className="mt-2 flex items-center gap-2 rounded-2xl border border-foreground/10 border-dashed p-3"
          >
            <ColorMenu value={color} onChange={setColor} />
            <input
              aria-label="New column name"
              placeholder="New column"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-1 py-2 outline-none"
            />
            <button
              type="submit"
              disabled={!name.trim() || ordered.length === 0}
              aria-label="Add column"
              className="rounded-full bg-brand p-2.5 text-brand-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-5" />
            </button>
          </form>
        </div>
      </BottomSheet>
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete {deleting?.name}?</DialogTitle>
          <DialogDescription>
            Any notes in this column will be moved to {defaultName}.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              className="rounded-xl px-4 py-2 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (deleting) removeBoardColumn(deleting.id);
                setDeleting(null);
              }}
              className="rounded-xl bg-destructive px-4 py-2 font-medium text-white"
            >
              Delete column
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ColumnDropPlaceholder({ height }: { height: number }) {
  return (
    <div
      data-column-drop-placeholder
      aria-hidden
      style={{ height }}
      className="rounded-2xl border-2 border-brand/60 border-dashed bg-brand/10"
    />
  );
}

function ColumnDragPreview({
  column,
  width,
  height,
}: {
  column: BoardColumn;
  width: number;
  height: number;
}) {
  return (
    <div
      aria-hidden
      data-column-drag-preview
      style={{ width, height }}
      className="pointer-events-none flex items-center gap-2 rounded-2xl border border-brand/40 bg-background p-3 shadow-xl"
    >
      <GripVertical className="size-5 shrink-0 text-muted-foreground" />
      <span
        data-column-color={column.color}
        className="flex size-9 shrink-0 items-center justify-center"
      >
        <span className="size-5 rounded-full bg-[var(--column-accent)]" />
      </span>
      <span className="min-w-0 flex-1 truncate px-1 font-medium">{column.name}</span>
      {column.id === DEFAULT_BOARD_STATUS ? (
        <span className="shrink-0 rounded-full bg-foreground/[0.08] px-2.5 py-1 font-semibold text-[0.6875rem] text-muted-foreground">
          Default
        </span>
      ) : (
        <Trash2 className="mx-2 size-4 shrink-0 text-destructive" />
      )}
    </div>
  );
}

function ColumnCard({
  column,
  index,
  ordered,
  dragPosition,
  onDelete,
}: {
  column: BoardColumn;
  index: number;
  ordered: BoardColumn[];
  dragPosition: DraggingColumn | null;
  onDelete: () => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      data-column-card={column.id}
      className={`rounded-2xl bg-foreground/[0.05] p-3 ${dragPosition ? 'pointer-events-none absolute opacity-0' : ''}`}
      style={
        dragPosition
          ? {
              top: dragPosition.top,
              left: dragPosition.left,
              width: dragPosition.width,
              height: dragPosition.height,
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Reorder ${column.name} column`}
          title="Drag to reorder · arrow keys also work"
          {...listeners}
          onKeyDown={(event) => {
            const next = index + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
            if (next === index || next < 0 || next >= ordered.length) return;
            event.preventDefault();
            moveBoardColumn(column, ordered, next);
          }}
          className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical className="size-5" aria-hidden />
        </button>
        <ColorMenu
          value={column.color}
          onChange={(next) => editBoardColumn(column.id, { color: next })}
        />
        <input
          key={`${column.id}:${column.name}`}
          aria-label={`Name of ${column.name} column`}
          defaultValue={column.name}
          maxLength={40}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            if (next && next !== column.name) editBoardColumn(column.id, { name: next });
            else event.currentTarget.value = column.name;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 py-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {column.id === DEFAULT_BOARD_STATUS ? (
          <span className="shrink-0 rounded-full bg-foreground/[0.08] px-2.5 py-1 font-semibold text-[0.6875rem] text-muted-foreground">
            Default
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Delete ${column.name}`}
            onClick={onDelete}
            className="rounded-lg p-2 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ColorMenu({
  value,
  onChange,
}: {
  value: ColumnColor;
  onChange: (color: ColumnColor) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Column color"
          title="Column color"
          data-column-color={value}
          className="flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="size-5 rounded-full bg-[var(--column-accent)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-2xl p-3">
        <div className="flex gap-2">
          {COLUMN_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={value === color}
              title={color}
              data-column-color={color}
              onClick={() => onChange(color)}
              className="flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="size-6 rounded-full bg-[var(--column-accent)]" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
