import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { AiConfiguration } from '@/components/AiConfiguration/AiConfiguration';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin/ai')({ component: AiSettings });

function AiSettings() {
  const navigate = useNavigate();
  const { refetch } = authClient.useSession();
  const onAccessDenied = useCallback(() => {
    void refetch();
    void navigate({ to: '/settings/general', replace: true });
  }, [navigate, refetch]);
  return <AiConfiguration onAccessDenied={onAccessDenied} />;
}
