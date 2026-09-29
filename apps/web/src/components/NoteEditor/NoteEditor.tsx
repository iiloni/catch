import '@blocknote/shadcn/style.css';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions';
import { en } from '@blocknote/core/locales';
import {
  BlockColorsItem,
  DragHandleButton,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  useExtension,
  useExtensionState,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { Note } from '@catch/shared';
import { type MouseEvent, useEffect, useState } from 'react';
import { keyboardHeight } from '@/lib/keyboard';
import { useResolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { EditorControls, FormattingState, TextStyle } from './editorControls';

/** New notes start with an empty heading that acts as the title. */
const EMPTY_NOTE: PartialBlock[] = [{ type: 'heading', props: { level: 3 }, content: [] }];

type Props = {
  initialContent?: Note['content'];
  onChange?: (content: Note['content']) => void;
  editable?: boolean;
  autoFocus?: boolean;
  /** Receives a handle for formatting from outside the editor while it is mounted. */
  onControls?: (controls: EditorControls | null) => void;
  className?: string;
};

// Touch screens get the formatting bar above the keyboard instead of BlockNote's
// selection toolbar, which on Android animates in from the top of the screen.
const coarsePointer =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * BlockNote editor for a note. Content is read once on mount; remount with a
 * `key` to load a different note.
 */
export function NoteEditor({
  initialContent,
  onChange,
  editable = true,
  autoFocus = false,
  onControls,
  className,
}: Props) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    // Stored content is BlockNote JSON validated as plain records by the schema.
    initialContent: initialContent?.length ? (initialContent as PartialBlock[]) : EMPTY_NOTE,
    trailingBlock: false,
    dictionary: {
      ...en,
      placeholders: { ...en.placeholders, heading: 'Title', default: 'Take a note…' },
    },
  });

  useEffect(() => {
    if (autoFocus) editor.focus();
  }, [autoFocus, editor]);

  const [controls] = useState(() => createControls(editor));
  useEffect(() => {
    onControls?.(controls);
    return () => onControls?.(null);
  }, [controls, onControls]);

  useCaretAboveKeyboard(editor);

  function focusAboveBlankSpace(event: MouseEvent<HTMLDivElement>) {
    if (!editable || !(event.target instanceof Element)) return;
    // A tap inside a block belongs to BlockNote, which places the caret at the tapped text.
    if (event.target.closest('[data-node-type="blockContainer"]')) return;

    const blocks = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[data-node-type="blockContainer"][data-id]',
      ),
    );
    const above = blocks.findLast((block) => block.getBoundingClientRect().top <= event.clientY);
    const id = (above ?? blocks[0])?.dataset.id;
    const block = id ? editor.getBlock(id) : editor.document.at(-1);
    if (!block) return;
    editor.setTextCursorPosition(block, 'end');
    editor.focus();
  }

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      formattingToolbar={!coarsePointer}
      sideMenu={false}
      className={cn('note-editor min-h-full', className)}
      onClick={focusAboveBlankSpace}
      onChange={() => onChange?.(editor.document as unknown as Note['content'])}
    >
      <SideMenuController sideMenu={NoteSideMenu} />
    </BlockNoteView>
  );
}

function NoteSideMenu() {
  const dict = useDictionary();

  return (
    <SideMenu>
      <DragHandleButton>
        <AddBlockMenuItem />
        <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
        <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
        <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
        <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
      </DragHandleButton>
    </SideMenu>
  );
}

function AddBlockMenuItem() {
  const Components = useComponentsContext();
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const suggestionMenu = useExtension(SuggestionMenu);
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  if (!Components || !block) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        const isEmpty = Array.isArray(block.content) && block.content.length === 0;
        const target = isEmpty
          ? block
          : editor.insertBlocks([{ type: 'paragraph' }], block, 'after')[0];
        if (!target) return;
        editor.setTextCursorPosition(target);
        // Closing the drag menu restores focus; open suggestions after that finishes.
        requestAnimationFrame(() => suggestionMenu.openSuggestionMenu('/'));
      }}
    >
      {dict.side_menu.add_block_label}
    </Components.Generic.Menu.Item>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: the default schema's generics are not needed here
type AnyEditor = BlockNoteEditor<any, any, any>;

function createControls(editor: AnyEditor): EditorControls {
  const listeners = new Set<() => void>();
  let state = readState(editor);

  function refresh() {
    const next = readState(editor);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function selectedBlocks() {
    return editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (listeners.size === 0) refresh();
      listeners.add(listener);
      const offChange = editor.onChange(refresh);
      const offSelection = editor.onSelectionChange(refresh);
      return () => {
        listeners.delete(listener);
        offChange?.();
        offSelection?.();
      };
    },
    toggleStyle(style) {
      editor.toggleStyles({ [style]: true });
      // Toggling with an empty selection only changes the stored marks, which fires no event.
      refresh();
    },
    toggleBlock(kind) {
      const blocks = selectedBlocks();
      const off = blocks.every((block) => block.type === kind);
      editor.transact(() => {
        for (const block of blocks) {
          editor.updateBlock(block, {
            type: off ? 'paragraph' : kind,
            props: kind === 'heading' && !off ? { level: 3 } : {},
          });
        }
      });
      refresh();
    },
    indent() {
      if (editor.canNestBlock()) editor.nestBlock();
      refresh();
    },
    outdent() {
      if (editor.canUnnestBlock()) editor.unnestBlock();
      refresh();
    },
    focusEnd() {
      const last = editor.document.at(-1);
      if (last) editor.setTextCursorPosition(last, 'end');
      editor.focus();
    },
  };
}

function readState(editor: AnyEditor): FormattingState {
  const active: Partial<Record<TextStyle, unknown>> = editor.getActiveStyles();
  return {
    styles: {
      bold: Boolean(active.bold),
      italic: Boolean(active.italic),
      underline: Boolean(active.underline),
      strike: Boolean(active.strike),
    },
    block: editor.getTextCursorPosition().block.type,
    canIndent: editor.canNestBlock(),
    canOutdent: editor.canUnnestBlock(),
  };
}

/**
 * The page is not resized for the keyboard (see lib/keyboard.ts), so the browser does not
 * scroll the caret clear of it. Keep it in view while the keyboard rises.
 */
function useCaretAboveKeyboard(editor: AnyEditor) {
  useEffect(() => {
    let frame = 0;
    let previous = keyboardHeight.get();
    const off = keyboardHeight.on('change', (height) => {
      const rising = height > previous;
      previous = height;
      if (!rising || frame || !editor.isFocused()) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const node = window.getSelection()?.focusNode;
        const element = node instanceof Element ? node : node?.parentElement;
        element?.scrollIntoView({ block: 'nearest' });
      });
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [editor]);
}
