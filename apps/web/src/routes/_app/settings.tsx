import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { settingsTabFor, useSettingsNavigation, useWideSettings } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { leave } = useSettingsNavigation();

  return (
    <SettingsLayout current={settingsTabFor(pathname)} wide={useWideSettings()} onBack={leave}>
      <Outlet />
    </SettingsLayout>
  );
}
