import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  authClient: { signIn: { email: auth.signIn }, signUp: { email: auth.signUp } },
}));
vi.mock('@/lib/serverUrl', () => ({ needsServerUrl: () => false }));
vi.mock('@/components/BrandLockup/BrandLockup', () => ({ BrandLockup: () => <img alt="Catch" /> }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
}));

import { Route } from './login';

beforeEach(() => vi.resetAllMocks());

it.each(['sign-in', 'sign-up'])(
  'allows retrying %s after a rejected network request',
  async (mode) => {
    const LoginPage = Route.options.component;
    if (!LoginPage) throw new Error('Login component missing');
    await LoginPage.preload?.();
    await act(async () => {
      render(<LoginPage />);
    });
    await screen.findByLabelText('Email');
    if (mode === 'sign-up')
      fireEvent.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'adminadmin' } });
    const request = mode === 'sign-in' ? auth.signIn : auth.signUp;
    request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const submit = screen.getByRole('button', {
      name: mode === 'sign-in' ? 'Sign in' : 'Create account',
    });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(await screen.findByText(/Could not reach the Catch server/)).toBeInTheDocument();
    await waitFor(() => expect(submit).toBeEnabled());
    request.mockResolvedValueOnce({ error: { message: 'Invalid email or password' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
    expect(submit).toBeEnabled();
  },
);
