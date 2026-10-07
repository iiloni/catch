import { sql } from 'drizzle-orm';
import type { db } from '../db/client';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serialize hierarchy/color edits and multi-note Deck moves before their row locks. */
export async function lockTagTree(tx: Tx, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), 14001)`);
}
