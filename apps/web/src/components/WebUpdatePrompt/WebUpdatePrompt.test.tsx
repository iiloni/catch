import type { CompatibilityIssue } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebUpdatePrompt } from './WebUpdatePrompt';

const mocks = vi.hoisted(() => ({
  state: { target: 'build-2' as string | null, reloading: false, error: null as string | null },
  blocked: false,
  incompatibility: null as CompatibilityIssue | null,
  platform: 'web',
  reload: vi.fn(),
}));
vi.mock('@/lib/webUpdates', () => ({
  useWebUpdates: () => mocks.state,
  reloadForWebUpdate: mocks.reload,
}));
vi.mock('@/lib/useUpdateReloadBlocked', () => ({ useUpdateReloadBlocked: () => mocks.blocked }));
vi.mock('@/lib/syncStatus', () => ({
  useSyncStatus: () => ({ incompatibility: mocks.incompatibility }),
}));
vi.mock('@capacitor/core', async (original) => {
  const actual = await original<typeof import('@capacitor/core')>();
  return { ...actual, Capacitor: { ...actual.Capacitor, getPlatform: () => mocks.platform } };
});

beforeEach(() => {
  mocks.state = { target: 'build-2', reloading: false, error: null };
  mocks.blocked = false;
  mocks.incompatibility = null;
  mocks.platform = 'web';
  mocks.reload.mockReset();
});

describe('web update prompt', () => {
  it('explains that an incompatible frontend needs updating to resume sync and can keep working offline', () => {
    mocks.incompatibility = 'client-too-old';
    render(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'Update required to sync' })).toHaveTextContent(
      'can no longer sync',
    );
    expect(screen.queryByRole('button', { name: 'Later' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep working offline' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it('shows the required warning even if build metadata is unavailable', () => {
    mocks.state.target = null;
    mocks.incompatibility = 'client-too-old';
    const { rerender } = render(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'Update required to sync' })).toBeInTheDocument();
    mocks.incompatibility = null;
    rerender(<WebUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains a compatibility rejection even after dismissing an optional update for the same build', () => {
    const { rerender } = render(<WebUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    mocks.incompatibility = 'client-too-old';
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'Update required to sync' })).toBeInTheDocument();
  });

  it('prompts for a new build after choosing to keep working offline', () => {
    mocks.incompatibility = 'client-too-old';
    const { rerender } = render(<WebUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep working offline' }));
    mocks.state.target = 'build-3';
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'Update required to sync' })).toBeInTheDocument();
  });

  it('does not ask for a frontend update when the server needs upgrading', () => {
    mocks.incompatibility = 'server-too-old';
    mocks.state.target = null;
    render(<WebUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves native app updates to the Android prompt', () => {
    mocks.platform = 'android';
    mocks.incompatibility = 'client-too-old';
    render(<WebUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reloads only after the user approves', () => {
    render(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog')).toHaveTextContent('queued changes');
    expect(mocks.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }));
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('dismisses this build and prompts again for a later build', () => {
    const { rerender } = render(<WebUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    rerender(<WebUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.reload).not.toHaveBeenCalled();
    mocks.state = { ...mocks.state, target: 'build-3' };
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('defers the prompt until the editor or draft closes', () => {
    mocks.blocked = true;
    const { rerender } = render(<WebUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    mocks.blocked = false;
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps failure feedback visible and prevents duplicate approval during preparation', () => {
    mocks.state.error = 'Connect and try again';
    const { rerender } = render(<WebUpdatePrompt />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connect');
    mocks.state.reloading = true;
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('button', { name: 'Preparing update…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });
});
