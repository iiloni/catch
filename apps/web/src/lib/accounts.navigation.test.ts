import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  stored: vi.fn(),
  activate: vi.fn(),
  blocked: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock('./auth', () => ({
  getAccountId: () => 'n-home',
  getSignedInUser: () => ({ id: 'remote-user' }),
  getAccounts: () => [{ id: 'n-home' }, { id: 'n-work' }],
  accountId: (account: { id: string }) => account.id,
  activateAccount: mock.activate,
  accountPath: (_id: string, path: string) => path,
}));
vi.mock('./collections', () => ({ waitForPendingWritesStored: mock.stored }));
vi.mock('./useUpdateReloadBlocked', () => ({ isUpdateReloadBlocked: mock.blocked }));
vi.mock('sonner', () => ({ toast: mock.toast }));
vi.mock('./attachmentFiles', () => ({}));
vi.mock('./imports', () => ({}));
vi.mock('./localStore', () => ({}));
vi.mock('./nativeReminders', () => ({}));
vi.mock('./nativeWidgets', () => ({}));
vi.mock('./push', () => ({}));
vi.mock('./shareInbox', () => ({}));
vi.mock('./syncStatus', () => ({}));
vi.mock('./vaultKeyStore', () => ({}));
vi.mock('./linkCapture', () => ({ linkCaptureOpen: {} }));

import { openAccountPage, switchAccount } from './accounts';

beforeEach(() => {
  vi.clearAllMocks();
  mock.blocked.mockReturnValue(false);
  mock.activate.mockReturnValue(false);
  mock.stored.mockResolvedValue(undefined);
});

describe('account reloads', () => {
  it('refuses a server change when a composer opens while its writes are being stored', async () => {
    let stored = () => {};
    mock.stored.mockReturnValue(
      new Promise<void>((resolve) => {
        stored = resolve;
      }),
    );
    const changing = openAccountPage('n-work', '/s/token');
    expect(mock.activate).not.toHaveBeenCalled();
    mock.blocked.mockReturnValue(true);
    stored();
    expect(await changing).toBe(false);
    expect(mock.activate).not.toHaveBeenCalled();
    expect(mock.toast).toHaveBeenCalledWith('Close the open note before changing accounts.');
  });
  it('refuses switching when local persistence fails', async () => {
    mock.stored.mockRejectedValue(new Error('Outbox commit failed'));
    expect(await switchAccount('n-work')).toBe(false);
    expect(mock.activate).not.toHaveBeenCalled();
    expect(mock.toast.error).toHaveBeenCalledWith(
      'Could not save your changes on this device. Try switching again.',
    );
  });
  it('also waits when returning to the account that is already loaded', async () => {
    let stored = () => {};
    mock.stored.mockReturnValue(
      new Promise<void>((resolve) => {
        stored = resolve;
      }),
    );
    const returning = openAccountPage('n-home');
    expect(mock.activate).not.toHaveBeenCalled();
    stored();
    expect(await returning).toBe(false);
    expect(mock.activate).toHaveBeenCalledWith('n-home');
  });
});
