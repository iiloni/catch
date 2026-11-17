import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/lib/auth';

const ada: Account = { user: { id: 'ada', name: 'Ada', email: 'ada@example.com' }, token: 'a' };
const bob: Account = { user: { id: 'bob', name: '', email: 'bob@example.com' }, token: 'b' };

const mocks = vi.hoisted(() => ({ accounts: [] as Account[] }));
vi.mock('@/lib/auth', () => ({
  getAccounts: () => mocks.accounts,
  getSignedInUser: () => mocks.accounts[0]?.user ?? null,
}));
vi.mock('@/lib/haptics', () => ({ haptics: { success: vi.fn() } }));

import { CaptureAccountPicker } from './CaptureAccountPicker';

beforeEach(() => {
  mocks.accounts = [ada, bob];
});

describe('CaptureAccountPicker', () => {
  it('is absent with a single account', () => {
    mocks.accounts = [ada];
    render(<CaptureAccountPicker onSwitch={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
  });

  it('shows the account in use and switches to another one', () => {
    const onSwitch = vi.fn();
    render(<CaptureAccountPicker onSwitch={onSwitch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account: Ada' }));
    const accounts = screen.getByRole('list', { name: 'Accounts' });
    expect(accounts.querySelector('[aria-current="true"]')).toHaveTextContent('Ada');
    fireEvent.click(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(onSwitch).toHaveBeenCalledWith('bob');
  });

  it('stays on the account in use when it is picked again', () => {
    const onSwitch = vi.fn();
    render(<CaptureAccountPicker onSwitch={onSwitch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account: Ada' }));
    fireEvent.click(screen.getByRole('button', { name: /^Ada\s*ada@example\.com$/ }));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Accounts' })).toBeNull();
  });

  it('cannot be opened while the link is saving', () => {
    render(<CaptureAccountPicker disabled onSwitch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Account: Ada' })).toBeDisabled();
  });
});
