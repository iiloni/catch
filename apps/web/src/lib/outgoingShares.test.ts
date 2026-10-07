import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareOrCopy, usesSystemShare } from './outgoingShares';

const mocks = vi.hoisted(() => ({ native: false, share: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: () => ({ share: mocks.share }),
}));
const browserShare = vi.fn();
const writeText = vi.fn();

beforeEach(() => {
  mocks.native = false;
  vi.clearAllMocks();
  browserShare.mockResolvedValue(undefined);
  writeText.mockResolvedValue(undefined);
  mocks.share.mockResolvedValue(undefined);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Desktop Chrome');
  Object.defineProperty(navigator, 'share', { configurable: true, value: browserShare });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => vi.restoreAllMocks());

describe('outgoing shares', () => {
  it('copies on desktop even when Web Share is available', async () => {
    expect(usesSystemShare()).toBe(false);
    expect(await shareOrCopy({ text: '# Trip' })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('# Trip');
    expect(browserShare).not.toHaveBeenCalled();
  });

  it('opens the mobile browser share sheet directly for a link and Markdown', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Chrome');
    const link = { url: 'https://catch.example/s/token' };
    const promise = shareOrCopy(link);
    expect(browserShare).toHaveBeenCalledWith(link);
    expect(await promise).toBe('shared');
    await shareOrCopy({ text: '# Trip' });
    expect(browserShare).toHaveBeenLastCalledWith({ text: '# Trip' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('uses the Android bridge for both kinds of share without Web Share', async () => {
    mocks.native = true;
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    await shareOrCopy({ url: 'https://catch.example/s/token' });
    expect(mocks.share).toHaveBeenLastCalledWith({ text: 'https://catch.example/s/token' });
    await shareOrCopy({ text: '# Trip' });
    expect(mocks.share).toHaveBeenLastCalledWith({ text: '# Trip' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying when a mobile browser has no share support', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    expect(await shareOrCopy({ text: '# Trip' })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('# Trip');
  });

  it('treats dismissing the share sheet quietly and reports real errors', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    browserShare.mockRejectedValue(new DOMException('Dismissed', 'AbortError'));
    expect(await shareOrCopy({ text: '# Trip' })).toBe('cancelled');
    browserShare.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    await expect(shareOrCopy({ text: '# Trip' })).rejects.toThrow('Denied');
  });
});
