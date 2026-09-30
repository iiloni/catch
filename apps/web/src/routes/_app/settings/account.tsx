import { Capacitor } from '@capacitor/core';
import { createFileRoute } from '@tanstack/react-router';
import { LogOut, Server } from 'lucide-react';
import { useState } from 'react';
import { AccountSummary } from '@/components/AccountSummary/AccountSummary';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { authClient, clearAuthToken, getSignedInUser } from '@/lib/auth';
import { clearLocalData } from '@/lib/collections';
import { forgetImport } from '@/lib/imports';
import { getServerUrl } from '@/lib/serverUrl';
import { useSyncStatus } from '@/lib/syncStatus';

export const Route = createFileRoute('/_app/settings/account')({
  component: AccountSettings,
});

async function signOut() {
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await authClient.signOut().catch(() => undefined);
  await clearLocalData();
  forgetImport();
  clearAuthToken();
  // A full reload drops this user's synced notes from memory.
  window.location.assign('/login');
}

function AccountSettings() {
  const user = getSignedInUser();
  const { pending } = useSyncStatus();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Signed in as">
        {user && <AccountSummary name={user.name} email={user.email} />}
        {Capacitor.isNativePlatform() && (
          <SettingsRow icon={Server} label="Server" description={getServerUrl()} />
        )}
      </SettingsSection>
      <div className="rounded-2xl bg-foreground/[0.05]">
        <button
          type="button"
          onClick={() => (pending > 0 ? setConfirming(true) : signOut())}
          className="flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>Sign out?</DialogTitle>
          <DialogDescription>
            {pending === 1
              ? 'A change on this device has not synced yet. Signing out deletes it.'
              : `${pending} changes on this device have not synced yet. Signing out deletes them.`}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" className="rounded-full" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
