import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { useAdminAccess } from '@/lib/admin';
import { settingsTabFor, useSettingsNavigation, useWideSettings } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  // The destination URL changes before the outgoing page's snapshot is captured.
  const current = useChildMatches({
    select: (matches) => settingsTabFor(matches.at(-1)?.pathname ?? ''),
  });
  const { leave } = useSettingsNavigation();

  return (
    <SettingsLayout
      current={current}
      wide={useWideSettings()}
      isAdmin={useAdminAccess()}
      onBack={leave}
    >
      <Outlet />
    </SettingsLayout>
  );
}
