import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { SaveStatus } from './SaveStatus';

// These checks cover status timing; browser tests cover the entrance, width and exit motion.
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

afterEach(() => {
  act(() =>
    updateSyncStatus({ offline: false, signedOut: false, pending: 0, incompatibility: null }),
  );
  vi.useRealTimers();
});

describe('SaveStatus', () => {
  it('says changes are kept locally while waiting for sign-in', () => {
    act(() => updateSyncStatus({ signedOut: true, pending: 1 }));
    render(<SaveStatus state="saving" />);
    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument();
  });
  it('says changes are kept locally while an update is required', () => {
    act(() => updateSyncStatus({ incompatibility: 'client-too-old', pending: 1 }));
    render(<SaveStatus state="saving" />);
    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument();
  });
  it('shows a save in progress', () => {
    render(<SaveStatus state="saving" />);
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
  });

  it('says an offline save is kept on the device', () => {
    act(() => updateSyncStatus({ offline: true }));
    render(<SaveStatus state="saving" />);
    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument();
  });

  it('stays quiet when opening a saved note', () => {
    render(<SaveStatus state="saved" />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows confirmation for two seconds after syncing', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SaveStatus state="saving" />);
    rerender(<SaveStatus state="saved" />);
    expect(screen.getByText('Synced')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByText('Synced')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps syncing until queued writes reach the server', () => {
    act(() => updateSyncStatus({ pending: 1 }));
    const { rerender } = render(<SaveStatus state="saving" />);
    rerender(<SaveStatus state="saved" />);
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    act(() => updateSyncStatus({ pending: 0 }));
    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('does not hide a new save when the previous confirmation expires', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SaveStatus state="saving" />);
    rerender(<SaveStatus state="saved" />);
    act(() => vi.advanceTimersByTime(1000));
    rerender(<SaveStatus state="saving" />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    rerender(<SaveStatus state="saved" />);
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByText('Synced')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps a save failure visible', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SaveStatus state="saving" />);
    rerender(<SaveStatus state="error" />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
  });
});
