import type { Attachment } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorControls, FormattingState } from '@/components/NoteEditor/editorControls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { editorControls, editorNote } from '@/lib/dockState';
import { makeNote } from '@/test/links';
import { NoteMedia } from './NoteMedia';

vi.mock('@/lib/attachments', () => ({
  useNoteAttachments: () => [file],
  downloadAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  renameAttachment: vi.fn(),
}));
vi.mock('@/lib/attachmentFiles', () => ({
  useAttachmentUrl: () => ({ source: 'blob:preview', error: false }),
  keepAttachmentOffline: vi.fn(),
}));
const note = makeNote();
const file: Attachment = {
  id: '0199a0a0-0000-7000-8000-000000000002',
  noteId: note.id,
  userId: note.userId,
  name: 'photo.png',
  mimeType: 'image/png',
  size: 123,
  kind: 'image',
  status: 'ready',
  sourceId: null,
  createdAt: new Date(),
  deletedAt: null,
};
const state: FormattingState = {
  attachmentIds: [],
  styles: { bold: false, italic: false, underline: false, strike: false },
  block: 'paragraph',
  canIndent: false,
  canOutdent: false,
  canUndo: false,
  canRedo: false,
};
const insert = vi.fn();
const controls: EditorControls = {
  getState: () => state,
  getContent: () => [],
  attachmentInserter: () => insert,
  showAttachment: vi.fn(() => false),
  removeAttachment: vi.fn(),
  subscribe: () => () => {},
  toggleStyle: vi.fn(),
  toggleBlock: vi.fn(),
  insertSlash: vi.fn(),
  indent: vi.fn(),
  outdent: vi.fn(),
  focusEnd: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
};

afterEach(() => {
  act(() => {
    editorControls.set(null);
    editorNote.set(null);
  });
  vi.clearAllMocks();
});

async function menu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Manage photo.png' }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.findByRole('menuitem', { name: 'Add to note' });
}

describe('NoteMedia inline actions', () => {
  it('adds to the matching editor and hands control back to the note', async () => {
    act(() => {
      editorNote.set(note);
      editorControls.set(controls);
    });
    const returnToNote = vi.fn();
    render(<NoteMedia noteId={note.id} onShowInNote={returnToNote} />, {
      wrapper: TooltipProvider,
    });
    fireEvent.click(await menu());
    expect(insert).toHaveBeenCalledWith([file]);
    expect(returnToNote).toHaveBeenCalledOnce();
  });

  it('cannot place an attachment in a different open note', async () => {
    act(() => {
      editorNote.set({ ...note, id: 'another-note' });
      editorControls.set(controls);
    });
    render(<NoteMedia noteId={note.id} />, { wrapper: TooltipProvider });
    const add = await menu();
    expect(add).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(add);
    expect(insert).not.toHaveBeenCalled();
    expect(controls.showAttachment).not.toHaveBeenCalled();
  });
});
