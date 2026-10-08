import '@blocknote/shadcn/style.css';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { HistoryExtension, SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions';
import { en } from '@blocknote/core/locales';
import {
  BlockColorsItem,
  DragHandleButton,
  type FloatingUIOptions,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  useExtension,
  useExtensionState,
} from '@blocknote/react';
import { BlockNoteView, useShadCNComponentsContext } from '@blocknote/shadcn';
import { attachmentId, attachmentUrl, type Note } from '@catch/shared';
import { type Middleware, offset, shift, size } from '@floating-ui/react';
import { GripVertical } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { SearchSelectDialog, type SelectOption } from '@/components/SearchSelect/SearchSelect';
import { resolveAttachmentUrl } from '@/lib/attachmentFiles';
import { addAttachment, fileBlock, useRemovedAttachmentIds } from '@/lib/attachments';
import { CODE_LANGUAGES, codeLanguageId } from '@/lib/codeLanguages';
import { keyboardHeight } from '@/lib/keyboard';
import { useResolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { noteEditorSchema } from './checkListItem';
import { syntaxHighlighting } from './codeBlock';
import type { EditorControls, FormattingState, TextStyle } from './editorControls';
import { useListItemDrag } from './useListItemDrag';

/** New notes start with an empty heading that acts as the title. */
const EMPTY_NOTE: PartialBlock[] = [{ type: 'heading', props: { level: 3 }, content: [] }];

// The Android keyboard overlays the page, so Floating UI's viewport must end above it.
function menuViewport() {
  const styles = getComputedStyle(document.documentElement);
  const inset = (side: string) =>
    Number.parseFloat(styles.getPropertyValue(`--safe-area-inset-${side}`)) || 0;
  const top = inset('top');
  const left = inset('left');
  return {
    x: left,
    y: top,
    width: Math.max(0, window.innerWidth - left - inset('right')),
    height: Math.max(0, window.innerHeight - top - Math.max(keyboardHeight.get(), inset('bottom'))),
  };
}

// Size middleware scrolls a tall menu, so choosing a side by the menu's measured
// height would keep it on whichever side was measured first.
const chooseMenuSide: Middleware = {
  name: 'chooseMenuSide',
  fn({ elements, placement }) {
    const caret = elements.reference.getBoundingClientRect();
    const viewport = menuViewport();
    const above = caret.top - viewport.y;
    const below = viewport.y + viewport.height - caret.bottom;
    const preferred = above > below ? 'top-start' : 'bottom-start';
    return placement === preferred ? {} : { reset: { placement: preferred } };
  },
};

const slashMenuFloatingOptions: FloatingUIOptions = {
  useFloatingOptions: {
    placement: 'bottom-start',
    middleware: [
      chooseMenuSide,
      offset(10),
      shift(() => ({ rootBoundary: menuViewport(), padding: 10 })),
      size(() => ({
        rootBoundary: menuViewport(),
        padding: 10,
        apply({ elements, availableHeight }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      })),
    ],
    whileElementsMounted: (_reference, _floating, update) => keyboardHeight.on('change', update),
  },
};

const sideMenuFloatingOptions: FloatingUIOptions = {
  useFloatingOptions: {
    middleware: [
      offset(({ elements, rects }) => {
        const reference =
          elements.reference instanceof Element
            ? elements.reference
            : elements.reference.contextElement;
        const inline = reference?.querySelector('.bn-inline-content');
        if (!inline) return 0;
        const bounds = inline.getBoundingClientRect();
        const group = reference?.closest('.bn-editor > .bn-block-group');
        const lineHeight = Number.parseFloat(getComputedStyle(inline).lineHeight) || bounds.height;
        // Wrapped text and touch-sized lists need their first line, not the whole block's center.
        return {
          // Nested blocks share the editor's gutter so their handles clear every indent guide.
          mainAxis: group
            ? Math.max(
                0,
                elements.reference.getBoundingClientRect().left -
                  group.getBoundingClientRect().left,
              )
            : 0,
          crossAxis:
            bounds.top +
            Math.min(lineHeight, bounds.height) / 2 -
            elements.reference.getBoundingClientRect().top -
            rects.floating.height / 2,
        };
      }),
    ],
  },
};

type Props = {
  noteId?: string;
  ensureNote?: () => string | null;
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
  noteId,
  ensureNote,
  initialContent,
  onChange,
  editable = true,
  autoFocus = false,
  onControls,
  className,
}: Props) {
  const theme = useResolvedTheme();
  const noteOwner = useRef({ noteId, ensureNote });
  noteOwner.current = { noteId, ensureNote };
  const editor = useCreateBlockNote({
    schema: noteEditorSchema,
    extensions: [syntaxHighlighting],
    // Stored content is BlockNote JSON validated as plain records by the schema.
    initialContent: initialContent?.length ? (initialContent as PartialBlock[]) : EMPTY_NOTE,
    trailingBlock: false,
    uploadFile: async (file) => {
      const id = noteOwner.current.noteId ?? noteOwner.current.ensureNote?.();
      if (!id) throw new Error('Open a note to attach a file');
      return attachmentUrl((await addAttachment(id, file)).id);
    },
    resolveFileUrl: resolveAttachmentUrl,
    dictionary: {
      ...en,
      placeholders: { ...en.placeholders, heading: 'Title', default: 'Take a note…' },
    },
  });

  useEffect(() => {
    if (autoFocus) editor.focus();
  }, [autoFocus, editor]);

  const [controls] = useState(() => createControls(editor));
  const removedAttachments = useRemovedAttachmentIds(noteId);
  useEffect(() => {
    for (const id of removedAttachments) controls.removeAttachment(id);
  }, [removedAttachments, controls]);
  useEffect(() => {
    onControls?.(controls);
    return () => onControls?.(null);
  }, [controls, onControls]);

  useCaretAboveKeyboard(editor);
  const editorRef = useListItemDrag(editor, editable);
  // The code block whose language is being chosen.
  const [languageBlock, setLanguageBlock] = useState<string | null>(null);

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (!editable || !(event.target instanceof Element)) return;
    // A code block draws its language button itself, outside React (see codeBlock.ts).
    const language = event.target.closest('.note-code-language > button');
    if (language && editor.domElement?.contains(language)) {
      const id = language.closest<HTMLElement>('[data-node-type="blockContainer"]')?.dataset.id;
      if (id) setLanguageBlock(id);
      return;
    }
    focusAboveBlankSpace(event);
  }

  function focusAboveBlankSpace(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    // Floating controls share BlockNoteView's click handler, including through portals.
    // Only clicks on the writing surface should move the caret.
    if (event.target !== event.currentTarget && !editor.domElement?.contains(event.target)) {
      return;
    }
    // The checkbox's padding belongs to the same touch target as the native input.
    const checkbox = event.target.matches('[data-content-type="checkListItem"] > div')
      ? event.target.querySelector<HTMLInputElement>('input[type="checkbox"]')
      : null;
    if (checkbox) {
      checkbox.click();
      return;
    }
    // Empty checklist text has only a caret's width. Taps on its placeholder or the
    // surrounding row must select that item rather than leave the caret in another block.
    const checklist = event.target.closest('[data-content-type="checkListItem"]');
    if (
      checklist?.querySelector('.bn-inline-content')?.textContent === '' &&
      !event.target.closest('button, input, [contenteditable="false"]')
    ) {
      const id = checklist.closest<HTMLElement>('[data-node-type="blockContainer"]')?.dataset.id;
      const block = id ? editor.getBlock(id) : undefined;
      if (block) {
        editor.setTextCursorPosition(block, 'start');
        editor.focus();
      }
      return;
    }
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
      ref={editorRef}
      editor={editor}
      editable={editable}
      theme={theme}
      formattingToolbar={!coarsePointer}
      sideMenu={false}
      slashMenu={false}
      className={cn('note-editor', className)}
      onClick={onClick}
      onChange={() => onChange?.(editor.document as unknown as Note['content'])}
    >
      <NoteSideMenuController />
      <SuggestionMenuController
        triggerCharacter="/"
        shouldOpen={(state) => !state.selection.$from.parent.type.isInGroup('tableContent')}
        portalElement={typeof document === 'undefined' ? undefined : document.body}
        floatingUIOptions={slashMenuFloatingOptions}
      />
      {languageBlock && (
        <CodeLanguagePicker
          editor={editor}
          blockId={languageBlock}
          onDone={() => setLanguageBlock(null)}
        />
      )}
    </BlockNoteView>
  );
}

const CODE_LANGUAGE_OPTIONS: SelectOption[] = Object.entries(CODE_LANGUAGES).map(
  ([value, language]) => ({
    value,
    label: language.name,
    keywords: [value, ...('aliases' in language ? language.aliases : [])],
  }),
);

function CodeLanguagePicker({
  editor,
  blockId,
  onDone,
}: {
  editor: AnyEditor;
  blockId: string;
  onDone: () => void;
}) {
  const block = editor.getBlock(blockId);
  const language = block?.type === 'codeBlock' ? String(block.props.language ?? '') : '';
  const id = codeLanguageId(language);
  // A language outside the list (pasted, imported) stays a choice, so opening the list
  // does not show the block as something it is not.
  const options = useMemo(
    () =>
      id || !language
        ? CODE_LANGUAGE_OPTIONS
        : [...CODE_LANGUAGE_OPTIONS, { value: language, label: language }],
    [id, language],
  );
  const chosen = useRef(false);
  return (
    <SearchSelectDialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      // Back to the code, as the list took focus from it. Its button was drawn again for
      // the new language, so the dialog has nothing to return focus to.
      onCloseAutoFocus={(event) => {
        if (!chosen.current) return;
        event.preventDefault();
        if (editor.getBlock(blockId)) editor.setTextCursorPosition(blockId, 'end');
        editor.focus();
      }}
      title="Code language"
      searchLabel="Search languages"
      emptyText="No language matches."
      options={options}
      value={id ?? language}
      onChange={(value) => {
        if (!editor.isEditable || !editor.getBlock(blockId)) return;
        chosen.current = true;
        editor.updateBlock(blockId, { props: { language: value } });
      }}
    />
  );
}

function NoteSideMenuController() {
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block });
  return (
    <SideMenuController
      sideMenu={NoteSideMenu}
      floatingUIOptions={Array.isArray(block?.content) ? sideMenuFloatingOptions : undefined}
    />
  );
}

function NoteSideMenu() {
  const dict = useDictionary();

  return (
    <SideMenu>
      <NoteDragHandle>
        <AddBlockMenuItem />
        <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
        <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
        <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
        <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
      </NoteDragHandle>
    </SideMenu>
  );
}

function NoteDragHandle({ children }: { children: ReactNode }) {
  const Components = useComponentsContext();
  const ShadCN = useShadCNComponentsContext();
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const sideMenu = useExtension(SideMenuExtension);
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block });
  const [open, setOpen] = useState(false);

  function setMenuOpen(value: boolean) {
    setOpen(value);
    if (value) sideMenu.freezeMenu();
    else sideMenu.unfreezeMenu();
  }

  if (!Components || !ShadCN || !block) return null;
  if (!['checkListItem', 'bulletListItem', 'numberedListItem'].includes(block.type)) {
    return <DragHandleButton>{children}</DragHandleButton>;
  }
  const Menu = ShadCN.DropdownMenu;
  return (
    <Menu.DropdownMenu modal={false} open={open} onOpenChange={setMenuOpen}>
      <Menu.DropdownMenuTrigger
        render={
          <Components.SideMenu.Button
            label={dict.side_menu.drag_handle_label}
            className="bn-button"
            draggable
            icon={<GripVertical size={24} data-test="dragHandle" />}
            onClick={() => setMenuOpen(!open)}
            onDragStart={(event) => sideMenu.blockDragStart(event, block)}
            onDragEnd={sideMenu.blockDragEnd}
          />
        }
      />
      <Menu.DropdownMenuContent
        container={editor.domElement?.closest<HTMLElement>('.bn-root')}
        className="bn-menu-dropdown bn-drag-handle-menu"
      >
        {children}
      </Menu.DropdownMenuContent>
    </Menu.DropdownMenu>
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
    getContent: () => editor.document as unknown as Note['content'],
    attachmentInserter() {
      const anchor = editor.getTextCursorPosition().block.id;
      return (files) => {
        if (!editor.domElement?.isConnected) return;
        let target = editor.getBlock(anchor) ?? editor.document.at(-1);
        if (!target) return;
        editor.transact(() => {
          for (const file of files) {
            if (!target) break;
            const block = fileBlock(file);
            const empty =
              Array.isArray(target.content) &&
              target.content.length === 0 &&
              target.children.length === 0;
            target = empty
              ? editor.updateBlock(target, block)
              : editor.insertBlocks([block], target, 'after')[0];
          }
        });
        if (target) {
          const next = editor.insertBlocks([{ type: 'paragraph' }], target, 'after')[0];
          if (next) editor.setTextCursorPosition(next);
        }
      };
    },
    removeAttachment(id) {
      const matching: string[] = [];
      editor.forEachBlock((block) => {
        if ('url' in block.props && block.props.url === attachmentUrl(id)) matching.push(block.id);
        return true;
      });
      if (matching.length) editor.removeBlocks(matching);
    },
    showAttachment(id) {
      let found = false;
      editor.forEachBlock((block) => {
        if ('url' in block.props && block.props.url === attachmentUrl(id)) {
          editor.domElement
            ?.querySelector(`[data-id="${block.id}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          found = true;
          return false;
        }
        return true;
      });
      return found;
    },
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
    insertSlash() {
      editor
        .getExtension(SuggestionMenu)
        ?.openSuggestionMenu('/', { deleteTriggerCharacter: true });
    },
    indent() {
      if (editor.canNestBlock()) editor.nestBlock();
      refresh();
    },
    outdent() {
      if (editor.canUnnestBlock()) editor.unnestBlock();
      refresh();
    },
    undo() {
      // Only hold on to focus: taking it would raise a keyboard the user had put away.
      const focused = editor.isFocused();
      editor.undo();
      if (focused) editor.focus();
      refresh();
    },
    redo() {
      // Only hold on to focus: taking it would raise a keyboard the user had put away.
      const focused = editor.isFocused();
      editor.redo();
      if (focused) editor.focus();
      refresh();
    },
    focus() {
      editor.focus();
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
  const history = editor.getExtension(HistoryExtension);
  const attachmentIds: string[] = [];
  editor.forEachBlock((block) => {
    const id =
      'url' in block.props && typeof block.props.url === 'string'
        ? attachmentId(block.props.url)
        : null;
    if (id) attachmentIds.push(id);
    return true;
  });
  return {
    attachmentIds,
    styles: {
      bold: Boolean(active.bold),
      italic: Boolean(active.italic),
      underline: Boolean(active.underline),
      strike: Boolean(active.strike),
    },
    block: editor.getTextCursorPosition().block.type,
    canIndent: editor.canNestBlock(),
    canOutdent: editor.canUnnestBlock(),
    canUndo: history ? editor.canExec(history.undoCommand) : false,
    canRedo: history ? editor.canExec(history.redoCommand) : false,
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

    function keepCaretVisible() {
      frame = 0;
      const height = keyboardHeight.get();
      const view = editor.prosemirrorView;
      if (height <= 0 || !view || !editor.isFocused()) return;

      let area = view.dom.parentElement;
      while (area && !/(auto|scroll)/.test(getComputedStyle(area).overflowY)) {
        area = area.parentElement;
      }
      if (!area) return;

      const bounds = area.getBoundingClientRect();
      const caret = view.coordsAtPos(view.state.selection.head);
      const header = area.closest('[role="dialog"]')?.querySelector('[data-note-header]');
      const top = Math.max(0, bounds.top, header?.getBoundingClientRect().bottom ?? 0) + 12;
      let bottom = Math.min(bounds.bottom, window.innerHeight - height) - 12;
      // The dock sits outside the scroll area and rises with the keyboard.
      for (const toolbar of document.querySelectorAll('[data-note-toolbar]')) {
        const rect = toolbar.getBoundingClientRect();
        if (
          rect.right > bounds.left &&
          rect.left < bounds.right &&
          rect.bottom > top &&
          rect.height > 0
        ) {
          bottom = Math.min(bottom, rect.top - 12);
        }
      }
      if (bottom <= top) return;
      if (caret.bottom > bottom) area.scrollTop += caret.bottom - bottom;
      else if (caret.top < top) area.scrollTop -= top - caret.top;
    }

    function schedule() {
      if (!frame && keyboardHeight.get() > 0) frame = requestAnimationFrame(keepCaretVisible);
    }

    const off = keyboardHeight.on('change', (height) => {
      const rising = height > previous;
      previous = height;
      if (rising) schedule();
    });
    const offSelection = editor.onSelectionChange(schedule);
    const offChange = editor.onChange(schedule);
    const root = editor.domElement;
    root?.addEventListener('focusin', schedule);
    schedule();
    return () => {
      off();
      offSelection();
      offChange();
      root?.removeEventListener('focusin', schedule);
      cancelAnimationFrame(frame);
    };
  }, [editor]);
}
