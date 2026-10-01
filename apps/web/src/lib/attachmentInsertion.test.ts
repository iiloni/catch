import type { Note } from '@catch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { captureAttachmentInsertion } from './attachmentInsertion';
import { editorControls, editorNote } from './dockState';

const note: Note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'user-1',
  content: [],
  color: 'default',
  status: null,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function controls() {
  const insert = vi.fn();
  const attachmentInserter = vi.fn(() => insert);
  return {
    handle: { attachmentInserter } as unknown as EditorControls,
    attachmentInserter,
    insert,
  };
}

afterEach(() => {
  editorNote.set(null);
  editorControls.set(null);
});

describe('attachment insertion while the editor loads', () => {
  it('captures the cursor immediately when the editor is ready', async () => {
    const editor = controls();
    editorNote.set(note);
    editorControls.set(editor.handle);
    const insertion = captureAttachmentInsertion(note.id);
    expect(editor.attachmentInserter).toHaveBeenCalledOnce();
    expect(await insertion).toBe(editor.insert);
  });

  it('captures the original note when its delayed editor mounts', async () => {
    const editor = controls();
    editorNote.set(note);
    const insertion = captureAttachmentInsertion(note.id);
    editorNote.set({ ...note, isPinned: true });
    editorControls.set(editor.handle);
    expect(await insertion).toBe(editor.insert);
    expect(editor.attachmentInserter).toHaveBeenCalledOnce();
  });

  it('cancels when the note closes, even if the same note reopens', async () => {
    const editor = controls();
    editorNote.set(note);
    const insertion = captureAttachmentInsertion(note.id);
    editorNote.set(null);
    editorNote.set(note);
    editorControls.set(editor.handle);
    expect(await insertion).toBeNull();
    expect(editor.attachmentInserter).not.toHaveBeenCalled();
  });

  it('never captures another note’s editor', async () => {
    const editor = controls();
    editorNote.set(note);
    const insertion = captureAttachmentInsertion(note.id);
    editorNote.set({ ...note, id: '0199a0a0-0000-7000-8000-000000000002' });
    editorControls.set(editor.handle);
    expect(await insertion).toBeNull();
    expect(await captureAttachmentInsertion(note.id)).toBeNull();
    expect(editor.attachmentInserter).not.toHaveBeenCalled();
  });
});
