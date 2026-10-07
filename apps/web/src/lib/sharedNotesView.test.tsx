import type { SharedNote } from '@catch/shared';
import { act, render, screen } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createSharedNotesView } from './sharedNotesView';

const copy: SharedNote = {
  noteId: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'reader',
  ownerId: 'owner',
  ownerName: 'Owner',
  token: 'a'.repeat(43),
  content: [{ type: 'paragraph', content: 'Pack the tent' }],
  color: 'default',
  attachments: [],
  isAvailable: true,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('shared note React snapshot', () => {
  it('keeps a preloaded note open on the first render of a ready gallery', () => {
    const subscribe = vi.fn();
    const view = createSharedNotesView(() => [copy], subscribe);
    const close = vi.fn();
    function Editor() {
      const { notes } = useSyncExternalStore(view.subscribe, view.getSnapshot);
      const note = notes.find((note) => note.id === copy.noteId);
      useEffect(() => {
        if (!note) close();
      }, [note]);
      return note ? <p>Read only</p> : null;
    }
    render(<Editor />);
    expect(screen.getByText('Read only')).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(view.getSnapshot()).toBe(view.getSnapshot());
  });

  it('follows incoming copies and revocation through one subscription', () => {
    let rows: SharedNote[] = [];
    let update = () => {};
    const subscribe = vi.fn((listener: () => void) => {
      update = listener;
    });
    const view = createSharedNotesView(() => rows, subscribe);
    const listener = vi.fn();
    const stop = view.subscribe(listener);
    const first = view.getSnapshot();
    rows = [copy];
    act(update);
    expect(view.getSnapshot()).not.toBe(first);
    expect(view.getSnapshot().notes[0]?.id).toBe(copy.noteId);
    rows = [];
    act(update);
    expect(view.getSnapshot().notes).toEqual([]);
    expect(view.getSnapshot().byId.has(copy.noteId)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    act(update);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('hides a trashed copy without discarding its reader state', () => {
    const view = createSharedNotesView(
      () => [{ ...copy, isAvailable: false, content: [] }],
      () => {},
    );
    expect(view.getSnapshot().notes).toEqual([]);
    expect(view.getSnapshot().byId.has(copy.noteId)).toBe(true);
  });
});
