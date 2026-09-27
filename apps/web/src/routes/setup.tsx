import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setServerUrl } from '@/lib/serverUrl';

/** First-run screen for the Android app: which Catch server to connect to. */
export const Route = createFileRoute('/setup')({
  component: SetupPage,
});

function SetupPage() {
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('url')).trim();
    try {
      const response = await fetch(new URL('/api/health', url));
      if (!response.ok) throw new Error();
    } catch {
      setError('Could not reach a Catch server at that address.');
      return;
    }
    setServerUrl(url);
    // Reload so the auth client and sync pick up the new server.
    window.location.assign('/login');
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-card p-6"
      >
        <h1 className="font-bold text-2xl">Connect to your server</h1>
        <Input
          name="url"
          type="url"
          required
          placeholder="https://catch.example.com"
          aria-label="Server URL"
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit">Connect</Button>
      </form>
    </main>
  );
}
