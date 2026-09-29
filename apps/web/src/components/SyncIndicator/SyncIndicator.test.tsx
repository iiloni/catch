import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@/lib/syncStatus';
import { SyncIndicator, showsSyncIndicator } from './SyncIndicator';

const status = (changes: Partial<SyncStatus>): SyncStatus => ({
  pending: 0,
  offline: false,
  signedOut: false,
  sharedTab: false,
  ...changes,
});

describe('showsSyncIndicator', () => {
  it('shows only while changes cannot reach the server', () => {
    expect(showsSyncIndicator(status({ pending: 3 }))).toBe(false);
    expect(showsSyncIndicator(status({ offline: true }))).toBe(true);
    expect(showsSyncIndicator(status({ signedOut: true }))).toBe(true);
  });
});

describe('SyncIndicator', () => {
  it('counts the changes waiting offline', () => {
    render(<SyncIndicator status={status({ offline: true, pending: 2 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Offline, 2 changes waiting' }));
    expect(screen.getByText(/2 changes saved on this device will sync/)).toBeInTheDocument();
  });

  it('asks to sign in again when the server turned the session down', () => {
    render(<SyncIndicator status={status({ signedOut: true, pending: 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Signed out, 1 change waiting' }));
    expect(screen.getByText(/Sign in again to sync 1 change/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('explains that another tab holds the outbox', () => {
    render(<SyncIndicator status={status({ offline: true, sharedTab: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Offline' }));
    expect(screen.getByText(/only that tab can save changes offline/)).toBeInTheDocument();
  });
});
