import { CloudAlert, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { clearAuthToken } from '@/lib/auth';
import type { SyncStatus } from '@/lib/syncStatus';

/** Whether the header needs the indicator: only when changes cannot reach the server. */
export function showsSyncIndicator(status: SyncStatus) {
  return status.offline || status.signedOut;
}

const changes = (count: number) => (count === 1 ? '1 change' : `${count} changes`);

function describe({ pending, offline, signedOut, sharedTab }: SyncStatus) {
  if (signedOut) {
    return {
      title: 'Signed out',
      body:
        pending > 0
          ? `Sign in again to sync ${changes(pending)} saved on this device.`
          : 'Sign in again to keep your notes in sync.',
    };
  }
  if (offline && sharedTab) {
    return {
      title: 'Offline',
      body: 'Catch is open in another tab, and only that tab can save changes offline.',
    };
  }
  return {
    title: 'Offline',
    body:
      pending > 0
        ? `${changes(pending)} saved on this device will sync when you are back online.`
        : 'Your notes are on this device. Changes sync when you are back online.',
  };
}

function signInAgain() {
  // Keeps the device's notes and outbox: signing in as the same user picks them up again.
  clearAuthToken();
  window.location.assign('/login');
}

/** A header control that says why changes are not syncing, and how many are waiting. */
export function SyncIndicator({ status }: { status: SyncStatus }) {
  const { title, body } = describe(status);
  const Icon = status.signedOut ? CloudAlert : CloudOff;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={status.pending > 0 ? `${title}, ${changes(status.pending)} waiting` : title}
        className="relative flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className="size-[22px]" aria-hidden />
        {status.pending > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 font-semibold text-[0.625rem] text-background tabular-nums"
          >
            {status.pending > 99 ? '99+' : status.pending}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={12} className="flex w-64 flex-col gap-2">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{body}</p>
        {status.signedOut && (
          <Button className="self-end rounded-full" onClick={signInAgain}>
            Sign in
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
