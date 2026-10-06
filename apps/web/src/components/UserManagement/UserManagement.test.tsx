import type { AdminUser } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { UserManagement } from './UserManagement';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { listUsers: vi.fn(), updateUserRole: vi.fn() },
}));

const admin: AdminUser = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  createdAt: '2026-10-01T00:00:00.000Z',
  lastLoginAt: '2026-10-01T12:34:00.000Z',
};
const user: AdminUser = {
  ...admin,
  id: 'user',
  name: 'User',
  email: 'user@example.com',
  role: 'user',
  lastLoginAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listUsers).mockResolvedValue({ users: [admin, user], total: 2 });
});

function show(onAccessDenied = vi.fn()) {
  render(<UserManagement currentUserId="admin" onAccessDenied={onAccessDenied} />);
  return onAccessDenied;
}

async function chooseRole(trigger: HTMLElement, name: string) {
  // Radix opens a menu on the pointer or the keyboard, not on a click.
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name }));
}

describe('UserManagement', () => {
  it('shows login dates and handles accounts with no recorded login', async () => {
    show();
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(screen.getByRole('columnheader', { name: 'Last login' })).toBeInTheDocument();
    expect(table.querySelector('time[datetime="2026-10-01T12:34:00.000Z"]')).toHaveAttribute(
      'title',
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(admin.lastLoginAt!),
      ),
    );
    expect(screen.getAllByTitle('No recorded login').length).toBeGreaterThan(0);
  });
  it('protects the current admin and waits for a role change to save', async () => {
    show();
    const role = () => screen.getByRole('button', { name: /^Role for user@example\.com/ });
    await screen.findByRole('table', { name: 'Users' });
    expect(
      screen.getByRole('button', { name: 'Role for admin@example.com: Admin' }),
    ).toBeDisabled();
    let finish: (value: AdminUser) => void = () => {};
    vi.mocked(api.updateUserRole).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await chooseRole(role(), 'Admin');
    expect(role()).toBeDisabled();
    expect(role()).toHaveTextContent('User');
    expect(api.updateUserRole).toHaveBeenCalledWith('user', { role: 'admin' });
    finish({ ...user, role: 'admin' });
    await waitFor(() => expect(role()).toHaveTextContent('Admin'));
    expect(role()).toBeEnabled();
  });

  it('saves nothing when the role a user already has is chosen', async () => {
    show();
    await screen.findByRole('table', { name: 'Users' });
    await chooseRole(
      screen.getByRole('button', { name: 'Role for user@example.com: User' }),
      'User',
    );
    expect(api.updateUserRole).not.toHaveBeenCalled();
  });

  it('keeps the saved role and reports a failed change', async () => {
    vi.mocked(api.updateUserRole).mockRejectedValue(new Error('offline'));
    show();
    await screen.findByRole('table', { name: 'Users' });
    const role = () => screen.getByRole('button', { name: /^Role for user@example\.com/ });
    await chooseRole(role(), 'Admin');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change the role');
    expect(role()).toHaveTextContent('User');
    expect(role()).toBeEnabled();
  });

  it('searches on the server and resets pagination', async () => {
    vi.mocked(api.listUsers).mockResolvedValue({ users: [user], total: 26 });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api.listUsers).toHaveBeenLastCalledWith(
        { search: '', offset: 25, limit: 25 },
        expect.any(AbortSignal),
      ),
    );
    vi.mocked(api.listUsers).mockResolvedValue({ users: [], total: 0 });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), {
      target: { value: 'no match' },
    });
    expect(await screen.findByText('No users match this search.')).toBeInTheDocument();
    expect(api.listUsers).toHaveBeenLastCalledWith(
      { search: 'no match', offset: 0, limit: 25 },
      expect.any(AbortSignal),
    );
  });

  it('leaves the admin page when the server refuses access', async () => {
    vi.mocked(api.listUsers).mockRejectedValue(new ApiError(403, 'Admin access required'));
    const denied = show();
    await waitFor(() => expect(denied).toHaveBeenCalled());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('can retry a failed directory request', async () => {
    vi.mocked(api.listUsers).mockRejectedValueOnce(new Error('offline'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load users');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh users' }));
    expect(await screen.findByRole('table', { name: 'Users' })).toBeInTheDocument();
  });
});
