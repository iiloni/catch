import {
  type PushKey,
  pushSubscriptionSchema,
  removePushSubscriptionSchema,
  type TestPushResponse,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { requireUser } from '../lib/requireUser';
import { notifyUser, removeSubscription, saveSubscription, vapidKeys } from '../push';
import { isPushEndpoint } from '../push/webPush';

/** The browsers each user gets notifications on (ADR 0016). */
export const pushRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/key', async (c) => c.json({ publicKey: (await vapidKeys()).publicKey } satisfies PushKey))
  .post('/subscriptions', zValidator('json', pushSubscriptionSchema), async (c) => {
    const subscription = c.req.valid('json');
    if (!isPushEndpoint(subscription.endpoint)) {
      return c.json({ error: 'This browser uses a push service Catch does not know.' }, 400);
    }
    await saveSubscription(c.get('user')!.id, subscription);
    return c.json({ ok: true });
  })
  .delete('/subscriptions', zValidator('json', removePushSubscriptionSchema), async (c) => {
    await removeSubscription(c.get('user')!.id, c.req.valid('json').endpoint);
    return c.json({ ok: true });
  })
  .post('/test', zValidator('json', removePushSubscriptionSchema), async (c) => {
    const sent = await notifyUser(
      c.get('user')!.id,
      {
        type: 'test',
        noteId: null,
        title: 'Catch notifications are on',
        body: 'Reminders will show up here.',
      },
      c.req.valid('json').endpoint,
    );
    return c.json({ sent } satisfies TestPushResponse);
  });
