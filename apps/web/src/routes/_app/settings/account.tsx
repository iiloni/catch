import { Capacitor } from '@capacitor/core';
import { createFileRoute } from '@tanstack/react-router';
import { LogOut, Server } from 'lucide-react';
import { AccountSummary } from '@/components/AccountSummary/AccountSummary';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { authClient, clearAuthToken } from '@/lib/auth';
import { getServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/_app/settings/account')({
  component: AccountSettings,
});

async function signOut() {
  await authClient.signOut();
  clearAuthToken();
  // A full reload drops this user's synced notes from memory.
  window.location.assign('/login');
}

function AccountSettings() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

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
          onClick={signOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}
