import type { HistoryState, HistoryVersion, Note } from '@catch/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { historyDockSlot } from '@/lib/dockState';
import {
  clearNoteHistory,
  prepareHistoryRestore,
  readHistoryVersion,
  restoreHistoryVersion,
} from '@/lib/noteHistory';
import { duplicateNotes } from '@/lib/notes';
import { NoteHistory } from './NoteHistory';

const note: Note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'owner',
  content: [{ content: 'Current words' }],
  color: 'default',
  status: null,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  galleryPreviewUrl: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
};
const version: HistoryVersion = {
  id: '0199a0a0-0000-7000-8000-000000000002',
  noteId: note.id,
  epoch: note.id,
  sequence: 1,
  capturedAt: new Date(0),
  receivedAt: new Date(0),
  reason: 'baseline',
  representation: 'snapshot',
  parentId: null,
  depth: 0,
  contentKey: 'a'.repeat(64),
  payloadKey: 'b'.repeat(64),
};
const state: HistoryState = { content: [{ content: 'Earlier words' }], files: [] };
vi.mock('@/lib/historyStorage', () => ({
  historyRecordsForNote: async () => [],
  subscribeHistoryStorage: () => () => {},
}));
vi.mock('@/lib/noteHistory', () => ({
  historyList: vi.fn(),
  readHistoryVersion: vi.fn(),
  resolveHistoryRestore: async () => null,
  prepareHistoryRestore: vi.fn(),
  restoreHistoryVersion: vi.fn(),
  clearNoteHistory: vi.fn(),
}));
vi.mock('@/lib/notes', () => ({ duplicateNotes: vi.fn() }));
vi.mock('@/lib/collections', () => ({ waitForWriteStored: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/vault', () => ({ openVaultHistoryNote: vi.fn() }));
vi.mock('./HistoryPreview', () => ({
  HistoryPreview: ({ content }: { content: Note['content'] }) => (
    <p>{String(content[0]?.content)}</p>
  ),
}));
vi.mock('./HistoryChanges', () => ({ HistoryChanges: () => <p>Comparison</p> }));

import { historyList } from '@/lib/noteHistory';

const summary = {
  id: note.id,
  userId: note.userId,
  kind: 'note' as const,
  epoch: note.id,
  contentToken: note.id,
  latestCaptureId: version.id,
  versionCount: 1,
  updatedAt: new Date(0),
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // The dock's row, where the reader draws its versions and actions.
  const slot = document.createElement('div');
  document.body.append(slot);
  historyDockSlot.set(slot);
});
afterEach(() => {
  historyDockSlot.get()?.remove();
  historyDockSlot.set(null);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const onClose = vi.fn();
async function open({ wide = false } = {}) {
  vi.mocked(duplicateNotes).mockReturnValue({
    ids: [],
    transaction: {} as ReturnType<typeof duplicateNotes>['transaction'],
    attachmentsTransaction: undefined,
  });
  vi.mocked(historyList).mockResolvedValue({ summary, versions: [version], nextCursor: null });
  vi.mocked(readHistoryVersion).mockResolvedValue(state);
  render(
    <TooltipProvider>
      <NoteHistory note={note} wide={wide} onClose={onClose} onRestored={vi.fn()} />
    </TooltipProvider>,
  );
  if (wide) fireEvent.click(await screen.findByRole('button', { name: /Earlier content/ }));
  else {
    fireEvent.click(screen.getByRole('button', { name: 'Choose a version' }));
    fireEvent.click(await screen.findByRole('option', { name: /Earlier content/ }));
  }
  await screen.findByText('Earlier words');
}
describe('version review', () => {
  it('keeps the current note intact and requires fresh context and explicit confirmation before restore', async () => {
    vi.mocked(prepareHistoryRestore).mockResolvedValue({ summary, note, vaultNote: null });
    await open();
    expect(note.content[0]?.content).toBe('Current words');
    expect(restoreHistoryVersion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }));
    await screen.findByRole('button', { name: 'Confirm restore' });
    expect(prepareHistoryRestore).toHaveBeenCalledWith(note.id);
    expect(restoreHistoryVersion).not.toHaveBeenCalled();
  });
  it('requires review of newer server edits', async () => {
    vi.mocked(prepareHistoryRestore).mockResolvedValue({
      summary,
      note: { ...note, content: [{ content: 'Newer server words' }] },
      vaultNote: null,
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm restore' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review current note' }));
    await waitFor(() => expect(screen.getByText('Newer server words')).toBeVisible());
    expect(confirm).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('Earlier words')).toBeVisible());
    expect(screen.queryByText('Newer server words')).toBeNull();
  });
  it('clears from the list in the dock and leaves the reader', async () => {
    vi.mocked(prepareHistoryRestore).mockResolvedValue({ summary, note, vaultNote: null });
    vi.mocked(clearNoteHistory).mockResolvedValue(undefined as never);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a version' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear history' }));
    const confirm = await screen.findByRole('region', { name: 'Confirm clear history' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(clearNoteHistory).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Clear history' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(clearNoteHistory).toHaveBeenCalledWith(note.id, { summary, note, vaultNote: null });
  });
  it('lists versions beside the reader when there is room, with clearing under them', async () => {
    await open({ wide: true });
    expect(screen.queryByRole('button', { name: 'Choose a version' })).toBeNull();
    const versions = screen.getByRole('navigation', { name: 'Saved versions' });
    expect(within(versions).getByRole('button', { name: 'Clear history' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'What changed' })).toBeVisible();
  });
  it('allows a cached copy offline and leaves original restore disabled', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await open();
    expect(screen.getByRole('button', { name: 'Restore original' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new note' }));
    await waitFor(() => expect(duplicateNotes).toHaveBeenCalledWith([note], state));
    expect(prepareHistoryRestore).not.toHaveBeenCalled();
  });
});
