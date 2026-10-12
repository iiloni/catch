import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearWidgets: vi.fn(),
  signOut: vi.fn(),
  clearLocal: vi.fn(),
  stopRinging: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('./auth', () => ({
  getSignedInUser: () => ({ id: 'alice' }),
  getAccounts: () => [],
  authClient: { signOut: mocks.signOut },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));
vi.mock('./nativeWidgets', () => ({ nativeWidgets: { clear: mocks.clearWidgets } }));
vi.mock('./collections', () => ({ clearLocalData: mocks.clearLocal }));
vi.mock('./push', () => ({ leavePush: mocks.stopRinging }));
vi.mock('./attachmentFiles', () => ({}));
vi.mock('./imports', () => ({}));
vi.mock('./localStore', () => ({}));
vi.mock('./nativeReminders', () => ({}));
vi.mock('./serverUrl', () => ({}));
vi.mock('./shareInbox', () => ({}));
vi.mock('./syncStatus', () => ({}));
vi.mock('./vaultKeyStore', () => ({}));
vi.mock('./linkCapture', () => ({ linkCaptureOpen: {} }));

import { signOutCurrentAccount } from './accounts';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('sign-out when native widget clearing fails', () => {
  it('offers a retry and preserves the session and local data', async () => {
    mocks.clearWidgets.mockRejectedValue(new Error('Storage unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(signOutCurrentAccount()).resolves.toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith(
      'Could not clear widget previews. Try signing out again.',
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearLocal).not.toHaveBeenCalled();
    expect(mocks.stopRinging).not.toHaveBeenCalled();
    expect(localStorage.getItem('catch-account-removed:alice')).toBeNull();
  });
});
