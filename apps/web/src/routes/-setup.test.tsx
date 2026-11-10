import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  stored: vi.fn(async () => {}),
  back: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  getReturnAccount: mock.back,
  accountId: (account: { id: string }) => account.id,
  pagePath: (path: string) => path,
}));
vi.mock('@/lib/accounts', () => ({ openAccountPage: mock.open }));
vi.mock('@/lib/serverUrl', () => ({
  supportsMultipleServers: () => true,
  getServerUrl: () => '',
}));
vi.mock('@/lib/nativeAccounts', () => ({ nativeServers: () => ['https://home.example'] }));
vi.mock('@/lib/collections', () => ({ waitForPendingWritesStored: mock.stored }));
vi.mock('@/components/BrandLockup/BrandLockup', () => ({ BrandLockup: () => <img alt="Catch" /> }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
}));

import { Route } from './setup';

beforeEach(() => {
  vi.clearAllMocks();
  mock.back.mockReturnValue(undefined);
  vi.stubGlobal('fetch', mock.fetch);
});
async function show() {
  const Component = Route.options.component;
  if (!Component) throw new Error('Setup component missing');
  await Component.preload?.();
  await act(async () => {
    render(<Component />);
  });
}
it('offers saved server connections alongside the address field', async () => {
  await show();
  expect(screen.getByRole('button', { name: 'home.example' })).toBeInTheDocument();
  expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
});
it.each(['http://work.example', 'https://alice:password@work.example'])(
  'refuses unsafe server input %s before making a request',
  async (address) => {
    await show();
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: address } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByText('Enter an HTTPS server address without a username or password.'),
    ).toBeInTheDocument();
    expect(mock.fetch).not.toHaveBeenCalled();
  },
);
it('allows retry after the server cannot be reached', async () => {
  mock.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  await show();
  fireEvent.change(screen.getByLabelText('Server URL'), {
    target: { value: 'https://work.example' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  expect(
    await screen.findByText('Could not reach a Catch server at that address.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
});

it('returns to the account that opened setup, using its device identity', async () => {
  mock.back.mockReturnValue({
    id: 'n-work',
    server: 'https://work.example',
    user: { id: 'remote-user' },
  });
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Back to your notes' }));
  expect(mock.open).toHaveBeenCalledWith('n-work');
});
