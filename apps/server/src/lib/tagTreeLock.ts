import { sql } from 'drizzle-orm';
import type { db } from '../db/client';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serialize hierarchy and primary/color edits against the user's current assignments. */
export async function lockTagTree(tx: Tx, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), 14001)`);
}
