import {
  type BoardColumn,
  COLUMN_COLORS,
  type ColumnColor,
  DEFAULT_BOARD_STATUS,
} from '@catch/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
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

export function ColumnManager({ columns, open, onOpenChange }: Props) {
  const ordered = sortBoardColumns(columns);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColumnColor>('amber');
  const [deleting, setDeleting] = useState<BoardColumn | null>(null);
  const defaultName = columns.find((column) => column.id === DEFAULT_BOARD_STATUS)?.name ?? 'New';

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Edit columns">
        <div className="space-y-2 pb-3">
          {ordered.map((column, index) => (
            <div key={column.id} className="rounded-2xl bg-foreground/[0.05] p-3">
              <div className="flex items-center gap-2">
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
                <button
                  type="button"
                  aria-label={`Move ${column.name} up`}
                  disabled={index === 0}
                  onClick={() => moveBoardColumn(column, ordered, index - 1)}
                  className="rounded-lg p-2 outline-none disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${column.name} down`}
                  disabled={index === ordered.length - 1}
                  onClick={() => moveBoardColumn(column, ordered, index + 1)}
                  className="rounded-lg p-2 outline-none disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowDown className="size-4" />
                </button>
                {column.id !== DEFAULT_BOARD_STATUS && (
                  <button
                    type="button"
                    aria-label={`Delete ${column.name}`}
                    onClick={() => setDeleting(column)}
                    className="rounded-lg p-2 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              {column.id === DEFAULT_BOARD_STATUS && (
                <p className="px-2 text-muted-foreground text-xs">
                  Protected default column · new Deck notes go here
                </p>
              )}
            </div>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !ordered[0]) return;
              addBoardColumn(ordered[0].userId, name, color, ordered);
              setName('');
            }}
            className="flex items-center gap-2 rounded-2xl border border-foreground/10 border-dashed p-3"
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
