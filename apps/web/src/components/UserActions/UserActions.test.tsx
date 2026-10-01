import type { AdminUser } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { UserActions } from './UserActions';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { resetUserPassword: vi.fn(), deleteUser: vi.fn() },
}));
const user: AdminUser = {
  id: 'target',
  name: 'Target',
  email: 'target@example.com',
  role: 'user',
  createdAt: '2026-10-01T00:00:00.000Z',
  lastLoginAt: null,
};
const deleted = vi.fn();
const denied = vi.fn();
beforeEach(() => vi.resetAllMocks());
function show(self = false) {
  render(
    <UserActions
      user={user}
      self={self}
      disabled={false}
      onPendingChange={vi.fn()}
      onDeleted={deleted}
      onAccessDenied={denied}
    />,
  );
}
async function choose(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for target@example.com' }), {
    key: 'ArrowDown',
  });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

it('disables administrative actions on the signed-in account', () => {
  show(true);
  expect(screen.getByRole('button', { name: 'Actions for target@example.com' })).toBeDisabled();
});

it('confirms reset, shows and copies the temporary password, then forgets it', async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  vi.mocked(api.resetUserPassword).mockResolvedValue({ temporaryPassword: 'temporary-secret-123' });
  show();
  await choose('Reset password');
  expect(screen.getByRole('dialog')).toHaveTextContent('target@example.com');
  expect(api.resetUserPassword).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(await screen.findByRole('textbox', { name: 'Temporary password' })).toHaveValue(
    'temporary-secret-123',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  await screen.findByRole('button', { name: 'Copied' });
  expect(copy).toHaveBeenCalledWith('temporary-secret-123');
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('textbox', { name: 'Temporary password' })).not.toBeInTheDocument();
  await choose('Reset password');
  expect(screen.queryByRole('textbox', { name: 'Temporary password' })).not.toBeInTheDocument();
});

it('cancels deletion without a request and only refreshes after success', async () => {
  show();
  await choose('Delete user');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.deleteUser).not.toHaveBeenCalled();
  await choose('Delete user');
  vi.mocked(api.deleteUser).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update');
  expect(deleted).not.toHaveBeenCalled();
  vi.mocked(api.deleteUser).mockResolvedValueOnce({ ok: true });
  fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
  await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('closes privileged controls when the server rejects access', async () => {
  vi.mocked(api.resetUserPassword).mockRejectedValue(new ApiError(403, 'Admin access required'));
  show();
  await choose('Reset password');
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
