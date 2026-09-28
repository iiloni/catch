import type { Note } from '@catch/shared';
import {
  Archive,
  ArchiveRestore,
  Copy,
  type LucideIcon,
  Palette,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type ComponentProps, useState } from 'react';
import { ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import type { HeaderSelection } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import type { useNoteSelection } from '@/lib/noteSelection';
import {
  archiveNotes,
  deleteNotesForever,
  duplicateNotes,
  restoreNotes,
  setNotesColor,
  trashNotes,
  unarchiveNotes,
} from '@/lib/notes';

type Place = 'gallery' | 'archive' | 'trash';

type Props = {
  /** The selected notes, in the order they are shown. */
  notes: Note[];
  /** The page the notes are selected on, which decides what "archive" and "delete" mean. */
  place: Place;
  /** Ends selecting, after an action that is done with the selection. */
  onDone: () => void;
};

/** What a page header shows while its notes are selected, if they are. */
export function selectionHeader(
  selection: ReturnType<typeof useNoteSelection>,
  place: Place,
): HeaderSelection | null {
  if (!selection.selecting) return null;
  return {
    count: selection.notes.length,
    onClose: selection.clear,
    actions: <SelectionToolbar notes={selection.notes} place={place} onDone={selection.clear} />,
  };
}

/** Actions for the selected notes, shown in the page header's toolbar. */
export function SelectionToolbar({ notes, place, onDone }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ids = notes.map((note) => note.id);
  const firstColor = notes[0]?.color ?? null;
  const sharedColor = notes.every((note) => note.color === firstColor) ? firstColor : null;

  const then = (action: () => unknown) => () => {
    action();
    onDone();
  };

  return (
    <div role="toolbar" aria-label="Selected notes" className="flex items-center">
      {place === 'trash' && (
        <ToolbarButton
          label="Restore"
          icon={RotateCcw}
          onClick={then(() => {
            haptics.success();
            restoreNotes(notes);
          })}
        />
      )}
      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton label="Background color" icon={Palette} onClick={haptics.toggle} />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={10} className="w-auto rounded-3xl p-3">
          {/* The selection stays, so a color can be tried and changed again. */}
          <ColorSwatches value={sharedColor} onChange={(color) => setNotesColor(ids, color)} />
        </PopoverContent>
      </Popover>
      {place === 'archive' ? (
        <ToolbarButton
          label="Unarchive"
          icon={ArchiveRestore}
          onClick={then(() => {
            haptics.success();
            unarchiveNotes(notes);
          })}
        />
      ) : (
        <ToolbarButton
          label="Archive"
          icon={Archive}
          onClick={then(() => {
            haptics.success();
            archiveNotes(notes);
          })}
        />
      )}
      {place === 'trash' ? (
        <ToolbarButton
          label="Delete forever"
          icon={TriangleAlert}
          onClick={() => {
            haptics.warning();
            setConfirmingDelete(true);
          }}
        />
      ) : (
        <ToolbarButton
          label="Move to trash"
          icon={Trash2}
          onClick={then(() => {
            haptics.warning();
            trashNotes(ids);
          })}
        />
      )}
      <ToolbarButton
        label="Make a copy"
        icon={Copy}
        onClick={then(() => {
          haptics.success();
          duplicateNotes(notes);
        })}
      />
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogTitle>
            {notes.length === 1 ? 'Delete note forever?' : `Delete ${notes.length} notes forever?`}
          </DialogTitle>
          <DialogDescription>This can't be undone.</DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => {
                setConfirmingDelete(false);
                deleteNotesForever(ids);
                onDone();
              }}
            >
              Delete forever
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ToolbarButtonProps = Omit<ComponentProps<typeof motion.button>, 'children'> & {
  label: string;
  icon: LucideIcon;
};

/** A header toolbar button. Passes its props (and ref) through, so it can be a popover trigger. */
function ToolbarButton({ label, icon: Icon, ...props }: ToolbarButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      transition={springs.snappy}
      className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
      {...props}
    >
      <Icon className="size-5" aria-hidden />
    </motion.button>
  );
}
