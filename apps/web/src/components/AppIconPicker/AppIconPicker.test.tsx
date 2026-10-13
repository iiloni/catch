import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_ICON_KEY } from '@/lib/appIcon';
import { AppIconPicker } from './AppIconPicker';

const mocks = vi.hoisted(() => ({
  channel: 'preview' as 'stable' | 'preview' | 'dev' | null,
  platform: 'web',
  setIcon: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/updates', () => ({
  useUpdates: () => ({
    android: mocks.platform === 'android',
    server: mocks.channel && { channel: mocks.channel },
  }),
}));
vi.mock('@/lib/serverUrl', () => ({ getServerUrl: () => 'https://preview.example' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: () => ({ setIcon: mocks.setIcon }),
}));
vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  localStorage.clear();
  mocks.channel = 'preview';
  mocks.platform = 'web';
  mocks.setIcon.mockReset().mockResolvedValue(undefined);
});

describe('AppIconPicker', () => {
  it.each(['stable', 'dev', null] as const)('offers no choice for a %s server', (channel) => {
    mocks.channel = channel;
    render(<AppIconPicker />);
    expect(screen.queryByRole('region', { name: 'App icon' })).toBeNull();
  });

  it('defaults to stable, saves preview, and allows switching back', async () => {
    render(<AppIconPicker />);
    const stable = screen.getByRole('button', { name: 'Stable' });
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(stable).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(preview);
    await waitFor(() => expect(preview).toHaveAttribute('aria-pressed', 'true'));
    expect(JSON.parse(localStorage.getItem(APP_ICON_KEY) ?? 'null')).toEqual({
      icon: 'preview',
      server: 'https://preview.example',
    });
    fireEvent.click(stable);
    await waitFor(() => expect(stable).toHaveAttribute('aria-pressed', 'true'));
  });

  it('leaves the preference unchanged if the Android launcher rejects the choice', async () => {
    mocks.platform = 'android';
    mocks.setIcon.mockRejectedValueOnce(new Error('Launcher failed'));
    render(<AppIconPicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(mocks.setIcon).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Stable' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(APP_ICON_KEY)).toBeNull();
  });
});
