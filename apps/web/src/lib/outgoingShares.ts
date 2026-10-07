import { Capacitor, registerPlugin } from '@capacitor/core';

const OutgoingShares = registerPlugin<{
  share(options: { text: string }): Promise<void>;
}>('OutgoingShares');

export function usesSystemShare() {
  if (Capacitor.isNativePlatform()) return true;
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return mobile && typeof navigator.share === 'function';
}

/** Called directly from a tap, with content prepared before the browser's activation expires. */
export async function shareOrCopy(data: { url: string } | { text: string }) {
  const text = 'url' in data ? data.url : data.text;
  if (!usesSystemShare()) {
    await navigator.clipboard.writeText(text);
    return 'copied' as const;
  }
  if (Capacitor.isNativePlatform()) {
    await OutgoingShares.share({ text });
    return 'shared' as const;
  }
  try {
    await navigator.share(data);
    return 'shared' as const;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const;
    throw error;
  }
}
