import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect } from 'react';
import { z } from 'zod';
import { createStore } from './store';
import { fromBase64, toBase64 } from './vaultCrypto';

/**
 * Fingerprint unlock for the vault on the Android app (ADR 0020, `VaultKeyPlugin.java`). The
 * phone seals the vault key under a Keystore key only a strong biometric opens; the app keeps
 * the sealed copy (`vaultKeyStore.ts`).
 */

type Prompt = { title: string; cancel: string };

const VaultKey = registerPlugin<{
  available(): Promise<unknown>;
  enable(options: { userId: string; key: string } & Prompt): Promise<unknown>;
  open(options: { userId: string; iv: string; sealed: string } & Prompt): Promise<unknown>;
  forget(options: { userId: string }): Promise<void>;
}>('VaultKey');

/** Whether this app can ask for a fingerprint at all: the Android app only. */
export const biometricsSupported = () => Capacitor.getPlatform() === 'android';

/** How to name the phone's biometric: many phones' face unlock is not strong enough to count. */
export type BiometricKind = 'fingerprint' | 'biometrics';

const availabilitySchema = z.object({
  available: z.boolean(),
  kind: z.enum(['fingerprint', 'biometrics']),
});

/** Whether a strong biometric is enrolled here, or null where there is none to ask for. */
export async function biometricAvailability() {
  if (!biometricsSupported()) return null;
  try {
    return availabilitySchema.parse(await VaultKey.available());
  } catch {
    return null;
  }
}

const availability = createStore<z.infer<typeof availabilitySchema> | null>(null);

/**
 * Whether a strong biometric is enrolled here, and what to call it; null on the web. Read
 * again whenever a caller mounts, since one may have been enrolled meanwhile.
 */
export function useBiometricAvailability() {
  useEffect(() => {
    void biometricAvailability().then(availability.set);
  }, []);
  return availability.use();
}

/** What the forms call the phone's biometric. */
export const biometricWords = (kind: BiometricKind | undefined) =>
  kind === 'biometrics'
    ? {
        name: 'biometrics',
        unlock: 'Unlock with biometrics',
        use: 'Use biometrics',
        feature: 'biometric unlock',
        Feature: 'Biometric unlock',
        changed: 'Biometrics changed',
      }
    : {
        name: 'fingerprint',
        unlock: 'Unlock with fingerprint',
        use: 'Use fingerprint',
        feature: 'fingerprint unlock',
        Feature: 'Fingerprint unlock',
        changed: 'Fingerprints changed',
      };

export type BiometricFailure =
  /** Dismissed, or the app was not in front. */
  | 'canceled'
  /** The prompt's own button, which offers the PIN or password. */
  | 'fallback'
  /** Too many tries: the phone has stopped taking fingerprints for a while. */
  | 'lockout'
  /** A fingerprint was added or removed, which voids the Keystore key. */
  | 'invalidated'
  /** The Keystore key is missing, or the sealed copy does not open with it. */
  | 'gone'
  /** No strong biometric is enrolled, or the sensor is out of use. */
  | 'unavailable'
  | 'failed';

export class BiometricError extends Error {
  constructor(readonly reason: BiometricFailure) {
    super(`Fingerprint unlock: ${reason}`);
  }
}

const failures = new Set<string>([
  'canceled',
  'fallback',
  'lockout',
  'invalidated',
  'unavailable',
  'failed',
]);
function reason(error: unknown): BiometricFailure {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'busy') return 'canceled';
  if (code === 'gone' || code === 'damaged') return 'gone';
  return typeof code === 'string' && failures.has(code) ? (code as BiometricFailure) : 'failed';
}

async function call<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    throw new BiometricError(reason(error));
  }
}

const sealedSchema = z.object({ iv: z.string().min(1), sealed: z.string().min(1) });
export type BiometricSeal = z.infer<typeof sealedSchema>;

/** Seals the vault key under a new Keystore key, after a fingerprint confirms it. */
export async function sealWithBiometrics(userId: string, key: Uint8Array, prompt: Prompt) {
  const result = await call(() => VaultKey.enable({ userId, key: toBase64(key), ...prompt }));
  return sealedSchema.parse(result);
}

const openedSchema = z.object({ key: z.string() });

/** Opens the vault key with a fingerprint. */
export async function openWithBiometrics(userId: string, sealed: BiometricSeal, prompt: Prompt) {
  const result = await call(() => VaultKey.open({ userId, ...sealed, ...prompt }));
  const parsed = openedSchema.safeParse(result);
  const key = parsed.success ? fromBase64(parsed.data.key) : null;
  if (key?.length !== 32) throw new BiometricError('gone');
  return key;
}

/** Deletes the account's Keystore key, so no sealed copy of the vault key opens again. */
export async function forgetBiometricKey(userId: string) {
  if (!biometricsSupported()) return;
  await call(() => VaultKey.forget({ userId }));
}
