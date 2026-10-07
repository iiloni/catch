import { z } from 'zod';
import { noteColorSchema, noteContentSchema, notePositionSchema } from './notes';

/**
 * The vault (ADR 0020): notes encrypted on the device, so the server stores and syncs only
 * ciphertext. Everything here that is not a key parameter is opaque to the server.
 */

/** Standard base64, as `btoa` writes it. */
const base64 = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/);

/** PBKDF2-SHA256 rounds a new vault uses. Stored with the vault, so it can rise later. */
export const VAULT_KDF_ITERATIONS = 600_000;

/** A sealed vault key: a 12 byte nonce, the 32 byte key and a 16 byte tag. */
const wrappedKeySchema = base64(128);

/**
 * A user's vault: its key, sealed once under the vault password and once under the recovery
 * key. The server cannot open either.
 */
export const vaultSchema = z.object({
  userId: z.string(),
  /** The salt the password's key is derived with. */
  salt: base64(128),
  iterations: z.number().int().min(100_000).max(10_000_000),
  passwordKey: wrappedKeySchema,
  recoveryKey: wrappedKeySchema,
  updatedAt: z.coerce.date(),
});
export type Vault = z.infer<typeof vaultSchema>;

/** Creates the vault, or replaces how its key is sealed (a new password or recovery key). */
export const saveVaultSchema = vaultSchema.pick({
  salt: true,
  iterations: true,
  passwordKey: true,
  recoveryKey: true,
});
export type SaveVault = z.infer<typeof saveVaultSchema>;

/** The most a sealed note may weigh, in base64 characters. */
export const MAX_VAULT_NOTE_DATA = 8 * 1024 * 1024;

/** A vault note as the server and the device's database hold it. */
export const vaultNoteSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  userId: z.string(),
  /** A 12 byte nonce followed by the sealed `VaultNotePayload`. */
  data: base64(MAX_VAULT_NOTE_DATA),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type VaultNote = z.infer<typeof vaultNoteSchema>;

export const createVaultNoteSchema = vaultNoteSchema
  .pick({ id: true, data: true, createdAt: true })
  .partial({ createdAt: true });
export type CreateVaultNote = z.infer<typeof createVaultNoteSchema>;

export const updateVaultNoteSchema = vaultNoteSchema.pick({ data: true });
export type UpdateVaultNote = z.infer<typeof updateVaultNoteSchema>;

/** What a vault note's `data` holds once opened. Only devices with the vault key see it. */
export const vaultNotePayloadSchema = z.object({
  v: z.literal(1),
  content: noteContentSchema,
  color: noteColorSchema,
  isPinned: z.boolean(),
  position: notePositionSchema,
});
export type VaultNotePayload = z.infer<typeof vaultNotePayloadSchema>;
