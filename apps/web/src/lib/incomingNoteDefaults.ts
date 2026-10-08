import {
  DEFAULT_BOARD_STATUS,
  normalizeSecondaryTags,
  noteColorSchema,
  noteStatusSchema,
} from '@catch/shared';
import { z } from 'zod';
import { getSignedInUser } from './auth';
import { boardColumnsCollection, tagsCollection } from './collections';
import { usePersistentState } from './storage';

const defaultsSchema = z.object({
  status: noteStatusSchema.default(null),
  color: noteColorSchema.default('default'),
  primaryTagId: z.uuid({ version: 'v7' }).nullable().default(null),
  secondaryTagIds: z.array(z.uuid({ version: 'v7' })).default([]),
});
export type IncomingNoteDefaults = z.infer<typeof defaultsSchema>;
const fallback = defaultsSchema.parse({});

export const incomingNoteDefaultsKey = (userId: string) => `catch-incoming-note-defaults:${userId}`;

/** Null is Gallery; a column id keeps following that column when it is renamed. */
export function useIncomingNoteDefaults() {
  return usePersistentState(
    incomingNoteDefaultsKey(getSignedInUser()?.id ?? ''),
    defaultsSchema,
    fallback,
  );
}

/** Read at creation time, after device columns have hydrated, including in another window. */
export function incomingNoteDefaults(userId: string): IncomingNoteDefaults {
  try {
    const parsed = defaultsSchema.safeParse(
      JSON.parse(localStorage.getItem(incomingNoteDefaultsKey(userId)) ?? '{}'),
    );
    if (!parsed.success) return fallback;
    const defaults = parsed.data;
    const primaryTagId =
      defaults.primaryTagId && tagsCollection.has(defaults.primaryTagId)
        ? defaults.primaryTagId
        : null;
    return {
      status:
        defaults.status === null || boardColumnsCollection.has(defaults.status)
          ? defaults.status
          : DEFAULT_BOARD_STATUS,
      color: primaryTagId ? 'default' : defaults.color,
      primaryTagId,
      secondaryTagIds: normalizeSecondaryTags(
        [...tagsCollection.values()],
        defaults.secondaryTagIds.filter((id) => id !== primaryTagId && tagsCollection.has(id)),
      ),
    };
  } catch {
    return fallback;
  }
}
