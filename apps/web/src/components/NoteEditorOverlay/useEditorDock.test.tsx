import type { Note } from '@catch/shared';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { captureAttachmentInsertion } from '@/lib/attachmentInsertion';
import { editorControls, editorNote } from '@/lib/dockState';
import { useEditorDock } from './useEditorDock';

const alpha: Note = {
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
const beta: Note = { ...alpha, id: '0199a0a0-0000-7000-8000-000000000002' };
const alphaControls = {} as EditorControls;
const betaControls = {} as EditorControls;

function Surface({
  note,
  controls,
  present = true,
}: {
  note: Note;
  controls: EditorControls | null;
  present?: boolean;
}) {
  useEditorDock(note, controls, present);
  return null;
}

afterEach(() => {
  act(() => {
    editorNote.set(null);
    editorControls.set(null);
  });
});

describe('editor dock ownership', () => {
  it('keeps pending attachment insertion across updates to the same note', async () => {
    const view = render(<Surface note={alpha} controls={null} />);
    const insertion = captureAttachmentInsertion(alpha.id);
    const pinned = { ...alpha, isPinned: true };
    view.rerender(<Surface note={pinned} controls={null} />);
    const insert = () => {};
    const controls = { attachmentInserter: () => insert } as unknown as EditorControls;
    view.rerender(<Surface note={pinned} controls={controls} />);
    expect(await insertion).toBe(insert);
  });

  it('clears the previous controls while the next editor loads', () => {
    render(<Surface note={alpha} controls={alphaControls} />);
    const next = render(<Surface note={beta} controls={null} />);
    expect(editorNote.get()).toBe(beta);
    expect(editorControls.get()).toBeNull();

    next.rerender(<Surface note={beta} controls={betaControls} />);
    expect(editorControls.get()).toBe(betaControls);
  });

  it('keeps the new controls when the previous editor finishes closing', () => {
    const previous = render(<Surface note={alpha} controls={alphaControls} />);
    render(<Surface note={beta} controls={betaControls} />);
    previous.unmount();
    expect(editorNote.get()).toBe(beta);
    expect(editorControls.get()).toBe(betaControls);
  });

  it('ignores late controls and note updates from an exiting surface', () => {
    const previous = render(<Surface note={alpha} controls={alphaControls} present={false} />);
    render(<Surface note={beta} controls={betaControls} />);
    previous.rerender(
      <Surface note={{ ...alpha, isPinned: true }} controls={null} present={false} />,
    );
    previous.rerender(<Surface note={alpha} controls={alphaControls} present={false} />);
    expect(editorNote.get()).toBe(beta);
    expect(editorControls.get()).toBe(betaControls);
  });

  it('releases controls when closing, and republishes if the same surface reopens', () => {
    const view = render(<Surface note={alpha} controls={alphaControls} />);
    view.rerender(<Surface note={alpha} controls={alphaControls} present={false} />);
    expect(editorNote.get()).toBeNull();
    expect(editorControls.get()).toBeNull();

    view.rerender(<Surface note={alpha} controls={alphaControls} />);
    expect(editorNote.get()).toBe(alpha);
    expect(editorControls.get()).toBe(alphaControls);
    view.unmount();
    expect(editorNote.get()).toBeNull();
    expect(editorControls.get()).toBeNull();
  });
});
