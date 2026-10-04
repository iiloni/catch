import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import { SETTINGS_TABS } from '@/lib/settings';
import { SettingsLayout } from './SettingsLayout';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouterState: ({ select }: { select: (state: { matches: [] }) => unknown }) =>
    select({ matches: [] }),
  Link: ({
    to,
    replace: _replace,
    ...props
  }: ComponentProps<'a'> & { to: string; replace?: boolean }) => <a href={to} {...props} />,
}));

const account = SETTINGS_TABS.find((tab) => tab.path === '/settings/account')!;

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.documentElement.scrollTop = 0;
});

function pull(element: HTMLElement, delta: number, cancel = false) {
  fireEvent.touchStart(element, { touches: [{ clientY: 200 }] });
  fireEvent.touchMove(element, { touches: [{ clientY: 200 + delta }] });
  // Rest before release so a short pull is not a fling.
  fireEvent.touchMove(element, { touches: [{ clientY: 200 + delta }] });
  if (cancel) fireEvent.touchCancel(element, { touches: [] });
  else fireEvent.touchEnd(element, { touches: [] });
}

describe('SettingsLayout', () => {
  it('lists the pages beside the open one when wide', () => {
    const onBack = vi.fn();
    render(
      <SettingsLayout current={account} wide onBack={onBack}>
        <p>Account page</p>
      </SettingsLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings pages' });
    expect(nav).toHaveTextContent('General');
    expect(screen.getByRole('region', { name: 'User' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Account page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('groups server settings separately for admins', () => {
    render(
      <SettingsLayout
        current={SETTINGS_TABS.find((tab) => tab.path === '/settings/admin/users')!}
        wide
        isAdmin
        onBack={vi.fn()}
      >
        <p>Users page</p>
      </SettingsLayout>,
    );
    expect(screen.getByRole('region', { name: 'User' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Admin' })).toContainElement(
      screen.getByRole('link', { name: 'Users' }),
    );
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows only the open page under its own title when narrow', () => {
    render(
      <SettingsLayout current={account} wide={false} onBack={vi.fn()}>
        <p>Account page</p>
      </SettingsLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    // The dock holds the way back.
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByText('Account page')).toBeInTheDocument();
  });

  it.each([
    ['down at the top', 0, 150, true],
    ['up at the bottom', 600, -150, true],
    ['down between edges', 300, 150, false],
    ['up between edges', 300, -150, false],
    ['up at the top', 0, -150, false],
    ['down at the bottom', 600, 150, false],
    ['a short pull', 0, 40, false],
  ])('uses the document scroll for %s', (_, scrollTop, delta, dismissed) => {
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(400);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000);
    document.documentElement.scrollTop = scrollTop;
    const onBack = vi.fn();
    render(
      <SettingsLayout current={account} wide={false} onBack={onBack}>
        <p>Account page</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account page'), delta);
    expect(onBack).toHaveBeenCalledTimes(dismissed ? 1 : 0);
    expect(haptics.threshold).toHaveBeenCalledTimes(dismissed ? 1 : 0);
  });

  it('keeps settings open when a pull is canceled', () => {
    const onBack = vi.fn();
    render(
      <SettingsLayout current={account} wide={false} onBack={onBack}>
        <p>Account page</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account page'), 150, true);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not swipe away the wide layout', () => {
    const onBack = vi.fn();
    render(
      <SettingsLayout current={account} wide onBack={onBack}>
        <p>Account page</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account page'), 150);
    expect(onBack).not.toHaveBeenCalled();
    expect(haptics.threshold).not.toHaveBeenCalled();
  });
});
