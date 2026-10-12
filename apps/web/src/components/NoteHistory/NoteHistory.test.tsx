import type { HistoryState, HistoryVersion, Note } from '@catch/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { historyDockSlot } from '@/lib/dockState';
import {
  clearNoteHistory,
  currentHistoryKey,
  historyReadingKey,
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
  readingKey: 'd'.repeat(64),
};
/** What the note held before `version`. */
const older: HistoryVersion = {
  ...version,
  id: '0199a0a0-0000-7000-8000-000000000003',
  sequence: 0,
  capturedAt: new Date(-86_400_000),
  receivedAt: new Date(-86_400_000),
  reason: 'recovered',
  contentKey: 'c'.repeat(64),
  readingKey: 'e'.repeat(64),
};
const state: HistoryState = { content: [{ content: 'Earlier words' }], files: [] };
vi.mock('@/lib/historyStorage', () => ({
  historyRecordsForNote: async () => [],
  subscribeHistoryStorage: () => () => {},
}));
vi.mock('@/lib/noteHistory', () => ({
  historyList: vi.fn(),
  currentHistoryKey: vi.fn(() => null),
  historyReadingKey: vi.fn(() => null),
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
vi.mock('./HistoryChanges', () => ({
  HistoryChanges: () => <p>Comparison</p>,
  useHistoryReview: (before: HistoryState | null) => ({
    review: before && { items: [], changes: 2 },
    failed: false,
  }),
}));

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
  vi.mocked(currentHistoryKey).mockReturnValue(null);
  vi.mocked(historyReadingKey).mockReturnValue(null);
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
  localStorage.clear();
  historyDockSlot.get()?.remove();
  historyDockSlot.set(null);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const onClose = vi.fn();
/** The saved versions listed beside the reader, without the current note above them. */
const listed = () =>
  within(screen.getByRole('navigation', { name: 'Saved versions' }))
    .getAllByRole('button')
    .filter((row) => row.hasAttribute('aria-pressed'))
    .slice(1);
async function open({ wide = false, changes = false, read = true, versions = [version] } = {}) {
  if (!changes) localStorage.setItem('catch-history-changes', 'false');
  vi.mocked(duplicateNotes).mockReturnValue({
    ids: [],
    transaction: {} as ReturnType<typeof duplicateNotes>['transaction'],
    attachmentsTransaction: undefined,
  });
  vi.mocked(historyList).mockResolvedValue({ summary, versions, nextCursor: null });
  // Each version reads differently, or they would be folded into one.
  if (read)
    vi.mocked(readHistoryVersion).mockImplementation(async (_note, id) =>
      id === version.id ? state : { content: [{ content: `Words of ${id}` }], files: [] },
    );
  render(
    <TooltipProvider>
      <NoteHistory note={note} wide={wide} onClose={onClose} onRestored={vi.fn()} />
    </TooltipProvider>,
  );
  // The newest version, under the current note.
  if (wide) {
    await waitFor(() => expect(listed()).not.toHaveLength(0));
    fireEvent.click(listed()[0]!);
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Choose a version' }));
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByRole('option')[1]!);
  }
  // The current note may already be showing its own comparison.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save as new note' })).toBeEnabled(),
  );
  await screen.findByText(changes ? 'Comparison' : 'Earlier words');
}
describe('version review', () => {
  it('lists the newest version once, as the current note, when it is the note', async () => {
    vi.mocked(currentHistoryKey).mockReturnValue(version.contentKey);
    vi.mocked(historyList).mockResolvedValue({ summary, versions: [version], nextCursor: null });
    render(
      <TooltipProvider>
        <NoteHistory note={note} wide onClose={onClose} onRestored={vi.fn()} />
      </TooltipProvider>,
    );
    const versions = screen.getByRole('navigation', { name: 'Saved versions' });
    expect(await within(versions).findByText(/^Saved /)).toBeVisible();
    expect(listed()).toHaveLength(0);
  });
  it('lists versions that follow each other with the same content once, at the earliest time', async () => {
    const again = { ...version, id: older.id, sequence: 0, receivedAt: new Date(-86_400_000) };
    vi.mocked(readHistoryVersion).mockResolvedValue(state);
    await open({ wide: true, read: false, versions: [version, again] });
    const versions = screen.getByRole('navigation', { name: 'Saved versions' });
    expect(listed()).toHaveLength(1);
    expect(within(versions).getByRole('button', { name: /1969/ })).toBeVisible();
    expect(screen.getByText(/1 saved version$/)).toBeVisible();
  });
  it('folds versions that read the same though their data differs', async () => {
    const rewritten = { ...older, readingKey: version.readingKey };
    vi.mocked(readHistoryVersion).mockResolvedValue(state);
    await open({
      wide: true,
      read: false,
      versions: [version, rewritten],
    });
    const versions = screen.getByRole('navigation', { name: 'Saved versions' });
    expect(listed()).toHaveLength(1);
    expect(within(versions).getByText('Recovered version')).toBeVisible();
    expect(within(versions).getByRole('button', { name: /1969/ })).toBeVisible();
    expect(readHistoryVersion).toHaveBeenCalledTimes(1);
  });
  it('does not take a version with no reading key for the note', async () => {
    await open({ wide: true, versions: [{ ...version, readingKey: null }] });
    const versions = screen.getByRole('navigation', { name: 'Saved versions' });
    expect(within(versions).getByText('When history opened')).toBeVisible();
  });
  it('lists the newest version as the current note when it reads as the note does', async () => {
    vi.mocked(historyReadingKey).mockReturnValue(version.readingKey);
    vi.mocked(historyList).mockResolvedValue({ summary, versions: [version], nextCursor: null });
    render(
      <TooltipProvider>
        <NoteHistory note={note} wide onClose={onClose} onRestored={vi.fn()} />
      </TooltipProvider>,
    );
    const versions = screen.getByRole('navigation', { name: 'Saved versions' });
    expect(await within(versions).findByText(/^Saved /)).toBeVisible();
    expect(listed()).toHaveLength(0);
  });
  it('marks what a version changed from the one before it, and nothing in the earliest', async () => {
    await open({ wide: true, changes: true, versions: [version, older] });
    expect(readHistoryVersion).toHaveBeenCalledWith(note.id, older.id);
    expect(screen.getByText(/2 changes in this\s+version/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Recovered version/ }));
    expect(await screen.findByText('This is the earliest saved version.')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('Comparison')).toBeNull());
  });
  it('does not show a version plain while its changes are still being found', async () => {
    let finish = (_state: HistoryState) => {};
    vi.mocked(readHistoryVersion).mockImplementation(async (_note, id) =>
      id === version.id ? state : new Promise<HistoryState>((resolve) => (finish = resolve)),
    );
    await open({ wide: true, changes: true, read: false, versions: [version, older] });
    await waitFor(() => expect(readHistoryVersion).toHaveBeenCalledWith(note.id, older.id));
    expect(screen.getByText('Finding what changed…')).toBeVisible();
    expect(screen.queryByText('Earlier words')).toBeNull();
    finish({ content: [{ content: 'Oldest words' }], files: [] });
    expect(await screen.findByText(/2 changes in this\s+version/)).toBeVisible();
    expect(screen.queryByText('Earlier words')).toBeNull();
  });
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
  });
  it('shows changes unless switched off, and remembers the choice on this device', async () => {
    await open({ changes: true, versions: [version, older] });
    const changes = screen.getByRole('switch', { name: 'Show changes' });
    expect(changes).toBeChecked();
    await waitFor(() => expect(screen.getByText('Comparison')).toBeVisible());
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(changes);
    expect(changes).not.toBeChecked();
    // The version fades in after the current note's comparison has left.
    await waitFor(() => expect(screen.getByText('Earlier words')).toBeVisible());
    await waitFor(() => expect(screen.queryByText('Comparison')).toBeNull());
    expect(localStorage.getItem('catch-history-changes')).toBe('false');
  });
  it('says nothing about files for a version without any', async () => {
    await open();
    expect(screen.queryByText(/File contents may no longer be available/)).toBeNull();
  });
  it('warns that a version with files may have lost them', async () => {
    vi.mocked(readHistoryVersion).mockResolvedValue({
      content: [{ content: 'Earlier words' }, { type: 'image', props: { url: '/files/1' } }],
      files: [],
    });
    await open({ read: false });
    expect(await screen.findByText(/File contents may no longer be available/)).toBeVisible();
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
