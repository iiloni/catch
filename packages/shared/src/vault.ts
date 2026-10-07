import { z } from 'zod';
import { attachmentSchema } from './attachments';
import { noteColorSchema, noteContentSchema, notePositionSchema, noteStatusSchema } from './notes';

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

/**
 * A file in a vault note. Its bytes are an attachment row like any other, sealed on the
 * device; what the file is called and what it is are known only here, inside the note.
 */
export const vaultFileSchema = attachmentSchema
  .pick({ id: true, name: true, mimeType: true, size: true, kind: true, createdAt: true })
  .extend({
    /** The attachment that holds a sealed thumbnail the device made, if it could make one. */
    thumbnailId: z.uuid({ version: 'v7' }).nullable(),
    /** What the bytes were sealed as. A copy of the note has new ids and the same bytes. */
    sealId: z.uuid({ version: 'v7' }),
  });
export type VaultFile = z.infer<typeof vaultFileSchema>;

/** What the server is told of a vault file in place of its name and type. */
export const VAULT_FILE_NAME = 'Vault file';
export const VAULT_FILE_TYPE = 'application/octet-stream';

/**
 * What a vault note's `data` holds once opened. Only devices with the vault key see it, so
 * where a note is kept and what it is tagged with stay private as well as its words.
 */
export const vaultNotePayloadSchema = z.object({
  v: z.literal(1),
  content: noteContentSchema,
  color: noteColorSchema,
  status: noteStatusSchema,
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  position: notePositionSchema,
  deletedAt: z.coerce.date().nullable(),
  /** When the note was last edited, by its device's clock: the server's time is of the last save. */
  updatedAt: z.coerce.date(),
  /** The note's tags. The tags themselves are the user's ordinary ones. */
  primaryTagId: z.uuid({ version: 'v7' }).nullable(),
  secondaryTagIds: z.array(z.uuid({ version: 'v7' })),
  files: z.array(vaultFileSchema),
});
export type VaultNotePayload = z.infer<typeof vaultNotePayloadSchema>;

/** What a vault note's reminder says when it rings: the server cannot read the note. */
export const VAULT_REMINDER_TEXT = 'Vault note';
