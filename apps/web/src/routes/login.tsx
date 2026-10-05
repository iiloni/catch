import { INVITE_HEADER, inviteFromFragment } from '@catch/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { activateAccount, authClient, getAccounts, getSignedInUser } from '@/lib/auth';
import { authRedirectSearchSchema, authReturnTo } from '@/lib/authRedirect';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/login')({
  validateSearch: authRedirectSearchSchema,
  beforeLoad: ({ search, location }) => {
    if (needsServerUrl()) throw redirect({ to: '/setup', search, hash: location.hash });
  },
  component: LoginPage,
});

// Prefill the seeded admin for Vite and bundled worktree builds. Other bundles strip this.
const devCredentials =
  import.meta.env.DEV || import.meta.env.CATCH_DEV_SERVER_URL
    ? { email: 'admin@example.com', password: 'adminadmin' }
    : undefined;

function LoginPage() {
  const { redirect: returnTo } = Route.useSearch();
  // An invite link opens the form to make the account it is for.
  const [invite] = useState(() => inviteFromFragment(window.location.hash));
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(invite ? 'sign-up' : 'sign-in');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Reached from the account list to add another, or after the session in use ended.
  const [signedIn] = useState(() => getAccounts()[0]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    setPending(true);
    setError(null);
    try {
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email(
              { email, password, name: String(form.get('name') ?? '') },
              invite ? { headers: { [INVITE_HEADER]: invite } } : undefined,
            );
      if (result.error) {
        setError(result.error.message ?? 'Something went wrong');
        return;
      }
      // A full load, so the collections open this user's copy of their notes on the device.
      // The invite is spent: it must not ride along as a destination's fragment.
      window.location.assign(authReturnTo(returnTo, invite ? '' : window.location.hash));
    } catch {
      setError('Could not reach the Catch server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <BrandLockup orientation="stacked" iconSize={96} />
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
        {invite && mode === 'sign-up' && (
          <p className="text-center text-muted-foreground text-sm">
            You have been invited to this Catch server. Make your account to join.
          </p>
        )}
        {mode === 'sign-up' && <Input name="name" placeholder="Name" aria-label="Name" />}
        <Input
          name="email"
          type="email"
          required
          defaultValue={devCredentials?.email}
          placeholder="Email"
          aria-label="Email"
        />
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          defaultValue={devCredentials?.password}
          placeholder="Password"
          aria-label="Password"
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={pending}>
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        >
          {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </Button>
        {signedIn && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // A full load: the collections open the notes of the account that is in use.
              if (!getSignedInUser()) activateAccount(signedIn.user.id);
              window.location.assign('/');
            }}
          >
            Back to your notes
          </Button>
        )}
      </form>
    </main>
  );
}
