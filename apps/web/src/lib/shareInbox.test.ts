// @vitest-environment node
import { MAX_ATTACHMENT_BYTES } from '@catch/shared';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureWebShare,
  clearIncomingShares,
  getIncomingShare,
  pendingIncomingShares,
  saveIncomingShare,
  validateSharedFiles,
} from './shareInbox';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

describe('incoming share inbox', () => {
  it('clears only the signed-out account’s staging and receipts', async () => {
    const form = new FormData();
    form.set('text', 'Private');
    const own = await captureWebShare(form);
    const other = await captureWebShare(form);
    const unbound = await captureWebShare(form);
    const ownShare = await getIncomingShare(own);
    const otherShare = await getIncomingShare(other);
    if (!ownShare || !otherShare) throw new Error('Missing share');
    await saveIncomingShare({ ...ownShare, userId: 'user-1' });
    await saveIncomingShare({ ...otherShare, userId: 'user-2' });
    await clearIncomingShares('user-1');
    expect(await getIncomingShare(own)).toBeNull();
    expect(await getIncomingShare(other)).not.toBeNull();
    expect(await getIncomingShare(unbound)).not.toBeNull();
  });
  it('keeps text and multiple files through a new database connection before login', async () => {
    const form = new FormData();
    form.set('title', 'Trip');
    form.set('text', 'Packing list');
    form.set('url', 'https://example.com');
    form.append('files', new File(['photo'], 'photo.png', { type: 'image/png' }));
    form.append('files', new File(['tickets'], 'tickets.pdf', { type: 'application/pdf' }));
    const id = await captureWebShare(form);
    const share = await getIncomingShare(id);
    expect(share).toMatchObject({
      title: 'Trip',
      text: 'Packing list',
      url: 'https://example.com',
      userId: null,
      complete: false,
    });
    expect(share?.files.map((file) => file.name)).toEqual(['photo.png', 'tickets.pdf']);
    expect(await share?.files[1]?.blob.text()).toBe('tickets');
    expect(await pendingIncomingShares()).toHaveLength(1);
  });

  it('keeps intentional repeated shares separate, with stable ids on reread', async () => {
    const form = new FormData();
    form.set('text', 'Again');
    const first = await captureWebShare(form);
    const second = await captureWebShare(form);
    expect(first).not.toBe(second);
    expect((await getIncomingShare(first))?.id).toBe(first);
  });

  it('rejects empty payloads without storing them', async () => {
    const form = new FormData();
    form.set('text', '  ');
    form.append('files', new File([], ''));
    await expect(captureWebShare(form)).rejects.toThrow('did not send any content');
    expect(await pendingIncomingShares()).toEqual([]);
  });

  it('rejects empty, oversized, and too many files', () => {
    expect(() => validateSharedFiles([{ name: 'empty', blob: new Blob([]) }])).toThrow('empty');
    const oversized = new Blob(['a']);
    Object.defineProperty(oversized, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });
    expect(() => validateSharedFiles([{ name: 'large', blob: oversized }])).toThrow('100 MB');
    expect(() =>
      validateSharedFiles(
        Array.from({ length: 21 }, () => ({ name: 'file', blob: new Blob(['a']) })),
      ),
    ).toThrow('20 files');
  });

  it('retains an account-bound receipt while releasing consumed content', async () => {
    const form = new FormData();
    form.set('text', 'Private');
    const id = await captureWebShare(form);
    const share = await getIncomingShare(id);
    if (!share) throw new Error('Missing share');
    await saveIncomingShare({
      ...share,
      userId: 'user-1',
      complete: true,
      files: [],
      title: '',
      text: '',
      url: '',
    });
    expect(await pendingIncomingShares()).toEqual([]);
    expect(await getIncomingShare(id)).toMatchObject({ userId: 'user-1', complete: true });
  });
});
