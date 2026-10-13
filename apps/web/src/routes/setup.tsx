import { inviteFromText } from '@catch/shared';
import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openAccountPage } from '@/lib/accounts';
import { accountId, getReturnAccount, pagePath } from '@/lib/auth';
import { authRedirectSearchSchema, authReturnTo } from '@/lib/authRedirect';
import { waitForPendingWritesStored } from '@/lib/collections';
import { nativeServers, prepareNativeLogin } from '@/lib/nativeAccounts';
import { getServerUrl, setServerUrl, supportsMultipleServers } from '@/lib/serverUrl';
import { isUpdateReloadBlocked } from '@/lib/useUpdateReloadBlocked';

/** First-run screen for the Android app: which Catch server to connect to. */
export const Route = createFileRoute('/setup')({
  validateSearch: authRedirectSearchSchema,
  component: SetupPage,
});

function SetupPage() {
  const { redirect, server } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const multiple = supportsMultipleServers();
  const [servers] = useState(() => (multiple ? nativeServers() : []));
  const [saved] = useState(getReturnAccount);
  const [address, setAddress] = useState(() => server ?? getServerUrl());

  async function connect(url: string) {
    setPending(true);
    try {
      await waitForPendingWritesStored();
      if (isUpdateReloadBlocked()) throw new Error('Close the open note before changing servers.');
    } catch (error) {
      setPending(false);
      throw error;
    }
    if (multiple) prepareNativeLogin(url);
    setServerUrl(url);
    const invite = inviteFromText(url);
    window.location.assign(
      pagePath(
        authReturnTo(
          redirect ? `/login?${new URLSearchParams({ redirect })}` : '/login',
          invite ? `#invite=${invite}` : window.location.hash,
        ),
      ),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('url')).trim();
    setPending(true);
    setError(null);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        throw new Error('Enter an HTTPS server address without a username or password.');
      const response = await fetch(new URL('/api/health', parsed), {
        signal: AbortSignal.timeout(10000),
        credentials: 'omit',
      });
      if (!response.ok) throw new Error();
      await connect(url);
    } catch (error) {
      setError(
        error instanceof Error && error.message.startsWith('Enter an HTTPS')
          ? error.message
          : 'Could not reach a Catch server at that address.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <BrandLockup orientation="stacked" iconSize={96} />
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-card p-6"
      >
        <h1 className="font-display font-bold text-2xl">
          {saved ? 'Add account' : 'Connect to your server'}
        </h1>
        {servers.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              Choose a saved server or enter another address.
            </p>
            {servers.map((server) => (
              <Button
                key={server}
                type="button"
                variant="ghost"
                className="justify-start"
                disabled={pending}
                onClick={() => {
                  void connect(server).catch(() =>
                    setError('Could not save your changes on this device. Try again.'),
                  );
                }}
              >
                {new URL(server).host}
              </Button>
            ))}
          </div>
        )}
        <Input
          name="url"
          type="url"
          required
          placeholder="https://catch.example.com"
          aria-label="Server URL"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <p className="text-muted-foreground text-sm">
          Were you sent an invite link? Paste it here instead.
        </p>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect'}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              void openAccountPage(accountId(saved));
            }}
          >
            Back to your notes
          </Button>
        )}
      </form>
    </main>
  );
}
