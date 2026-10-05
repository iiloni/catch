import { type ColumnColor, DEFAULT_BOARD_STATUS, tagColor } from '@catch/shared';
import {
  Bell,
  Columns3,
  LayoutDashboard,
  type LucideIcon,
  Palette,
  Paperclip,
  RotateCcw,
  Tags,
} from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { type ComponentProps, type PointerEvent, useEffect, useRef, useState } from 'react';
import { AttachmentPicker } from '@/components/AttachmentPicker/AttachmentPicker';
import { ColorTagSelector } from '@/components/ColorPicker/ColorPicker';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { NoteMovePicker, noteDestinationAt } from '@/components/NoteMovePicker/NoteMovePicker';
import { ReminderPanel } from '@/components/ReminderPanel/ReminderPanel';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { useBackHandler } from '@/lib/backButton';
import { sortBoardColumns } from '@/lib/boardColumns';
import { useBoardColumns, useNoteTagAssignments, useReminders, useTags } from '@/lib/collections';
import {
  editorControls,
  editorNote,
  noteDockPanelOpen,
  noteReminderRequest,
} from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { useKeyboardOpen } from '@/lib/keyboard';
import { HOLD_MS, LONG_PRESS_TOLERANCE, swallowNextClick } from '@/lib/longPress';
import { springs } from '@/lib/motion';
import { moveNoteToDeck, restoreNote, sendNoteToGallery, setNoteColor } from '@/lib/notes';
import { useOpenNote } from '@/lib/openNote';
import { setPrimaryTag } from '@/lib/tags';
import { cn } from '@/lib/utils';

type Action = {
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** Shown as held down: the open palette, the bell of a note with a reminder. */
  active?: boolean;
  /** Drawn solid: the bell of a note that has a reminder. */
  filled?: boolean;
  expanded?: boolean;
  columnColor?: ColumnColor;
  disabled?: boolean;
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
  column: string | null | undefined;
};

/**
 * What the dock shows while a note is open: the note's actions, a palette, the reminder or
 * the Deck's columns growing the dock upward, and the formatting bar in their place while the keyboard
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
  const [panel, setPanel] = useState<
    'palette' | 'columns' | 'attachments' | 'tags' | 'reminder' | null
  >(null);
  const [paletteSession, setPaletteSession] = useState(0);
  const [hoveredColumn, setHoveredColumn] = useState<string | null | undefined>(undefined);
  const hold = useRef<Hold | null>(null);
  useBackHandler(panel !== null, () => setPanel(null));

  const editable = note !== null && !note.deletedAt;
  // The tag search and a reminder's fields also raise the keyboard; keep their panels mounted
  // while typing.
  const formatting =
    keyboardOpen && panel !== 'tags' && panel !== 'reminder' && editable && controls !== null;
  const showPanel = editable && !formatting && isPresent;
  const showPalette = panel === 'palette' && showPanel;
  const showTags = panel === 'tags' && showPanel;
  const showReminder = panel === 'reminder' && showPanel;
  const reminder = useReminders().get(note?.id ?? '');
  const tags = useTags();
  const assignment = useNoteTagAssignments().get(note?.id ?? '');
  const showColumns = panel === 'columns' && showPanel;
  const showAttachments = panel === 'attachments' && editable && isPresent;

  useEffect(() => () => window.clearTimeout(hold.current?.timer), []);
  const noteId = note?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching notes closes passing panels and cancels capture
  useEffect(() => {
    setPanel(null);
  }, [noteId]);

  // The reminder chip under the note opens the panel from outside the dock.
  const reminderRequest = noteReminderRequest.use();
  const seenRequest = useRef(reminderRequest);
  useEffect(() => {
    if (reminderRequest === seenRequest.current) return;
    seenRequest.current = reminderRequest;
    setPanel('reminder');
  }, [reminderRequest]);

  // The dock's link tray steps aside while the dock is grown (see NoteLinkTray).
  const grown = showPalette || showColumns || showAttachments || showTags || showReminder;
  useEffect(() => {
    noteDockPanelOpen.set(grown);
    return () => noteDockPanelOpen.set(false);
  }, [grown]);

  // The columns are a passing menu: a tap anywhere outside the dock folds them away.
  useEffect(() => {
    if (!grown) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [grown]);

  useEffect(() => {
    if (!grown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setPanel(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [grown]);

  function endHold() {
    window.clearTimeout(hold.current?.timer);
    hold.current = null;
    setHoveredColumn(undefined);
  }

  function openColumns() {
    const state = hold.current;
    if (!state || state.holding) return;
    window.clearTimeout(state.timer);
    state.holding = true;
    haptics.longPress();
    setPanel('columns');
  }

  function moveTo(id: string, status: string | null) {
    setPanel(null);
    if (status === note?.status) return;
    haptics.success();
    if (status === null) sendNoteToGallery(id);
    else moveNoteToDeck(id, status);
  }

  // Holding or sliding off the move button also opens the picker under the finger.
  const moveGesture: Action['gesture'] = {
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
        column: undefined,
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
      const column = noteDestinationAt(ref.current, event.clientX, event.clientY);
      if (column === state.column) return;
      state.column = column;
      if (column !== undefined) haptics.selection();
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
      const column = noteDestinationAt(ref.current, event.clientX, event.clientY);
      if (column !== undefined) moveTo(note.id, column);
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
          if (panel !== 'palette') setPaletteSession((session) => session + 1);
          setPanel(panel === 'palette' ? null : 'palette');
        },
      },
      {
        id: 'tags',
        label: 'Tags',
        icon: Tags,
        active: showTags,
        expanded: showTags,
        onPress: () => {
          haptics.toggle();
          setPanel(showTags ? null : 'tags');
        },
      },
      {
        id: 'attachments',
        label: 'Attach files',
        icon: Paperclip,
        active: showAttachments,
        expanded: showAttachments,
        onPress: () => {
          haptics.toggle();
          setPanel(panel === 'attachments' ? null : 'attachments');
        },
      },
      {
        id: 'move',
        label: 'Move note',
        icon: note.status === null ? LayoutDashboard : Columns3,
        columnColor:
          note.status === null
            ? undefined
            : ((
                columns.find((column) => column.id === note.status) ??
                columns.find((column) => column.id === DEFAULT_BOARD_STATUS)
              )?.color ?? 'amber'),
        active: showColumns,
        expanded: showColumns,
        gesture: moveGesture,
        onPress: () => {
          haptics.toggle();
          setPanel(showColumns ? null : 'columns');
        },
      },
      {
        id: 'reminder',
        label: 'Reminder',
        icon: Bell,
        active: showReminder || reminder !== undefined,
        filled: reminder !== undefined,
        expanded: showReminder,
        onPress: () => {
          haptics.toggle();
          setPanel(showReminder ? null : 'reminder');
        },
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
        {showAttachments && note && (
          <motion.div
            key="attachments"
            className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <AttachmentPicker key={note.id} noteId={note.id} onDone={() => setPanel(null)} />
          </motion.div>
        )}
        {showPalette && note && (
          <motion.div
            key="palette"
            className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <ColorTagSelector
              key={paletteSession}
              value={
                assignment?.primaryTagId ? tagColor(tags, assignment.primaryTagId) : note.color
              }
              onChange={(color) => setNoteColor(note.id, color)}
              primaryTagId={assignment?.primaryTagId}
              onTagChange={(id) => setPrimaryTag(note.id, id)}
              className="w-full pt-1 pb-1"
            />
          </motion.div>
        )}
        {showTags && note && (
          <motion.div
            key="tags"
            className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <TagPicker key={note.id} noteId={note.id} />
          </motion.div>
        )}
        {showReminder && note && (
          <motion.div
            key="reminder"
            className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <ReminderPanel
              key={note.id}
              note={note}
              color={
                assignment?.primaryTagId ? tagColor(tags, assignment.primaryTagId) : note.color
              }
              reminder={reminder}
              onDone={() => setPanel(null)}
            />
          </motion.div>
        )}
        {showColumns && note && (
          <motion.div
            key="columns"
            className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.smooth}
          >
            <NoteMovePicker
              columns={columns}
              current={note.status}
              hovered={hoveredColumn}
              onSelect={(status) => moveTo(note.id, status)}
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
                attachmentsOpen={showAttachments}
                onAttachments={() => {
                  haptics.toggle();
                  setPanel(panel === 'attachments' ? null : 'attachments');
                }}
                className="flex-1 [&_button]:size-11 [&_svg]:size-5"
              />
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              role="toolbar"
              aria-label="Note actions"
              className="absolute inset-0 grid auto-cols-fr grid-flow-col gap-1 p-1"
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
      disabled={action.disabled}
      aria-pressed={action.expanded === undefined ? action.active : undefined}
      data-filled={action.filled ? '' : undefined}
      aria-expanded={action.expanded}
      onPointerDown={(event) => event.preventDefault()}
      onClick={action.onPress}
      {...action.gesture}
      whileTap={{ scale: 0.88 }}
      transition={springs.snappy}
      className={cn(
        'relative flex items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] outline-none disabled:opacity-40 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
        action.gesture && 'touch-none select-none [-webkit-touch-callout:none]',
        action.active
          ? 'bg-foreground/[0.08] text-foreground shadow-[inset_0_1px_0_var(--glass-highlight)]'
          : 'text-foreground/80',
      )}
    >
      <span
        className="relative flex size-6 items-center justify-center"
        data-column-color={action.columnColor}
      >
        <Icon className={cn('size-6', action.filled && 'fill-current')} aria-hidden />
        {action.columnColor && (
          <span
            aria-hidden
            className="absolute -bottom-1 inset-x-0 h-0.5 rounded-full bg-[var(--column-accent)]"
          />
        )}
      </span>
    </motion.button>
  );
}
