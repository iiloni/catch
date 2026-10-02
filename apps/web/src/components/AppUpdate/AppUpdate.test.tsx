import { androidUpdateAvailable } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdatePrompt } from '@/components/AppUpdatePrompt/AppUpdatePrompt';
import { SettingsButton } from '@/components/SettingsButton/SettingsButton';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { SettingsTabPicker } from '@/components/SettingsTabPicker/SettingsTabPicker';
import { api } from '@/lib/api';
import { SETTINGS_TABS, useSettingsNavigation } from '@/lib/settings';
import {
  checkForUpdates,
  installServerVersion,
  useAndroidUpdateAvailable,
  useUpdates,
} from '@/lib/updates';
import { AppUpdate } from './AppUpdate';

vi.mock('@/lib/updates', () => ({
  useUpdates: vi.fn(),
  useAndroidUpdateAvailable: vi.fn(),
  checkForUpdates: vi.fn(),
  installServerVersion: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: { releases: vi.fn() } }));
vi.mock('@/lib/theme', () => ({ useResolvedTheme: () => 'light' }));
vi.mock('@/lib/settings', async (original) => ({
  ...(await original<typeof import('@/lib/settings')>()),
  useSettingsNavigation: vi.fn(),
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouterState: () => '/',
  Link: ({
    to,
    replace: _replace,
    ...props
  }: React.ComponentProps<'a'> & { to: string; replace?: boolean }) => <a href={to} {...props} />,
}));

const open = vi.fn();
let state: ReturnType<typeof useUpdates>;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  localStorage.clear();
  state = {
    android: true,
    app: { version: '1.2.0', channel: 'stable' },
    server: { version: '1.3.0', channel: 'stable' },
    checking: false,
    error: null,
    installing: false,
    installError: null,
  };
  vi.mocked(useUpdates).mockImplementation(() => state);
  vi.mocked(useAndroidUpdateAvailable).mockImplementation(
    () => state.android && androidUpdateAvailable(state.app, state.server),
  );
  vi.mocked(useSettingsNavigation).mockReturnValue({ open, select: vi.fn(), leave: vi.fn() });
  vi.mocked(api.releases).mockResolvedValue({
    channel: 'stable',
    releases: [{ version: '1.3.0', name: 'Catch 1.3.0', publishedAt: '2026-10-01T00:00:00Z' }],
  });
});

describe('Update settings', () => {
  it.each(['stable', 'preview', 'dev'] as const)(
    'keeps %s branding on Update, using app identity on Android and server identity on web',
    async (channel) => {
      state.app = { version: '1.2.0', channel };
      state.server = { version: '1.3.0', channel: channel === 'stable' ? 'preview' : 'stable' };
      const { rerender } = render(<AppUpdate />);
      expect(screen.getByRole('img', { name: 'Catch' })).toHaveAttribute(
        'src',
        `/wordmark/catch-lockup-stacked-${channel}-dark-small.svg`,
      );
      state.android = false;
      rerender(<AppUpdate />);
      expect(screen.getByRole('img', { name: 'Catch' })).toHaveAttribute(
        'src',
        `/wordmark/catch-lockup-stacked-${state.server.channel}-dark-small.svg`,
      );
      await waitFor(() => expect(api.releases).toHaveBeenCalled());
    },
  );

  it('shows project links and both versions on Android with an exact-version update button', async () => {
    render(<AppUpdate />);
    expect(screen.getByText('App version')).toBeInTheDocument();
    expect(screen.getByText('1.2.0')).toBeInTheDocument();
    expect(screen.getByText('1.3.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute(
      'href',
      'https://github.com/iiloni/catch',
    );
    expect(screen.getByRole('link', { name: 'GitHub releases' })).toHaveAttribute(
      'href',
      'https://github.com/iiloni/catch/releases',
    );
    expect(await screen.findByRole('link', { name: /Catch 1.3.0/ })).toHaveAttribute(
      'href',
      'https://github.com/iiloni/catch/releases/tag/v1.3.0',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update to 1.3.0' }));
    expect(installServerVersion).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(checkForUpdates).toHaveBeenCalledOnce();
  });

  it('shows only the server version for web clients', async () => {
    state.android = false;
    state.app = null;
    render(<AppUpdate />);
    expect(screen.queryByText('App version')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update to 1.3.0' })).not.toBeInTheDocument();
    await screen.findByRole('link', { name: /Catch 1.3.0/ });
  });

  it('keeps server metadata visible when GitHub fails and supports a retry', async () => {
    vi.mocked(api.releases).mockRejectedValueOnce(new Error('offline'));
    render(<AppUpdate />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load releases');
    expect(screen.getByText('1.3.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: /Catch 1.3.0/ });
  });

  it('disables the update while downloading and surfaces installation errors', async () => {
    state.installing = true;
    const { rerender } = render(<AppUpdate />);
    expect(screen.getByRole('button', { name: 'Preparing update…' })).toBeDisabled();
    state.installing = false;
    state.installError = 'Allow Catch to install updates, then try again';
    rerender(<AppUpdate />);
    expect(screen.getByRole('alert')).toHaveTextContent('Allow Catch');
    await screen.findByRole('link', { name: /Catch 1.3.0/ });
  });

  it('marks the settings button and Update in both navigation layouts', () => {
    render(
      <>
        <SettingsButton />
        <SettingsLayout current={SETTINGS_TABS[0]} wide onBack={vi.fn()}>
          <p>General</p>
        </SettingsLayout>
        <SettingsTabPicker open current={SETTINGS_TABS[0]} hovered={null} onSelect={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveTextContent('Update available');
    expect(screen.getByRole('link', { name: /^Update/ })).toHaveTextContent('Update available');
    expect(screen.getByRole('button', { name: /^Update/ })).toHaveTextContent('Update available');
  });

  it.each(['same version', 'app ahead', 'different channel', 'development', 'web'])(
    'does not prompt or mark %s',
    (scenario) => {
      if (scenario === 'same version') state.app = state.server;
      if (scenario === 'app ahead') state.app = { version: '1.4.0', channel: 'stable' };
      if (scenario === 'different channel')
        state.app = { version: '1.2.0-preview', channel: 'preview' };
      if (scenario === 'development') state.server = { version: null, channel: 'dev' };
      if (scenario === 'web') state.android = false;
      render(
        <>
          <SettingsButton />
          <AppUpdatePrompt />
        </>,
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText('Update available')).not.toBeInTheDocument();
    },
  );
});

describe('first-update prompt', () => {
  it('links directly to Update and remembers the choice across remounts', async () => {
    const { unmount } = render(<AppUpdatePrompt />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Catch 1.3.0');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Update' }));
    expect(open).toHaveBeenCalledWith('/settings/update');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    unmount();
    render(<AppUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('allows dismissal but prompts again for a new target release', async () => {
    const { rerender } = render(<AppUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    state.server = { version: '1.4.0', channel: 'stable' };
    rerender(<AppUpdatePrompt />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Catch 1.4.0');
  });
});
