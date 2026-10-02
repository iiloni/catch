import { createFileRoute, redirect } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth';
import { authRedirectSearchSchema } from '@/lib/authRedirect';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/login')({
  validateSearch: authRedirectSearchSchema,
  beforeLoad: ({ search }) => {
    if (needsServerUrl()) throw redirect({ to: '/setup', search });
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
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
          : await authClient.signUp.email({
              email,
              password,
              name: String(form.get('name') ?? ''),
            });
      if (result.error) {
        setError(result.error.message ?? 'Something went wrong');
        return;
      }
      // A full load, so the collections open this user's copy of their notes on the device.
      window.location.assign(returnTo ?? '/');
    } catch {
      setError('Could not reach the Catch server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <BrandLockup orientation="horizontal" iconSize={48} />
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
        <h1 className="font-display font-bold text-2xl">
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </h1>
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
      </form>
    </main>
  );
}
