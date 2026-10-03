import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebUpdatePrompt } from './WebUpdatePrompt';

const mocks = vi.hoisted(() => ({
  state: { target: 'build-2' as string | null, reloading: false, error: null as string | null },
  blocked: false,
  reload: vi.fn(),
}));
vi.mock('@/lib/webUpdates', () => ({
  useWebUpdates: () => mocks.state,
  reloadForWebUpdate: mocks.reload,
}));
vi.mock('@/lib/useUpdateReloadBlocked', () => ({ useUpdateReloadBlocked: () => mocks.blocked }));

beforeEach(() => {
  mocks.state = { target: 'build-2', reloading: false, error: null };
  mocks.blocked = false;
  mocks.reload.mockReset();
});

describe('web update prompt', () => {
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
