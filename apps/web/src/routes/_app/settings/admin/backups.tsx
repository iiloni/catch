import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ServerBackups } from '@/components/ServerBackups/ServerBackups';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin/backups')({
  component: BackupsSettings,
});

function BackupsSettings() {
  const navigate = useNavigate();
  const { refetch } = authClient.useSession();
  const onAccessDenied = useCallback(() => {
    void refetch();
    void navigate({ to: '/settings/general', replace: true });
  }, [navigate, refetch]);
  return <ServerBackups onAccessDenied={onAccessDenied} />;
}
