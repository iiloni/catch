// @vitest-environment node
import type { Note, Reminder, Vault, VaultFile, VaultNote } from '@catch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BiometricFailure } from './vaultBiometrics';
import type { KeptVaultBiometric, KeptVaultPin } from './vaultKeyStore';

// The collections as plain maps: what the device's database and the outbox would be given.
const store = vi.hoisted(() => {
  const collection = <T>(key: (row: T) => string) => {
    const rows = new Map<string, T>();
    return {
      rows,
      values: () => rows.values(),
      get: (id: string) => rows.get(id),
      has: (id: string) => rows.has(id),
      insert: (row: T) => void rows.set(key(row), row),
      update: (id: string, change: (draft: T) => void) => {
        const draft = { ...(rows.get(id) as T) };
        change(draft);
        rows.set(id, draft);
      },
      delete: (id: string) => void rows.delete(id),
      isReady: () => true,
      onFirstReady: () => () => {},
      subscribeChanges: () => ({ unsubscribe: () => {} }),
    };
  };
  return {
    vault: collection<Vault>((row) => row.userId),
    notes: collection<VaultNote>((row) => row.id),
    reminders: collection<Reminder>((row) => row.noteId),
  };
});

vi.mock('./collections', () => ({
  remindersCollection: store.reminders,
  vaultCollection: store.vault,
  vaultNotesCollection: store.notes,
  awaitVaultSync: async () => true,
  publishVaultAssignments: vi.fn(),
  write: (mutate: () => void) => {
    mutate();
    return { id: 'write', isPersisted: { promise: Promise.resolve() } };
  },
}));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./attachmentFiles', () => ({ setSealedFiles: vi.fn(), closeSealedFiles: vi.fn() }));
// The page as the vault sees it: whether it is shown, and what it hears from the user.
const page = vi.hoisted(() => {
  const listeners = new Map<string, (() => void)[]>();
  return {
    visibility: 'visible' as 'visible' | 'hidden',
    listeners,
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
});
vi.stubGlobal('document', {
  addEventListener: (type: string, listener: () => void) =>
    page.listeners.set(type, [...(page.listeners.get(type) ?? []), listener]),
  get visibilityState() {
    return page.visibility;
  },
});
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
// What the device keeps under its PIN and its fingerprint.
const device = vi.hoisted(() => ({
  pin: null as KeptVaultPin | null,
  biometric: null as KeptVaultBiometric | null,
}));
// The phone's Keystore: the key it seals the vault key under, and how the next prompt ends.
const phone = vi.hoisted(() => ({
  key: null as Uint8Array | null,
  sealedWith: 0,
  next: [] as BiometricFailure[],
}));
vi.mock('./vaultBiometrics', () => {
  class BiometricError extends Error {
    constructor(readonly reason: BiometricFailure) {
      super(reason);
    }
  }
  const prompt = () => {
    const failure = phone.next.shift();
    if (failure === 'invalidated') phone.key = null;
    if (failure) throw new BiometricError(failure);
  };
  return {
    BiometricError,
    biometricsSupported: () => true,
    sealWithBiometrics: vi.fn(async (_id: string, key: Uint8Array) => {
      phone.key = null;
      prompt();
      phone.key = key.slice();
      phone.sealedWith++;
      return { iv: 'iv', sealed: `sealed under Keystore key ${phone.sealedWith}` };
    }),
    openWithBiometrics: vi.fn(async (_id: string, kept: { sealed: string }) => {
      if (!phone.key || kept.sealed !== `sealed under Keystore key ${phone.sealedWith}`)
        throw new BiometricError('gone');
      prompt();
      return phone.key.slice();
    }),
    forgetBiometricKey: vi.fn(async () => {
      phone.key = null;
    }),
  };
});
vi.mock('./vaultKeyStore', () => ({
  vaultSeenKey: (id: string) => `catch-vault:${id}`,
  rememberVaultKey: vi.fn(async () => {}),
  loadVaultKey: vi.fn(async () => null),
  forgetVaultKey: vi.fn(async () => {}),
  keepVaultPin: vi.fn(async (_id: string, kept: KeptVaultPin) => {
    device.pin = kept;
  }),
  loadVaultPin: vi.fn(async () => device.pin),
  forgetVaultPin: vi.fn(async () => {
    device.pin = null;
  }),
  keepVaultBiometric: vi.fn(async (_id: string, kept: KeptVaultBiometric) => {
    device.biometric = kept;
  }),
  loadVaultBiometric: vi.fn(async () => device.biometric),
  forgetVaultBiometric: vi.fn(async () => {
    device.biometric = null;
  }),
  forgetVaultDevice: vi.fn(async () => {
    device.pin = null;
    device.biometric = null;
    phone.key = null;
  }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('./api', () => ({
  ApiError: class extends Error {},
  api: {
    createVault: vi.fn(async (body: Omit<Vault, 'userId' | 'updatedAt'>) => {
      store.vault.insert({ ...body, userId: 'user-1', updatedAt: new Date() });
      return { txid: 1 };
    }),
    saveVault: vi.fn(async (body: Omit<Vault, 'userId' | 'updatedAt'>) => {
      store.vault.insert({ ...body, userId: 'user-1', updatedAt: new Date() });
      return { txid: 2 };
    }),
    deleteVault: vi.fn(async () => {
      store.vault.rows.clear();
      store.notes.rows.clear();
      return { txid: 3 };
    }),
  },
}));

import { closeSealedFiles } from './attachmentFiles';
import { publishVaultAssignments } from './collections';
import {
  changeVaultNote,
  changeVaultNoteFiles,
  changeVaultNoteTags,
  changeVaultPassword,
  createVault,
  deleteVault,
  enableVaultBiometrics,
  enterVault,
  getSealedFiles,
  getVaultFiles,
  getVaultNote,
  getVaultNoteTags,
  insertVaultNote,
  isVaultNote,
  leaveVault,
  lockVault,
  recoverVault,
  rememberVault,
  removeVaultBiometrics,
  removeVaultNote,
  removeVaultPin,
  setVaultPin,
  startVault,
  unlockVault,
  unlockWithBiometrics,
  unlockWithPin,
  vaultBiometrics,
  vaultBiometricsLost,
  vaultFileNote,
  vaultMode,
  vaultNotes,
  vaultPin,
  vaultPrompt,
  vaultRemembered,
  vaultStatus,
} from './vault';
import { BiometricError, forgetBiometricKey } from './vaultBiometrics';
import { forgetVaultKey, forgetVaultPin, loadVaultPin, rememberVaultKey } from './vaultKeyStore';

const paragraph = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];
const TAG = '0199a0a0-0000-7000-8000-00000000000a';
let made = 0;
const note = (content: Note['content']): Note => ({
  id: `0199a0a0-0000-7000-8000-${String(++made).padStart(12, '0')}`,
  userId: 'user-1',
  content,
  color: 'default',
  status: 'todo',
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  galleryPreviewUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});
const add = (text: string) => {
  const added = note(paragraph(text));
  insertVaultNote(added);
  return added.id;
};

describe('the vault', () => {
  let recoveryCode = '';

  beforeEach(async () => {
    if (vaultStatus.get() === 'unlocked') await lockVault();
    store.vault.rows.clear();
    store.notes.rows.clear();
    store.reminders.rows.clear();
    vaultPrompt.set(false);
    vi.mocked(rememberVaultKey).mockClear();
    vi.mocked(forgetVaultKey).mockClear();
    await removeVaultPin();
    await removeVaultBiometrics();
    phone.next = [];
    vaultBiometricsLost.set(false);
    recoveryCode = await createVault('correct horse', false);
  });

  afterEach(() => {
    vi.useRealTimers();
    page.visibility = 'visible';
  });

  it('is unlocked by setting it up, and keeps the key off the device unless asked', () => {
    expect(vaultStatus.get()).toBe('unlocked');
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(rememberVaultKey).not.toHaveBeenCalled();
  });

  it('gives the collection only ciphertext', () => {
    const id = add('buried under the oak');
    expect(isVaultNote(id)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('buried under the oak'));
    const stored = JSON.stringify([...store.notes.values()]);
    expect(stored).not.toContain('oak');
    expect(atob(store.notes.get(id)?.data ?? '')).not.toContain('oak');
  });

  it('seals where a note is kept, its tags and its files along with its words', async () => {
    const id = add('secret');
    const file: VaultFile = {
      id: '0199a0a0-0000-7000-8000-0000000000f1',
      name: 'passport.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      kind: 'image',
      createdAt: new Date(),
      thumbnailId: null,
      sealId: '0199a0a0-0000-7000-8000-0000000000f1',
    };
    changeVaultNote(id, (draft) => {
      draft.isArchived = true;
      draft.deletedAt = new Date(0);
      draft.status = 'done';
    });
    changeVaultNoteTags(id, (draft) => {
      draft.primaryTagId = TAG;
    });
    changeVaultNoteFiles(id, (files) => [...files, file]);
    expect(getVaultNoteTags(id)).toMatchObject({ id, primaryTagId: TAG, secondaryTagIds: [] });
    expect(vi.mocked(publishVaultAssignments).mock.lastCall?.[0].get(id)?.primaryTagId).toBe(TAG);
    expect(getVaultFiles(id)).toMatchObject([{ id: file.id, noteId: id, name: 'passport.jpg' }]);
    expect(vaultFileNote(file.id)).toBe(id);
    const stored = JSON.stringify([...store.notes.values()]);
    expect(stored).not.toContain('passport');
    expect(stored).not.toContain(TAG);

    // Another visit opens all of it again from the ciphertext alone.
    await lockVault();
    expect(vaultFileNote(file.id)).toBeUndefined();
    expect(closeSealedFiles).toHaveBeenCalled();
    await unlockVault('correct horse', false);
    expect(getVaultNote(id)).toMatchObject({
      isArchived: true,
      status: 'done',
      deletedAt: new Date(0),
    });
    expect(getVaultNoteTags(id)?.primaryTagId).toBe(TAG);
    expect(getSealedFiles(id)).toEqual([file]);
  });

  it('takes a trashed note’s reminder off, and puts it back when the note is restored', async () => {
    const id = add('dentist');
    const reminder: Reminder = {
      noteId: id,
      userId: 'user-1',
      kind: 'time',
      startsAt: '2026-10-08T09:00',
      timeZone: 'Europe/Lisbon',
      floating: true,
      recurrence: null,
      nextAt: '2026-10-08T09:00',
      snoozedUntil: null,
      firedAt: null,
    };
    store.reminders.insert(reminder);
    changeVaultNote(id, (draft) => {
      draft.deletedAt = new Date();
    });
    // The server cannot tell the note is in the trash, so it must not hold a reminder to ring.
    expect(store.reminders.has(id)).toBe(false);
    expect(JSON.stringify([...store.notes.values()])).not.toContain('Lisbon');

    // The reminder waits sealed in the note, so it survives a lock.
    await lockVault();
    await unlockVault('correct horse', false);
    changeVaultNote(id, (draft) => {
      draft.deletedAt = null;
    });
    expect(store.reminders.get(id)).toEqual(reminder);
  });

  it('deletes a note for good', () => {
    const id = add('gone');
    removeVaultNote(id);
    expect(store.notes.rows.size).toBe(0);
    expect(vaultNotes.get()).toEqual([]);
    expect(isVaultNote(id)).toBe(false);
  });

  it('forgets everything when locked, and opens again only with the password', async () => {
    const id = add('secret');
    await lockVault();
    expect(vaultStatus.get()).toBe('locked');
    expect(vaultNotes.get()).toEqual([]);
    expect(isVaultNote(id)).toBe(false);
    expect(forgetVaultKey).toHaveBeenCalledWith('user-1');
    expect(() => insertVaultNote(note([]))).toThrow('locked');
    expect(await unlockVault('wrong horse', false)).toBe(false);
    expect(vaultStatus.get()).toBe('locked');
    expect(await unlockVault('correct horse', true)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('secret'));
    expect(rememberVaultKey).toHaveBeenCalledOnce();
  });

  it('shows its notes when entered, and locks on leaving unless the device remembers it', async () => {
    enterVault();
    expect(vaultMode.get()).toBe(true);
    leaveVault();
    await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));
    expect(vaultMode.get()).toBe(false);

    // Locked: entering asks for the password instead.
    enterVault();
    expect(vaultMode.get()).toBe(false);
    expect(vaultPrompt.get()).toBe(true);

    await unlockVault('correct horse', true);
    enterVault();
    leaveVault();
    expect(vaultMode.get()).toBe(false);
    expect(vaultStatus.get()).toBe('unlocked');
  });

  it('changes the password without losing the notes or the recovery code', async () => {
    const id = add('kept');
    expect(await changeVaultPassword('wrong horse', 'new password')).toBe(false);
    expect(await changeVaultPassword('correct horse', 'new password')).toBe(true);
    await lockVault();
    expect(await unlockVault('correct horse', false)).toBe(false);
    expect(await unlockVault('new password', false)).toBe(true);
    await lockVault();
    expect(
      await recoverVault('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'x'.repeat(8), false),
    ).toBe(false);
    expect(await recoverVault(recoveryCode, 'after recovery', false)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('kept'));
    await lockVault();
    expect(await unlockVault('after recovery', false)).toBe(true);
  });

  it('is gone once deleted', async () => {
    add('secret');
    await deleteVault();
    expect(vaultStatus.get()).toBe('none');
    expect(vaultNotes.get()).toEqual([]);
  });

  it('opens with a PIN in place of the password, and keeps the PIN through a lock', async () => {
    const id = add('secret');
    await setVaultPin('2468');
    expect(vaultPin.get()).toEqual({ length: 4, left: 5 });
    expect(JSON.stringify(device.pin)).not.toContain('2468');
    await lockVault();
    expect(vaultStatus.get()).toBe('locked');
    expect(vaultPin.get()).not.toBeNull();
    expect(await unlockWithPin('1357')).toEqual({ result: 'wrong', left: 4 });
    expect(vaultStatus.get()).toBe('locked');
    expect(await unlockWithPin('2468')).toEqual({ result: 'unlocked' });
    expect(getVaultNote(id)?.content).toEqual(paragraph('secret'));
    // A right PIN starts the count again.
    expect(vaultPin.get()).toEqual({ length: 4, left: 5 });
  });

  it('forgets the PIN after five wrong ones in a row, and asks for the password', async () => {
    await setVaultPin('2468');
    await lockVault();
    for (const left of [4, 3, 2, 1]) {
      expect(await unlockWithPin('0000')).toEqual({ result: 'wrong', left });
    }
    expect(await unlockWithPin('0000')).toEqual({ result: 'locked-out' });
    expect(vaultPin.get()).toBeNull();
    expect(device.pin).toBeNull();
    expect(await unlockWithPin('2468')).toEqual({ result: 'forgotten' });
    expect(vaultStatus.get()).toBe('locked');
    expect(await unlockVault('correct horse', false)).toBe(true);
  });

  it('counts wrong PINs tried at once one after another', async () => {
    await setVaultPin('2468');
    await lockVault();
    const tries = await Promise.all(Array.from({ length: 6 }, () => unlockWithPin('0000')));
    expect(tries).toEqual([
      { result: 'wrong', left: 4 },
      { result: 'wrong', left: 3 },
      { result: 'wrong', left: 2 },
      { result: 'wrong', left: 1 },
      { result: 'locked-out' },
      { result: 'forgotten' },
    ]);
    expect(device.pin).toBeNull();
  });

  it('never tries a PIN with no tries left, even one the device failed to delete', async () => {
    await setVaultPin('2468');
    await lockVault();
    if (device.pin) device.pin = { ...device.pin, failures: 5 };
    expect(await unlockWithPin('2468')).toEqual({ result: 'locked-out' });
    expect(vaultStatus.get()).toBe('locked');
  });

  it('keeps the PIN when the device cannot read or delete it', async () => {
    await setVaultPin('2468');
    await lockVault();
    vi.mocked(loadVaultPin).mockRejectedValueOnce(new Error('unreadable'));
    await expect(unlockWithPin('2468')).rejects.toThrow('unreadable');
    expect(device.pin).not.toBeNull();
    expect(await unlockWithPin('2468')).toEqual({ result: 'unlocked' });

    // Turning it off reports the failure and leaves it shown as set, as it still is.
    vi.mocked(forgetVaultPin).mockRejectedValueOnce(new Error('undeletable'));
    await expect(removeVaultPin()).rejects.toThrow('undeletable');
    expect(vaultPin.get()).not.toBeNull();
    expect(device.pin).not.toBeNull();
  });

  it('forgets a PIN for a vault deleted and set up again elsewhere', async () => {
    await setVaultPin('2468');
    await lockVault();
    const vault = store.vault.get('user-1');
    if (vault) store.vault.insert({ ...vault, recoveryKey: 'another vault' });
    expect(await unlockWithPin('2468')).toEqual({ result: 'forgotten' });
    expect(vaultPin.get()).toBeNull();
    expect(device.pin).toBeNull();
  });

  it('either remembers the vault or asks for a PIN, not both', async () => {
    await setVaultPin('2468');
    await rememberVault(true);
    expect(vaultRemembered.get()).toBe(true);
    expect(vaultPin.get()).toBeNull();
    expect(device.pin).toBeNull();
    await setVaultPin('1357');
    expect(vaultRemembered.get()).toBe(false);
    expect(forgetVaultKey).toHaveBeenCalledWith('user-1');
    expect(vaultPin.get()).toEqual({ length: 4, left: 5 });
  });

  it('keeps the PIN through a password change, and forgets it with the vault', async () => {
    await setVaultPin('24681357');
    expect(await changeVaultPassword('correct horse', 'new password')).toBe(true);
    await lockVault();
    expect(await unlockWithPin('24681357')).toEqual({ result: 'unlocked' });
    await deleteVault();
    expect(vaultPin.get()).toBeNull();
    expect(device.pin).toBeNull();
  });

  it('locks a minute after the app is hidden with a PIN, and five minutes without one', async () => {
    startVault();
    vi.useFakeTimers({ toFake: ['Date'] });
    const away = (ms: number) => {
      page.visibility = 'hidden';
      page.fire('visibilitychange');
      vi.setSystemTime(Date.now() + ms);
      page.visibility = 'visible';
      page.fire('visibilitychange');
    };
    away(61_000);
    expect(vaultStatus.get()).toBe('unlocked');
    away(5 * 60_000);
    await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));

    await unlockVault('correct horse', false);
    await setVaultPin('2468');
    away(30_000);
    expect(vaultStatus.get()).toBe('unlocked');
    away(61_000);
    await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));
  });

  it('with a PIN, locks after five minutes on screen with nobody touching it', async () => {
    startVault();
    await setVaultPin('2468');
    await lockVault();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await unlockWithPin('2468');
    vi.advanceTimersByTime(4 * 60_000);
    page.fire('pointerdown');
    vi.advanceTimersByTime(4 * 60_000);
    expect(vaultStatus.get()).toBe('unlocked');
    vi.advanceTimersByTime(60_000 + 15_000);
    await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));

    // Without a PIN, only leaving or the app being away locks it.
    await removeVaultPin();
    await unlockVault('correct horse', false);
    vi.advanceTimersByTime(30 * 60_000);
    expect(vaultStatus.get()).toBe('unlocked');
  });

  describe('with a fingerprint', () => {
    const prompt = { title: 'Unlock the vault', cancel: 'Use PIN' };

    it('opens the vault, and stays on through a lock', async () => {
      const id = add('secret');
      await enableVaultBiometrics(prompt);
      expect(vaultBiometrics.get()).toBe(true);
      // The device keeps only what the Keystore sealed, for this vault.
      expect(device.biometric).toMatchObject({ iv: 'iv', vault: expect.any(String) });
      await lockVault();
      expect(vaultBiometrics.get()).toBe(true);
      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'unlocked' });
      expect(getVaultNote(id)?.content).toEqual(paragraph('secret'));
    });

    it('can only be turned on while the vault is unlocked, and with a fingerprint', async () => {
      phone.next = ['canceled'];
      await expect(enableVaultBiometrics(prompt)).rejects.toBeInstanceOf(BiometricError);
      expect(vaultBiometrics.get()).toBe(false);
      expect(device.biometric).toBeNull();
      await lockVault();
      await expect(enableVaultBiometrics(prompt)).rejects.toThrow('locked');
    });

    it('leaves the PIN and password in charge when dismissed or locked out, and stays on', async () => {
      await setVaultPin('2468');
      await enableVaultBiometrics(prompt);
      await lockVault();
      for (const failure of ['canceled', 'fallback', 'lockout'] as const) {
        phone.next = [failure];
        expect(await unlockWithBiometrics(prompt)).toEqual({ result: failure });
        expect(vaultStatus.get()).toBe('locked');
        expect(vaultBiometrics.get()).toBe(true);
      }
      expect(await unlockWithPin('2468')).toEqual({ result: 'unlocked' });
      await lockVault();
      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'unlocked' });
    });

    it('turns off when the fingerprints change, and asks to come back once', async () => {
      await setVaultPin('2468');
      await enableVaultBiometrics(prompt);
      await lockVault();
      phone.next = ['invalidated'];
      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'invalidated' });
      expect(vaultBiometrics.get()).toBe(false);
      expect(device.biometric).toBeNull();
      expect(vaultBiometricsLost.get()).toBe(true);
      // The PIN is its own way in, and still works.
      expect(vaultPin.get()).not.toBeNull();
      expect(await unlockWithPin('2468')).toEqual({ result: 'unlocked' });
      await enableVaultBiometrics(prompt);
      expect(vaultBiometricsLost.get()).toBe(false);
      await lockVault();
      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'unlocked' });
    });

    it('turns off when its Keystore key is gone or opens another copy', async () => {
      await enableVaultBiometrics(prompt);
      await lockVault();
      phone.key = null;
      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'forgotten' });
      expect(vaultBiometrics.get()).toBe(false);
      expect(device.biometric).toBeNull();
      expect(vaultBiometricsLost.get()).toBe(false);
    });

    it('turns off for a vault deleted and set up again elsewhere', async () => {
      await enableVaultBiometrics(prompt);
      await lockVault();
      const vault = store.vault.get('user-1');
      if (vault) store.vault.insert({ ...vault, recoveryKey: 'another vault' });
      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'forgotten' });
      expect(device.biometric).toBeNull();
      expect(phone.key).toBeNull();
    });

    it('is turned off strictly, and with the vault, and by not locking', async () => {
      await enableVaultBiometrics(prompt);
      vi.mocked(forgetBiometricKey).mockRejectedValueOnce(new Error('undeletable'));
      await expect(removeVaultBiometrics()).rejects.toThrow('undeletable');
      expect(vaultBiometrics.get()).toBe(true);
      expect(device.biometric).not.toBeNull();
      await removeVaultBiometrics();
      expect(vaultBiometrics.get()).toBe(false);
      expect(device.biometric).toBeNull();
      expect(phone.key).toBeNull();

      // A vault that stays open needs neither the PIN nor the fingerprint.
      await setVaultPin('2468');
      await enableVaultBiometrics(prompt);
      await rememberVault(true);
      expect(vaultPin.get()).toBeNull();
      expect(vaultBiometrics.get()).toBe(false);
      expect(device.biometric).toBeNull();
      expect(phone.key).toBeNull();

      await rememberVault(false);
      await enableVaultBiometrics(prompt);
      await deleteVault();
      expect(vaultBiometrics.get()).toBe(false);
      expect(device.biometric).toBeNull();
      expect(phone.key).toBeNull();
    });

    it('locks sooner, as with a PIN', async () => {
      startVault();
      await enableVaultBiometrics(prompt);
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      page.visibility = 'hidden';
      page.fire('visibilitychange');
      vi.setSystemTime(Date.now() + 61_000);
      page.visibility = 'visible';
      page.fire('visibilitychange');
      await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));

      expect(await unlockWithBiometrics(prompt)).toEqual({ result: 'unlocked' });
      vi.advanceTimersByTime(5 * 60_000 + 15_000);
      await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));
    });
  });
});
