// @vitest-environment node

import { blocksToPlainText } from '@catch/shared';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureWebShare,
  getIncomingShare,
  pendingIncomingShares,
  saveIncomingShare,
} from './shareInbox';

const mocks = vi.hoisted(() => ({
  user: vi.fn((): { id: string } | null => ({ id: 'user-1' })),
  create: vi.fn((_input: { id?: string; userId: string; content: Record<string, unknown>[] }) => ({
    transaction: {},
  })),
  update: vi.fn(() => ({})),
  hasNote: vi.fn(() => false),
  attachment: vi.fn(async () => ({ id: 'attachment-write', persisted: Promise.resolve() })),
  load: vi.fn(async () => {}),
  noteStored: vi.fn(async () => {}),
  fileStored: vi.fn(async () => {}),
}));
vi.mock('./auth', () => ({ getSignedInUser: mocks.user }));
vi.mock('./collections', () => ({
  loadShareCollections: mocks.load,
  waitForWriteStored: mocks.noteStored,
  waitForQueuedWrite: mocks.fileStored,
}));
vi.mock('./notes', () => ({
  createNote: mocks.create,
  hasNote: mocks.hasNote,
  updateNote: mocks.update,
}));
vi.mock('./attachments', () => ({ importAttachment: mocks.attachment }));

import { dismissLinkShare, prepareShare, receiveShare, saveLinkShare } from './receiveShare';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', {});
  vi.clearAllMocks();
  mocks.user.mockReturnValue({ id: 'user-1' });
  mocks.hasNote.mockReturnValue(false);
});

async function captureLink() {
  const form = new FormData();
  form.set('title', 'Shared page');
  form.set('text', 'https://example.com/page#section');
  return captureWebShare(form);
}

const editedDraft = {
  url: 'https://example.com/page#section',
  title: 'My title',
  description: 'Page details',
  notes: 'Read later',
};

describe('link share preparation', () => {
  it('binds the account and prepares a draft without writing a note', async () => {
    const id = await captureLink();
    expect(await prepareShare(id)).toEqual({
      kind: 'link',
      id,
      draft: { ...editedDraft, title: 'Shared page', description: '', notes: '' },
    });
    expect(await getIncomingShare(id)).toMatchObject({ userId: 'user-1', complete: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('uses the same stable id on retry, waits for storage and preserves edits on replay', async () => {
    const id = await captureLink();
    mocks.noteStored.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(saveLinkShare(id, editedDraft)).rejects.toThrow('Storage unavailable');
    expect((await getIncomingShare(id))?.complete).toBe(false);
    mocks.hasNote.mockReturnValue(true);
    await saveLinkShare(id, editedDraft);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ id, userId: 'user-1' }));
    expect(blocksToPlainText(mocks.create.mock.calls[0]?.[0]?.content ?? [])).toContain('My title');
    expect(mocks.update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ content: expect.any(Array) }),
    );
    expect(await prepareShare(id)).toEqual({ kind: 'note', id });
    await saveLinkShare(id, { ...editedDraft, title: 'Do not overwrite' });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('records cancellation without creating a note or reopening on reload', async () => {
    const id = await captureLink();
    await dismissLinkShare(id);
    expect(await prepareShare(id)).toEqual({ kind: 'dismissed' });
    expect(await pendingIncomingShares()).toEqual([]);
    expect(await getIncomingShare(id)).toMatchObject({
      userId: 'user-1',
      complete: true,
      dismissed: true,
      text: '',
    });
    await expect(saveLinkShare(id, editedDraft)).rejects.toThrow('cancelled');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('prevents another account from preparing, saving or dismissing a claimed share', async () => {
    const id = await captureLink();
    await prepareShare(id);
    mocks.user.mockReturnValue({ id: 'user-2' });
    await expect(prepareShare(id)).rejects.toThrow('another account');
    await expect(saveLinkShare(id, editedDraft)).rejects.toThrow('another account');
    await expect(dismissLinkShare(id)).rejects.toThrow('another account');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps file shares and plain text on their existing path', async () => {
    const id = await capture(true);
    expect(await prepareShare(id)).toEqual({ kind: 'note', id });
    expect(mocks.attachment).toHaveBeenCalledOnce();
  });
});

async function capture(files = false) {
  const form = new FormData();
  form.set('text', 'Shared content');
  if (files) form.append('files', new File(['data'], 'file.txt', { type: 'text/plain' }));
  return captureWebShare(form);
}

describe('share consumption', () => {
  it('shares one processing promise and never rewrites a consumed note', async () => {
    const id = await capture(true);
    const first = receiveShare(id);
    expect(receiveShare(id)).toBe(first);
    await first;
    await receiveShare(id);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.attachment).toHaveBeenCalledTimes(1);
    expect(mocks.noteStored).toHaveBeenCalledTimes(1);
    expect(mocks.fileStored).toHaveBeenCalledTimes(1);
    expect(await getIncomingShare(id)).toMatchObject({
      complete: true,
      userId: 'user-1',
      files: [],
    });
  });
  it('retains the files if staging fails, then resumes without recreating the note', async () => {
    const id = await capture(true);
    mocks.attachment.mockRejectedValueOnce(new Error('Storage full'));
    await expect(receiveShare(id)).rejects.toThrow('Storage full');
    expect((await getIncomingShare(id))?.files).toHaveLength(1);
    mocks.hasNote.mockReturnValue(true);
    await receiveShare(id);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((await getIncomingShare(id))?.complete).toBe(true);
  });
  it('does not claim completion before the note is durable', async () => {
    const id = await capture();
    mocks.noteStored.mockRejectedValueOnce(new Error('Could not save'));
    await expect(receiveShare(id)).rejects.toThrow('Could not save');
    expect((await getIncomingShare(id))?.complete).toBe(false);
  });
  it('refuses signed-out consumption and cross-account replay', async () => {
    const id = await capture();
    mocks.user.mockReturnValue(null);
    await expect(receiveShare(id)).rejects.toThrow('Sign in');
    mocks.user.mockReturnValue({ id: 'user-2' });
    const share = await getIncomingShare(id);
    if (!share) throw new Error('Missing share');
    await saveIncomingShare({ ...share, userId: 'user-1' });
    await expect(receiveShare(id)).rejects.toThrow('another account');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
