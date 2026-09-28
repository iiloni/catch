import { createFileRoute, redirect } from '@tanstack/react-router';
import { SETTINGS_TABS } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: () => {
    throw redirect({ to: SETTINGS_TABS[0].path, replace: true });
  },
});
