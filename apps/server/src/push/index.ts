import type { PushMessage, PushSubscriptionInput } from '@catch/shared';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { pushKeys, pushSubscriptions } from '../db/schema';
import { env } from '../env';
import { generateVapidKeys, sendPush, type VapidKeys } from './webPush';

const KEY_ID = 'vapid';
let cachedKeys: VapidKeys | null = null;

/** This server's push identity, made the first time it is asked for. */
export async function vapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  // Two requests racing to make the first pair both read back whichever one landed.
  await db
    .insert(pushKeys)
    .values({ id: KEY_ID, ...generateVapidKeys() })
    .onConflictDoNothing();
  const [row] = await db.select().from(pushKeys).where(eq(pushKeys.id, KEY_ID));
  if (!row) throw new Error('Could not read the push keys');
  cachedKeys = { publicKey: row.publicKey, privateKey: row.privateKey };
  return cachedKeys;
}

/** A restore may bring back another server's key pair. */
export function forgetVapidKeys() {
  cachedKeys = null;
}

/**
 * Who a push service can write to about this server. Apple refuses tokens whose contact is
 * not a real-looking address, so an HTTP development server falls back to a mailbox.
 */
function contact() {
  if (env.PUSH_CONTACT) return env.PUSH_CONTACT;
  const url = new URL(env.BETTER_AUTH_URL);
  return url.protocol === 'https:' ? url.origin : 'mailto:catch@example.com';
}

export async function saveSubscription(userId: string, subscription: PushSubscriptionInput) {
  const values = {
    endpoint: subscription.endpoint,
    userId,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };
  // An endpoint is one browser. Whoever signed in on it last gets its notifications.
  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/**
 * Sends a message to a user's browsers (or to one of them), dropping the subscriptions
 * their push service no longer knows. Returns how many took it.
 */
export async function notifyUser(userId: string, message: PushMessage, endpoint?: string) {
  const targets = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        endpoint ? eq(pushSubscriptions.endpoint, endpoint) : undefined,
      ),
    );
  if (targets.length === 0) return 0;
  const keys = await vapidKeys();
  const payload = Buffer.from(JSON.stringify(message));
  const results = await Promise.all(
    targets.map(async (target) => {
      try {
        const result = await sendPush(target, payload, keys, contact());
        if (result === 'gone') {
          // Only this user's: the browser may have been signed in to by someone else since.
          await removeSubscription(target.userId, target.endpoint);
        }
        return result === 'sent';
      } catch (error) {
        console.error(
          `Could not send a notification through ${new URL(target.endpoint).host}`,
          error,
        );
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
