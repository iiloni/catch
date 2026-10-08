import { Capacitor } from '@capacitor/core';
import { createFileRoute } from '@tanstack/react-router';
import { LogOut, Server } from 'lucide-react';
import { useState } from 'react';
import { AccountSummary } from '@/components/AccountSummary/AccountSummary';
import { ChangeName } from '@/components/ChangeName/ChangeName';
import { ChangePassword } from '@/components/ChangePassword/ChangePassword';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { signOutCurrentAccount } from '@/lib/accounts';
import { getSignedInUser } from '@/lib/auth';
import { getServerUrl } from '@/lib/serverUrl';
import { useSyncStatus } from '@/lib/syncStatus';

export const Route = createFileRoute('/_app/settings/account')({
  component: AccountSettings,
});

function AccountSettings() {
  const [user, setUser] = useState(getSignedInUser);
  const { pending } = useSyncStatus();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Signed in as">
        {user && <AccountSummary id={user.id} name={user.name} email={user.email} />}
        {user && <ChangeName name={user.name} onChanged={() => setUser(getSignedInUser())} />}
        {Capacitor.isNativePlatform() && (
          <SettingsRow icon={Server} label="Server" description={getServerUrl()} />
        )}
      </SettingsSection>
      <ChangePassword />
      <div className="rounded-2xl bg-foreground/[0.05]">
        <button
          type="button"
          onClick={() => (pending > 0 ? setConfirming(true) : signOutCurrentAccount())}
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
            <Button variant="destructive" className="rounded-full" onClick={signOutCurrentAccount}>
              Sign out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
