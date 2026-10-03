import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { UserInvites } from '@/components/UserInvites/UserInvites';
import { UserManagement } from '@/components/UserManagement/UserManagement';
import { authClient, getSignedInUser } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin/users')({
  component: UsersSettings,
});

function UsersSettings() {
  const navigate = useNavigate();
  const { refetch } = authClient.useSession();
  const onAccessDenied = useCallback(() => {
    void refetch();
    void navigate({ to: '/settings/general', replace: true });
  }, [navigate, refetch]);
  return (
    <div className="flex flex-col gap-6">
      <UserManagement currentUserId={getSignedInUser()?.id ?? ''} onAccessDenied={onAccessDenied} />
      <UserInvites onAccessDenied={onAccessDenied} />
    </div>
  );
}
