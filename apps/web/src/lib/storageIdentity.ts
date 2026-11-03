import { getSignedInUser } from './auth';
import { nativeAccounts } from './nativeAccounts';
import { getServerUrl, supportsMultipleServers } from './serverUrl';

/** Local storage uses a device identity; synced rows and encryption keep the server user ID. */
export function currentAccountId(): string | null {
  const user = getSignedInUser();
  if (!user) return null;
  if (!supportsMultipleServers()) return user.id;
  return (
    nativeAccounts().find(
      (account) => account.server === getServerUrl() && account.user.id === user.id,
    )?.id ?? null
  );
}
