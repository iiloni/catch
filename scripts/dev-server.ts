import type { buildChannel } from './build-channel.ts';

/** Only explicit development builds may pin the native app to a worktree server. */
export function developmentServerUrl(
  channel: ReturnType<typeof buildChannel>,
  input: string | undefined,
): string {
  if (channel !== 'dev' || !input) return '';
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CATCH_DEV_SERVER_URL must be an HTTP or HTTPS URL');
  }
  return url.origin;
}
