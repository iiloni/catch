import {
  createRootRoute,
  type ErrorComponentProps,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getAuthToken, getSignedInUser } from '@/lib/auth';
import { useBackButton } from '@/lib/backButton';
import { quickNote } from '@/lib/dockState';
import { enqueueLinkCapture } from '@/lib/linkCapture';
import { watchNativeShares } from '@/lib/nativeShares';
import { prepareShare } from '@/lib/receiveShare';
import { needsServerUrl } from '@/lib/serverUrl';
import { pendingIncomingShares } from '@/lib/shareInbox';
import { useSystemBarsStyle } from '@/lib/systemBars';
import { useApplyTheme } from '@/lib/theme';

export const Route = createRootRoute({
  component: Root,
  errorComponent: RootError,
});

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="font-bold text-2xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}

// Toasts drop in at the top, clear of the dock and the controls that float above it.
const toastOffset = { top: 'calc(var(--safe-top) + 0.5rem)' };
// A phone's header has no free middle, so there they sit below it instead of over its controls.
const mobileToastOffset = { top: 'calc(var(--safe-top) + var(--header-height) + 0.75rem)' };

function Root() {
  const navigate = useNavigate();
  useEffect(() => {
    let stopped = false;
    const fail = (error: unknown) => {
      if (!stopped)
        toast.error(
          error instanceof Error ? error.message : 'Could not receive the shared content.',
        );
    };
    const open = async (id: string) => {
      if (stopped) return;
      if (
        window.location.pathname === '/share' &&
        new URLSearchParams(window.location.search).get('id') === id
      )
        return;
      if (getAuthToken() && getSignedInUser() && !needsServerUrl()) {
        try {
          const share = await prepareShare(id);
          if (stopped || share.kind === 'dismissed') return;
          // Keep the signed-in layout mounted so open notes and composer drafts can flush.
          if (share.kind !== 'link' || quickNote.get() !== 'capture') quickNote.set('closed');
          if (share.kind === 'link') {
            if (['/share', '/capture', '/login', '/setup'].includes(window.location.pathname))
              await navigate({ to: '/' });
            if (!stopped) enqueueLinkCapture(share);
          } else await navigate({ to: '/', search: { note: share.id } });
        } catch (error) {
          if (!stopped)
            toast.error(
              error instanceof Error ? error.message : 'Could not save the shared content.',
              {
                action: {
                  label: 'Try again',
                  onClick: () => {
                    void open(id);
                  },
                },
              },
            );
          return;
        }
      } else {
        await navigate({ to: '/share', search: { id } });
      }
    };
    const stopNative = watchNativeShares(open, fail);
    // Native acknowledgement can precede a WebView restart. Recover staging that has
    // already moved into IndexedDB, without competing with the explicit share route.
    if (window.location.pathname !== '/share' && getSignedInUser()) {
      void pendingIncomingShares()
        .then(async (shares) => {
          const user = getSignedInUser();
          for (const share of shares) {
            if (!share.userId || share.userId === user?.id) await open(share.id);
          }
        })
        .catch(fail);
    }
    return () => {
      stopped = true;
      stopNative();
    };
  }, [navigate]);
  useApplyTheme();
  useSystemBarsStyle();
  useBackButton();
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Outlet />
        <Toaster position="top-center" offset={toastOffset} mobileOffset={mobileToastOffset} />
      </TooltipProvider>
    </MotionConfig>
  );
}
