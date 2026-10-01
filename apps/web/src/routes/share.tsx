import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { getAuthToken } from '@/lib/auth';
import { receiveShare } from '@/lib/receiveShare';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/share')({
  validateSearch: z.object({
    id: z.uuid({ version: 'v7' }).optional(),
    error: z.string().optional(),
  }),
  beforeLoad: ({ location, search }) => {
    if (search.error || !search.id) return;
    const destination = { redirect: location.href };
    if (needsServerUrl()) throw redirect({ to: '/setup', search: destination });
    if (!getAuthToken()) throw redirect({ to: '/login', search: destination });
  },
  component: SharePage,
});

function SharePage() {
  const { id, error: incomingError } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState(
    incomingError ?? (!id ? 'The other app did not send any content.' : null),
  );
  useEffect(() => {
    if (!id || incomingError) return;
    let current = true;
    setError(null);
    void receiveShare(id).then(
      (note) => {
        if (current) void navigate({ to: '/', search: { note }, replace: true });
      },
      (error: unknown) => {
        if (current)
          setError(error instanceof Error ? error.message : 'Could not save the shared content.');
      },
    );
    return () => {
      current = false;
    };
  }, [id, incomingError, navigate]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display font-bold text-2xl">
        {error ? 'Could not save this share' : 'Saving shared content…'}
      </h1>
      {error && <p className="max-w-md text-muted-foreground">{error}</p>}
      {error && id && !incomingError && (
        <Button onClick={() => window.location.reload()}>Try again</Button>
      )}
      {error && (
        <Button variant="outline" onClick={() => void navigate({ to: '/' })}>
          Back to Catch
        </Button>
      )}
    </main>
  );
}
