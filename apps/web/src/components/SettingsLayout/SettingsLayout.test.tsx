import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_TABS } from '@/lib/settings';
import { SettingsLayout } from './SettingsLayout';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    replace: _replace,
    ...props
  }: ComponentProps<'a'> & { to: string; replace?: boolean }) => <a href={to} {...props} />,
}));

const account = SETTINGS_TABS[1];

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
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Account page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
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
});
