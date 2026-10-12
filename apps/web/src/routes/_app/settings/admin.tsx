import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router';
import { hasAdminRole } from '@/lib/admin';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin')({ component: AdminSettings });

/**
 * The guard reads the session the app already holds. Asking the server before each
 * navigation left the old page on screen until it answered, seconds on a slow connection.
 * The server refuses the admin routes to anyone else, and each page leaves on that refusal.
 */
function AdminSettings() {
  const { data, error, isPending } = authClient.useSession();
  if (isPending) return null;
  if (error || !hasAdminRole(data?.user)) {
    return <Navigate to="/settings/general" replace />;
  }
  return <Outlet />;
}
