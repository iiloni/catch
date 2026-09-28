import '@blocknote/shadcn/style.css';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { Note } from '@catch/shared';
import { useEffect, useState } from 'react';
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

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      formattingToolbar={!coarsePointer}
      className={cn('note-editor', className)}
      onChange={() => onChange?.(editor.document as unknown as Note['content'])}
    />
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
