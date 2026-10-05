import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/lib/auth';

const ada: Account = { user: { id: 'ada', name: 'Ada', email: 'ada@example.com' }, token: 'a' };
const bob: Account = { user: { id: 'bob', name: '', email: 'bob@example.com' }, token: 'b' };

const mocks = vi.hoisted(() => ({
  accounts: [] as Account[],
  switchAccount: vi.fn(),
  signOutAccount: vi.fn(),
  unsyncedChanges: vi.fn(),
  blocked: vi.fn(() => false),
}));
vi.mock('@/lib/auth', () => ({
  getAccounts: () => mocks.accounts,
  getSignedInUser: () => mocks.accounts[0]?.user ?? null,
}));
vi.mock('@/lib/accounts', () => ({
  switchAccount: mocks.switchAccount,
  signOutAccount: mocks.signOutAccount,
  unsyncedChanges: mocks.unsyncedChanges,
}));
vi.mock('@/lib/useUpdateReloadBlocked', () => ({ isUpdateReloadBlocked: mocks.blocked }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import { AccountSwitcher } from './AccountSwitcher';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts = [ada, bob];
  mocks.blocked.mockReturnValue(false);
  mocks.unsyncedChanges.mockResolvedValue(0);
  mocks.signOutAccount.mockResolvedValue(undefined);
});

const openList = () => fireEvent.click(screen.getByRole('button', { name: 'Account: Ada' }));

describe('AccountSwitcher', () => {
  it('lists the signed-in accounts and marks the one in use', () => {
    render(<AccountSwitcher />);
    openList();
    expect(screen.getByRole('button', { name: /^Ada\s*ada@example\.com$/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'bob@example.com' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Add account' })).toHaveAttribute('href', '/login');
  });

  it('switches to the account that is picked', () => {
    render(<AccountSwitcher />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(mocks.switchAccount).toHaveBeenCalledWith('bob');
  });

  it('does not switch away from an open note', () => {
    mocks.blocked.mockReturnValue(true);
    render(<AccountSwitcher />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(mocks.switchAccount).not.toHaveBeenCalled();
  });

  it('signs another account out and drops it from the list', async () => {
    mocks.signOutAccount.mockImplementation(async () => {
      mocks.accounts = [ada];
    });
    render(<AccountSwitcher />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out bob@example.com' }));
    await waitFor(() => expect(mocks.signOutAccount).toHaveBeenCalledWith(bob));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'bob@example.com' })).not.toBeInTheDocument(),
    );
  });

  it('asks before deleting changes that have not synced', async () => {
    mocks.unsyncedChanges.mockResolvedValue(2);
    render(<AccountSwitcher />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out bob@example.com' }));
    expect(await screen.findByText(/2 changes on this device have not synced/)).toBeInTheDocument();
    expect(mocks.signOutAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.signOutAccount).toHaveBeenCalledWith(bob));
  });

  it('shows nothing when nobody is signed in', () => {
    mocks.accounts = [];
    const { container } = render(<AccountSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });
});
