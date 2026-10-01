import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { hasAdminRole } from '@/lib/admin';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin')({
  beforeLoad: async () => {
    const session = await authClient.getSession().catch(() => null);
    if (!hasAdminRole(session?.data?.user)) {
      throw redirect({ to: '/settings/general', replace: true });
    }
  },
  component: AdminSettings,
});

function AdminSettings() {
  const { data, error, isPending } = authClient.useSession();
  if (isPending) return null;
  if (error || !hasAdminRole(data?.user)) {
    return <Navigate to="/settings/general" replace />;
  }
  return <Outlet />;
}
