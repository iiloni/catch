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
import { type ComponentProps, type PointerEvent, useEffect, useRef, useState } from 'react';
import { ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import { DeckColumnPicker, deckColumnAt } from '@/components/DeckColumnPicker/DeckColumnPicker';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { useBackHandler } from '@/lib/backButton';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns } from '@/lib/collections';
import { editorControls, editorNote, noteDockPanelOpen } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { useKeyboardOpen } from '@/lib/keyboard';
import { HOLD_MS, LONG_PRESS_TOLERANCE, swallowNextClick } from '@/lib/longPress';
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
  /** Pointer handlers for a press-and-hold gesture on top of the tap. */
  gesture?: Pick<
    ComponentProps<'button'>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onContextMenu'
  >;
};

type Hold = {
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  /** The column picker is open under the finger. */
  holding: boolean;
  column: string | null;
};

/**
 * What the dock shows while a note is open: the note's actions, a palette or the Deck's
 * columns growing the dock upward, and the formatting bar in their place while the keyboard
 * is up.
 */
export function NoteDock() {
  const note = editorNote.use();
  const controls = editorControls.use();
  const keyboardOpen = useKeyboardOpen();
  const isPresent = useIsPresent();
  const { close } = useOpenNote();
  const columns = sortBoardColumns(useBoardColumns());
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<'palette' | 'columns' | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const hold = useRef<Hold | null>(null);
  useBackHandler(panel !== null, () => setPanel(null));

  const editable = note !== null && !note.deletedAt;
  const formatting = keyboardOpen && editable && controls !== null;
  const showPanel = editable && !formatting && isPresent;
  const showPalette = panel === 'palette' && showPanel;
  const showColumns = panel === 'columns' && showPanel && note?.status === null;

  useEffect(() => () => window.clearTimeout(hold.current?.timer), []);

  // The dock's link tray steps aside while the dock is grown (see NoteLinkTray).
  const grown = showPalette || showColumns;
  useEffect(() => {
    noteDockPanelOpen.set(grown);
    return () => noteDockPanelOpen.set(false);
  }, [grown]);

  // The columns are a passing menu: a tap anywhere outside the dock folds them away.
  useEffect(() => {
    if (!showColumns) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [showColumns]);

  function endHold() {
    window.clearTimeout(hold.current?.timer);
    hold.current = null;
    setHoveredColumn(null);
  }

  function openColumns() {
    const state = hold.current;
    if (!state || state.holding) return;
    window.clearTimeout(state.timer);
    state.holding = true;
    haptics.longPress();
    setPanel('columns');
  }

  function addToColumn(id: string, status: string) {
    haptics.success();
    setPanel(null);
    moveNoteToDeck(id, status);
  }

  // Holding the deck button (or sliding off it) opens the columns; the same finger then
  // slides onto one and lets go to put the note there. A tap uses the default column.
  const deckGesture: Action['gesture'] = {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      endHold();
      hold.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(openColumns, HOLD_MS),
        holding: false,
        column: null,
      };
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const state = hold.current;
      if (state?.pointerId !== event.pointerId) return;
      if (!state.holding) {
        const distance = Math.hypot(event.clientX - state.x, event.clientY - state.y);
        if (distance <= LONG_PRESS_TOLERANCE) return;
        openColumns();
      }
      const column = deckColumnAt(ref.current, event.clientX, event.clientY);
      if (column === state.column) return;
      state.column = column;
      if (column) haptics.selection();
      setHoveredColumn(column);
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      const state = hold.current;
      if (state?.pointerId !== event.pointerId) return;
      endHold();
      if (!state.holding || !note) return;
      swallowNextClick();
      // Hit-test at release too: the last move may have been dropped. Letting go anywhere
      // else leaves the columns open to tap.
      const column = deckColumnAt(ref.current, event.clientX, event.clientY) ?? state.column;
      if (column) addToColumn(note.id, column);
    },
    onPointerCancel: endHold,
    onContextMenu: (event) => event.preventDefault(),
  };

  // Actions that remove the note from view close the editor; unarchiving keeps it open.
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
        active: panel === 'palette',
        expanded: panel === 'palette',
        onPress: () => {
          haptics.toggle();
          setPanel(panel === 'palette' ? null : 'palette');
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
            active: showColumns,
            expanded: showColumns,
            gesture: deckGesture,
            onPress: () => {
              if (showColumns) {
                haptics.toggle();
                setPanel(null);
                return;
              }
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
            onPress: () => {
              setNoteArchived(note.id, false);
            },
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
      ref={ref}
      data-note-toolbar
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
              className="w-full justify-items-center px-3 pt-4 pb-1 [&_button]:size-10"
            />
          </motion.div>
        )}
        {showColumns && note && (
          <motion.div
            key="columns"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <DeckColumnPicker
              columns={columns}
              hovered={hoveredColumn}
              onSelect={(status) => addToColumn(note.id, status)}
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
      {...action.gesture}
      whileTap={{ scale: 0.88 }}
      transition={springs.snappy}
      className={cn(
        'relative flex items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
        action.gesture && 'touch-none select-none [-webkit-touch-callout:none]',
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
