import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { LinkCaptureForm } from '@/components/LinkCapture/LinkCapture';
import { Button } from '@/components/ui/button';
import { getAuthToken } from '@/lib/auth';
import { needsServerUrl } from '@/lib/serverUrl';

const captureSearch = z.object({
  url: z.string().max(2048).optional().catch(undefined),
  title: z.string().max(300).optional().catch(undefined),
  text: z.string().max(10000).optional().catch(undefined),
  popup: z.enum(['true']).optional().catch(undefined),
});

export const Route = createFileRoute('/capture')({
  validateSearch: captureSearch,
  beforeLoad: ({ location }) => {
    // Keep page content in a fragment even if the login screen is reloaded.
    const [destination, hash = ''] = location.href.split('#', 2);
    const search = { redirect: destination ?? '/capture' };
    if (needsServerUrl()) throw redirect({ to: '/setup', search, hash });
    if (!getAuthToken()) throw redirect({ to: '/login', search, hash });
  },
  component: CapturePage,
});

function CapturePage() {
  const search = Route.useSearch();
  const [initial] = useState(() => ({
    ...search,
    ...captureSearch.parse(Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)))),
  }));
  const [saved, setSaved] = useState<string | null>(null);
  const navigate = useNavigate();
  const openNote = (note: string) => void navigate({ to: '/', search: { note } });
  return (
    <main className="mx-auto flex h-[calc(100dvh-var(--keyboard))] max-w-xl flex-col gap-6 overflow-hidden px-5 pt-[calc(var(--safe-top)+1.25rem)] pb-[calc(var(--safe-bottom)+1.25rem)]">
      <BrandLockup orientation="horizontal" iconSize={28} />
      {saved ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/20">
            <Check className="size-7" aria-hidden />
          </span>
          <h1 className="font-display font-bold text-2xl">Link saved</h1>
          <p className="text-muted-foreground">Your note is in Gallery.</p>
          <Button onClick={() => openNote(saved)} className="h-11 rounded-xl">
            Open note
          </Button>
          {initial.popup && (
            <Button variant="ghost" onClick={() => window.close()}>
              Close window
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-1">
            <h1 className="text-center font-display font-bold text-2xl">Add Rich Link</h1>
          </div>
          <LinkCaptureForm
            initial={{ url: initial.url, title: initial.title, notes: initial.text }}
            autoFetch={Boolean(initial.url)}
            onSaved={setSaved}
            onOpenNote={openNote}
            onCancel={() => {
              if (initial.popup) window.close();
              else void navigate({ to: '/' });
            }}
          />
        </>
      )}
    </main>
  );
}
