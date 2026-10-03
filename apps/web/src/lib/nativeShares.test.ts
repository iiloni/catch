// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIncomingShare, saveIncomingShare } from './shareInbox';

const native = vi.hoisted(() => ({
  platform: vi.fn(() => 'android'),
  getPending: vi.fn(),
  acknowledge: vi.fn(async () => {}),
  listen: vi.fn(),
  remove: vi.fn(async () => {}),
  fetch: vi.fn(async () => new Response(new Blob(['data']))),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: native.platform, convertFileSrc: (path: string) => `native:${path}` },
  registerPlugin: () => ({
    getPending: native.getPending,
    acknowledge: native.acknowledge,
    addListener: native.listen,
  }),
}));

import { watchNativeShares } from './nativeShares';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', native.fetch);
  native.platform.mockReturnValue('android');
  native.listen.mockResolvedValue({ remove: native.remove });
});

describe('native share handoff', () => {
  it('copies captions and files into the durable web inbox before acknowledging native storage', async () => {
    const id = uuidv7();
    native.getPending.mockResolvedValue({
      shares: [
        {
          id,
          title: 'Photo',
          text: 'Caption',
          files: [{ path: '/private/photo', name: 'photo.png', mimeType: 'image/png' }],
        },
      ],
    });
    native.acknowledge.mockImplementationOnce(async () => {
      expect(await getIncomingShare(id)).toMatchObject({ text: 'Caption', complete: false });
    });
    const open = vi.fn(async () => {});
    const fail = vi.fn();
    const stop = watchNativeShares(open, fail);
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(id));
    expect(native.acknowledge).toHaveBeenCalledWith({ id });
    const blob = (await getIncomingShare(id))?.files[0]?.blob;
    expect(blob?.type).toBe('image/png');
    expect(await blob?.text()).toBe('data');
    expect(fail).not.toHaveBeenCalled();
    stop();
    expect(native.remove).toHaveBeenCalled();
  });

  it('keeps native staging when the file cannot be read', async () => {
    native.getPending.mockResolvedValue({
      shares: [
        {
          id: uuidv7(),
          title: '',
          text: '',
          files: [{ path: '/private/file', name: 'file.txt', mimeType: 'text/plain' }],
        },
      ],
    });
    native.fetch.mockRejectedValueOnce(new Error('Read failed'));
    const open = vi.fn(async () => {});
    const fail = vi.fn();
    const stop = watchNativeShares(open, fail);
    await vi.waitFor(() => expect(fail).toHaveBeenCalled());
    expect(native.acknowledge).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    stop();
  });

  it.each([false, true])(
    'acknowledges a repeated native receipt without reopening a completed share (dismissed: %s)',
    async (dismissed) => {
      const id = uuidv7();
      await saveIncomingShare({
        id,
        title: '',
        text: '',
        url: '',
        files: [],
        userId: 'user-1',
        complete: true,
        dismissed,
      });
      native.getPending.mockResolvedValue({
        shares: [{ id, title: 'Original', text: 'Old text', files: [] }],
      });
      const open = vi.fn(async () => {});
      const stop = watchNativeShares(open, vi.fn());
      await vi.waitFor(() => expect(native.acknowledge).toHaveBeenCalled());
      expect(open).not.toHaveBeenCalled();
      expect((await getIncomingShare(id))?.text).toBe('');
      stop();
    },
  );

  it('does not load the native plugin in a browser or on iOS', () => {
    native.platform.mockReturnValue('web');
    watchNativeShares(vi.fn(), vi.fn())();
    expect(native.listen).not.toHaveBeenCalled();
  });
});
