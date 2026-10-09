import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { LinkCaptureForm } from '@/components/LinkCapture/LinkCapture';
import { Button } from '@/components/ui/button';
import { getAuthToken } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import type { IncomingLinkCapture } from '@/lib/linkCapture';
import { dismissLinkShare, prepareShare, saveLinkShare } from '@/lib/receiveShare';
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
  const [capture, setCapture] = useState<IncomingLinkCapture | null>(null);
  const [saving, setSaving] = useState(false);
  const cancel = async () => {
    if (!capture) return;
    await dismissLinkShare(capture.id);
    await navigate({ to: '/', replace: true });
  };
  useBackHandler(Boolean(capture), () => {
    if (saving) return;
    setSaving(true);
    void cancel()
      .catch((error: unknown) => {
        setError(
          error instanceof Error ? error.message : 'Could not close this capture. Try again.',
        );
      })
      .finally(() => setSaving(false));
  });
  useEffect(() => {
    if (!id || incomingError) return;
    let current = true;
    setError(null);
    setCapture(null);
    void prepareShare(id).then(
      (share) => {
        if (!current) return;
        if (share.kind === 'link') setCapture(share);
        else if (share.kind === 'note')
          void navigate({ to: '/', search: { note: share.id }, replace: true });
        else void navigate({ to: '/', replace: true });
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
  if (capture)
    return (
      <main className="mx-auto flex h-[calc(100dvh-var(--keyboard))] max-w-xl flex-col gap-6 overflow-hidden px-5 pt-[calc(var(--safe-top)+1.25rem)] pb-[calc(var(--safe-bottom)+1.25rem)]">
        <BrandLockup orientation="horizontal" iconSize={28} />
        <div className="flex shrink-0 flex-col gap-1">
          <h1 className="text-center font-display font-bold text-2xl">Add Rich Link</h1>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <LinkCaptureForm
          key={capture.id}
          initial={capture.draft}
          initialStatus={capture.initialStatus}
          autoFetch
          saveDraft={(draft, placement) => saveLinkShare(capture.id, draft, placement)}
          onSavingChange={setSaving}
          onCancel={cancel}
          onSaved={(note) => void navigate({ to: '/', search: { note }, replace: true })}
          onOpenNote={async (note) => {
            await dismissLinkShare(capture.id);
            await navigate({ to: '/', search: { note }, replace: true });
          }}
        />
      </main>
    );
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
