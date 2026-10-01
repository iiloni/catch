// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureWebShare, getIncomingShare, saveIncomingShare } from './shareInbox';

const mocks = vi.hoisted(() => ({
  user: vi.fn((): { id: string } | null => ({ id: 'user-1' })),
  create: vi.fn(() => ({ transaction: {} })),
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
vi.mock('./notes', () => ({ createNote: mocks.create, hasNote: mocks.hasNote }));
vi.mock('./attachments', () => ({ importAttachment: mocks.attachment }));

import { receiveShare } from './receiveShare';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', {});
  vi.clearAllMocks();
  mocks.user.mockReturnValue({ id: 'user-1' });
  mocks.hasNote.mockReturnValue(false);
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
