import {
  Archive,
  ArchiveRestore,
  Columns3,
  LayoutGrid,
  type LucideIcon,
  Palette,
  Pin,
  RotateCcw,
} from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useState } from 'react';
import { ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { useBackHandler } from '@/lib/backButton';
import { editorControls, editorNote } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { useKeyboardOpen } from '@/lib/keyboard';
import { springs } from '@/lib/motion';
import {
  moveNoteToDeck,
  restoreNote,
  sendNoteToGallery,
  setNoteArchived,
  setNoteColor,
  setNotePinned,
} from '@/lib/notes';
import { useOpenNote } from '@/lib/openNote';
import { cn } from '@/lib/utils';

type Action = {
  /** Stable across label changes (Pin → Unpin), so the button is not remounted. */
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** Shown as held down: the pin of a pinned note, the open palette. */
  active?: boolean;
  expanded?: boolean;
};

/**
 * What the dock shows while a note is open: the note's actions, a palette that grows the
 * dock upward, and the formatting bar in their place while the keyboard is up.
 */
export function NoteDock() {
  const note = editorNote.use();
  const controls = editorControls.use();
  const keyboardOpen = useKeyboardOpen();
  const isPresent = useIsPresent();
  const { close } = useOpenNote();
  const [palette, setPalette] = useState(false);
  useBackHandler(palette, () => setPalette(false));

  const editable = note !== null && !note.deletedAt;
  const formatting = keyboardOpen && editable && controls !== null;
  const showPalette = palette && editable && !formatting && isPresent;

  // Actions that take the note out of this view also close the editor.
  const then = (action: () => unknown) => () => {
    action();
    close();
  };

  let actions: Action[] = [];
  if (note?.deletedAt) {
    actions = [
      {
        id: 'restore',
        label: 'Restore',
        icon: RotateCcw,
        onPress: then(() => restoreNote(note.id)),
      },
    ];
  } else if (note) {
    actions = [
      {
        id: 'color',
        label: 'Background color',
        icon: Palette,
        active: palette,
        expanded: palette,
        onPress: () => {
          haptics.toggle();
          setPalette(!palette);
        },
      },
      ...(note.isArchived
        ? []
        : [
            {
              id: 'pin',
              label: note.isPinned ? 'Unpin' : 'Pin',
              icon: Pin,
              active: note.isPinned,
              onPress: () => {
                haptics.toggle();
                setNotePinned(note.id, !note.isPinned);
              },
            },
          ]),
      note.status === null
        ? {
            id: 'deck',
            label: 'Add to deck',
            icon: Columns3,
            onPress: () => {
              haptics.selection();
              moveNoteToDeck(note.id);
            },
          }
        : {
            id: 'deck',
            label: 'Send to gallery',
            icon: LayoutGrid,
            onPress: () => {
              haptics.selection();
              sendNoteToGallery(note.id);
            },
          },
      note.isArchived
        ? {
            id: 'archive',
            label: 'Unarchive',
            icon: ArchiveRestore,
            onPress: then(() => setNoteArchived(note.id, false)),
          }
        : {
            id: 'archive',
            label: 'Archive',
            icon: Archive,
            onPress: then(() => setNoteArchived(note.id, true)),
          },
    ];
  }

  return (
    <motion.div
      // Leaving, it stops taking up room so the dock can settle back to one row.
      className={cn('flex flex-col', !isPresent && 'absolute inset-x-0 bottom-0')}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.92, filter: 'blur(6px)', transition: { duration: 0.16 } }}
      transition={springs.smooth}
    >
      <AnimatePresence initial={false}>
        {showPalette && note && (
          <motion.div
            key="palette"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <ColorSwatches
              value={note.color}
              onChange={(color) => setNoteColor(note.id, color)}
              className="mx-auto w-fit px-3 pt-4 pb-1"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative h-[var(--dock-height)]">
        <AnimatePresence initial={false} mode="popLayout">
          {formatting ? (
            <motion.div
              key="format"
              className="absolute inset-0 flex items-center px-2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={springs.snappy}
            >
              <FormattingBar
                controls={controls}
                className="flex-1 [&_button]:size-11 [&_svg]:size-5"
              />
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              role="toolbar"
              aria-label="Note actions"
              className="absolute inset-0 grid auto-cols-fr grid-flow-col p-1"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={springs.snappy}
            >
              {actions.map((action) => (
                <DockAction key={action.id} action={action} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function DockAction({ action }: { action: Action }) {
  const Icon = action.icon;
  return (
    <motion.button
      type="button"
      aria-label={action.label}
      aria-pressed={action.expanded === undefined ? action.active : undefined}
      aria-expanded={action.expanded}
      onClick={action.onPress}
      whileTap={{ scale: 0.88 }}
      transition={springs.snappy}
      className={cn(
        'relative flex items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
        action.active
          ? 'bg-foreground/[0.08] text-foreground shadow-[inset_0_1px_0_var(--glass-highlight)]'
          : 'text-foreground/80',
      )}
    >
      <Icon
        className={cn('size-6', action.active && action.icon === Pin && 'fill-current')}
        aria-hidden
      />
    </motion.button>
  );
}
