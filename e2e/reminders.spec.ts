import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import {
  backToGallery,
  bearerToken,
  card,
  noteToolbar,
  openGalleryPage,
  openNote,
  seedNotes,
  signUp,
} from './helpers';

const panel = (page: Page) => page.getByRole('form', { name: 'Reminder' });
const step = (page: Page, name: string) => panel(page).getByRole('group', { name, exact: true });
/** Goes back from a page under the reminder, and waits for it to leave. */
async function leave(page: Page) {
  await panel(page).getByRole('button', { name: 'Back' }).click();
  await expect(panel(page).getByRole('button', { name: 'Back' })).toBeHidden();
}

/** Chooses a time on the time page, which follows the browser's twelve hour clock. */
async function pickTime(page: Page, hour: number, minute: number) {
  await step(page, 'Time')
    .getByRole('button', { name: /^Custom/ })
    .click();
  await panel(page)
    .locator(`[data-period="${hour >= 12 ? 'PM' : 'AM'}"]`)
    .click();
  await panel(page).locator(`[data-hour="${hour}"]`).click();
  await panel(page).locator(`[data-minute="${minute}"]`).click();
  await leave(page);
}
const pad = (value: number) => String(value).padStart(2, '0');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The repeat settings are a page of their own, behind the row saying what they are set to. */
const openRepeat = (page: Page) =>
  panel(page)
    .getByRole('button', { name: /^Repeat: / })
    .click();

test('a note is given a repeating reminder, which is then removed', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Call the dentist']);

  const editor = await openNote(page, 'Call the dentist');
  const bell = noteToolbar(page).getByRole('button', { name: 'Reminder' });
  await bell.click();
  // The reminder grows out of the dock, like the palette and the tags.
  await expect(page.locator('[data-note-toolbar]').locator(panel(page))).toBeVisible();
  // The 15th of next month, from the calendar that Custom slides in.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-15`;
  await step(page, 'Day').getByRole('button', { name: 'Custom' }).click();
  // On the last evening of a month the panel opens on tomorrow, and so on next month.
  const next = panel(page).getByRole('button', { name: 'Next month' });
  await expect(next).toBeVisible();
  const day = panel(page).locator(`[data-date="${date}"]`);
  if ((await day.count()) === 0) await next.click();
  await day.click();
  await expect(step(page, 'Day').getByRole('button', { name: /^Custom/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await pickTime(page, 9, 30);
  await openRepeat(page);
  await step(page, 'Repeat').getByRole('button', { name: 'Weekly' }).click();
  // A weekly reminder starts on its date's weekday.
  const weekday = start.getDay();
  const other = (weekday + 2) % 7;
  await expect(panel(page).getByRole('button', { name: WEEKDAYS[weekday] })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel(page).getByRole('button', { name: WEEKDAYS[other] }).click();
  await leave(page);
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(panel(page)).toBeHidden();

  // Setting a reminder leaves the note open, with the reminder under its text.
  const on = [weekday, other]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAYS[day]?.slice(0, 3))
    .join(', ');
  const chip = editor.getByRole('button', {
    name: new RegExp(`^Reminder: .*weekly on ${on}$`, 'i'),
  });
  await expect(chip).toContainText('9:30');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(
    card(page, 'Call the dentist').getByRole('img', { name: /^Reminder: / }),
  ).toBeVisible();

  // The server has it: it is still there after a reload, and on the Reminders page.
  await page.reload();
  await expect(
    card(page, 'Call the dentist').getByRole('img', { name: /^Reminder: / }),
  ).toBeVisible();
  await openGalleryPage(page, 'Reminders');
  await expect(card(page, 'Call the dentist')).toBeVisible();

  await openNote(page, 'Call the dentist');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Reminder: / })
    .click();
  await expect(panel(page).getByRole('button', { name: `Repeat: Weekly on ${on}` })).toBeVisible();
  await openRepeat(page);
  await expect(
    step(page, 'Repeat').getByRole('button', { name: 'Weekly', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await leave(page);
  await expect(step(page, 'Time').getByRole('button', { name: /^Custom/ })).toContainText('9:30');
  await panel(page).getByRole('button', { name: 'Remove reminder' }).click();
  await expect(page.getByText('Reminder removed')).toBeVisible();
  // While the panel folds away it is still the layer Escape closes.
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('No reminders')).toBeVisible();
  await backToGallery(page);
  await expect(
    card(page, 'Call the dentist').getByRole('img', { name: /^Reminder: / }),
  ).toHaveCount(0);
});

test('a reminder is set from the quick days and times', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Water the plants']);
  const editor = await openNote(page, 'Water the plants');
  await noteToolbar(page).getByRole('button', { name: 'Reminder' }).click();
  await step(page, 'Day').getByRole('button', { name: 'Tomorrow' }).click();
  await step(page, 'Time')
    .getByRole('button', { name: /^Evening/ })
    .click();
  await expect(panel(page).getByRole('status')).toContainText('Tomorrow');
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByRole('button', { name: /^Reminder: Tomorrow/ })).toBeVisible();
});

test('times follow the clock chosen in Settings', async ({ page, isMobile }) => {
  test.skip(
    isMobile,
    'The setting is the same on both layouts; the tests above open the panel on each.',
  );
  await signUp(page);
  await seedNotes(page, ['Call the vet']);
  await page.goto('/settings/general');
  await page.getByRole('button', { name: '24 hour' }).click();
  await page.goto('/');
  const editor = await openNote(page, 'Call the vet');
  await noteToolbar(page).getByRole('button', { name: 'Reminder' }).click();
  await step(page, 'Day').getByRole('button', { name: 'Tomorrow' }).click();
  await step(page, 'Time')
    .getByRole('button', { name: /^Custom/ })
    .click();
  await expect(panel(page).locator('[data-period]')).toHaveCount(0);
  await panel(page).locator('[data-hour="18"]').click();
  await panel(page).locator('[data-minute="30"]').click();
  await leave(page);
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByRole('button', { name: 'Reminder: Tomorrow, 18:30' })).toBeVisible();
});

test('a reminder is kept in a zone found by searching', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Ring Tokyo']);
  await openNote(page, 'Ring Tokyo');
  await noteToolbar(page).getByRole('button', { name: 'Reminder' }).click();
  await step(page, 'Day').getByRole('button', { name: 'Tomorrow' }).click();
  await step(page, 'Time zone').getByRole('button', { name: 'Custom' }).click();
  // The list opens on the zone in use, not at its top.
  await expect(panel(page).locator('[data-zone][aria-pressed="true"]')).toBeInViewport();
  await panel(page).getByRole('searchbox', { name: 'Search time zones' }).fill('tokyo');
  await expect(panel(page).locator('[data-zone]')).toHaveCount(1);
  await panel(page).locator('[data-zone="Asia/Tokyo"]').click();
  await expect(panel(page).getByRole('button', { name: 'Back' })).toBeHidden();
  await expect(
    step(page, 'Time zone').getByRole('button', { name: /^Custom\s*Tokyo, GMT\+9/ }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('a reminder for a time that has passed cannot be saved', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The panel is the same on both layouts; the tests above open it on each.');
  await signUp(page);
  await seedNotes(page, ['Water the plants']);
  await openNote(page, 'Water the plants');
  await noteToolbar(page).getByRole('button', { name: 'Reminder' }).click();
  // Late in the day the panel opens on tomorrow, so the day is chosen too. Midnight today
  // is behind us.
  await step(page, 'Day').getByRole('button', { name: 'Today' }).click();
  await pickTime(page, 0, 0);
  await expect(panel(page).getByRole('status')).toContainText('That time has passed');
  const save = panel(page).getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  // A repeating reminder may start in the past: it rings at its next time.
  await openRepeat(page);
  await step(page, 'Repeat').getByRole('button', { name: 'Daily' }).click();
  await leave(page);
  await expect(save).toBeEnabled();
});

const shapeRows = z.array(
  z.object({
    key: z.string().optional(),
    value: z.record(z.string(), z.unknown()).optional(),
    headers: z.object({ operation: z.string().optional() }).optional(),
  }),
);

async function account(
  playwright: typeof import('@playwright/test').request,
  options: { baseURL?: string; extraHTTPHeaders?: Record<string, string> },
) {
  // A context each, so neither account's session cookie rides along with the other's token.
  const context = await playwright.newContext(options);
  const response = await context.post('/api/auth/sign-up/email', {
    headers: { Origin: 'https://localhost' },
    data: {
      email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: '',
      password: 'password123',
    },
  });
  expect(response.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${bearerToken(response)}` };
  return { context, headers };
}

const noteId = () => crypto.randomUUID().replace(/^(.{14})./, '$17');

/** The account's reminder for a note as its shape syncs it, or null when it has none. */
async function syncedReminder(
  context: APIRequestContext,
  headers: Record<string, string>,
  id: string,
) {
  const rows: Record<string, unknown>[] = [];
  let offset = '-1';
  let handle = '';
  // The first request is the snapshot from when the shape was made; later ones its changes.
  for (let request = 0; request < 20; request += 1) {
    const shape = await context.get(
      `/api/shapes/reminders?offset=${offset}${handle ? `&handle=${handle}` : ''}`,
      { headers },
    );
    expect(shape.ok()).toBeTruthy();
    const body = shapeRows.parse(await shape.json());
    for (const row of body) {
      const operation = row.headers?.operation;
      const index = rows.findIndex((item) => item.key === row.key);
      // A delete carries its key and no value.
      if (operation === 'delete') {
        if (index >= 0) rows.splice(index, 1);
        continue;
      }
      if (!row.value) continue;
      if (index >= 0) {
        rows[index] = { ...rows[index], ...row.value };
      } else {
        rows.push({ key: row.key, ...row.value });
      }
    }
    offset = shape.headers()['electric-offset'] ?? offset;
    handle = shape.headers()['electric-handle'] ?? handle;
    if (shape.headers()['electric-up-to-date'] !== undefined) break;
  }
  return rows.find((row) => row.note_id === id) ?? null;
}

const local = (date: Date) =>
  `${date.toISOString().slice(0, 10)}T${date.toISOString().slice(11, 16)}`;

test('reminders belong to their note’s owner and replay safely', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  const alice = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const bob = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const id = noteId();
  expect(
    (
      await alice.context.post('/api/notes', { headers: alice.headers, data: { id, content: [] } })
    ).status(),
  ).toBe(201);

  const daily = {
    kind: 'time',
    startsAt: '2020-01-01T07:15',
    timeZone: 'UTC',
    floating: false,
    recurrence: { frequency: 'daily', interval: 1 },
    snoozedUntil: null,
  };
  const save = (who: typeof alice, data: object) =>
    who.context.put(`/api/reminders/${id}`, { headers: who.headers, data });

  const anonymous = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
  expect((await anonymous.put(`/api/reminders/${id}`, { data: daily })).status()).toBe(401);
  expect((await save(bob, daily)).status()).toBe(404);
  expect((await save(alice, { ...daily, timeZone: 'Mars/Olympus' })).status()).toBe(400);
  expect((await save(alice, { ...daily, startsAt: '2020-02-30T07:15' })).status()).toBe(400);
  expect(await syncedReminder(alice.context, alice.headers, id)).toBeNull();

  // The same queued write sent twice leaves one reminder, waiting for its next time.
  expect((await save(alice, daily)).ok()).toBeTruthy();
  expect((await save(alice, daily)).ok()).toBeTruthy();
  const saved = await syncedReminder(alice.context, alice.headers, id);
  expect(saved).toMatchObject({ starts_at: '2020-01-01T07:15', fired_at: null });
  expect(String(saved?.next_at) > local(new Date(Date.now() - 86_400_000))).toBe(true);
  expect(String(saved?.next_at)).toMatch(/T07:15$/);
  // The scheduler's own column stays on the server.
  expect(saved).not.toHaveProperty('fire_at');
  expect(await syncedReminder(bob.context, bob.headers, id)).toBeNull();

  // A one-off whose time has passed has nothing to wait for.
  expect((await save(alice, { ...daily, recurrence: null })).ok()).toBeTruthy();
  expect(await syncedReminder(alice.context, alice.headers, id)).toMatchObject({ next_at: null });

  expect(
    (await bob.context.delete(`/api/reminders/${id}`, { headers: bob.headers })).ok(),
  ).toBeTruthy();
  expect(await syncedReminder(alice.context, alice.headers, id)).not.toBeNull();
  const remove = () => alice.context.delete(`/api/reminders/${id}`, { headers: alice.headers });
  expect(await (await remove()).json()).toEqual({ txid: expect.any(Number) });
  expect(await (await remove()).json()).toEqual({ txid: null });

  // Deleting the note takes its reminder with it.
  expect((await save(alice, daily)).ok()).toBeTruthy();
  expect(
    (await alice.context.delete(`/api/notes/${id}`, { headers: alice.headers })).ok(),
  ).toBeTruthy();
  expect(await syncedReminder(alice.context, alice.headers, id)).toBeNull();
});

test('the Android app is told what to ring, and only for its own user', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  const alice = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const bob = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const id = noteId();
  await alice.context.post('/api/notes', {
    headers: alice.headers,
    data: {
      id,
      content: [
        { type: 'paragraph', content: 'Water the plants' },
        { type: 'paragraph', content: 'The fern too' },
      ],
    },
  });
  const alarms = async (who: typeof alice) =>
    (await (await who.context.get('/api/reminders/alarms', { headers: who.headers })).json())
      .alarms;
  const save = (data: object) =>
    alice.context.put(`/api/reminders/${id}`, {
      headers: alice.headers,
      data: { kind: 'time', startsAt: '2020-01-01T07:15', snoozedUntil: null, ...data },
    });

  const anonymous = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
  expect((await anonymous.get('/api/reminders/alarms')).status()).toBe(401);
  expect(await alarms(alice)).toEqual([]);

  // A reminder that follows the user carries no zone: the phone reads it where it is.
  const daily = { frequency: 'daily', interval: 1 };
  expect((await save({ timeZone: 'UTC', floating: true, recurrence: daily })).ok()).toBeTruthy();
  const [alarm, ...others] = await alarms(alice);
  expect(others).toEqual([]);
  expect(alarm).toMatchObject({
    noteId: id,
    title: 'Water the plants',
    body: 'The fern too',
    timeZone: null,
    snoozedUntil: null,
  });
  expect(alarm.times).toHaveLength(16);
  expect(alarm.times.every((time: string) => time.endsWith('T07:15'))).toBe(true);
  expect([...alarm.times].sort()).toEqual(alarm.times);
  expect(await alarms(bob)).toEqual([]);

  expect(
    (await save({ timeZone: 'Asia/Tokyo', floating: false, recurrence: daily })).ok(),
  ).toBeTruthy();
  expect((await alarms(alice))[0]).toMatchObject({ timeZone: 'Asia/Tokyo' });

  // A one-off whose time has passed has nothing left to ring.
  expect((await save({ timeZone: 'UTC', floating: false, recurrence: null })).ok()).toBeTruthy();
  expect(await alarms(alice)).toEqual([]);
});

test('the server rings a reminder when it comes due and moves it on', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  const { context, headers } = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const id = noteId();
  await context.post('/api/notes', { headers, data: { id, content: [] } });
  // Due this minute, repeating daily.
  const startsAt = local(new Date());
  const saved = await context.put(`/api/reminders/${id}`, {
    headers,
    data: {
      kind: 'time',
      startsAt,
      timeZone: 'UTC',
      floating: false,
      recurrence: { frequency: 'daily', interval: 1 },
      snoozedUntil: null,
    },
  });
  expect(saved.ok()).toBeTruthy();
  await expect
    .poll(async () => (await syncedReminder(context, headers, id))?.fired_at ?? null, {
      timeout: 30_000,
    })
    .not.toBeNull();
  const next = local(new Date(Date.parse(`${startsAt}:00Z`) + 86_400_000));
  expect(await syncedReminder(context, headers, id)).toMatchObject({ next_at: next });

  // The save sent again after it rang (its answer was lost) must not ring it a second time.
  const rang = (await syncedReminder(context, headers, id))?.fired_at;
  const replay = await context.put(`/api/reminders/${id}`, {
    headers,
    data: {
      kind: 'time',
      startsAt,
      timeZone: 'UTC',
      floating: false,
      recurrence: { frequency: 'daily', interval: 1 },
      snoozedUntil: null,
    },
  });
  expect(await replay.json()).toEqual({ txid: null });
  expect(await syncedReminder(context, headers, id)).toMatchObject({
    next_at: next,
    fired_at: rang,
  });
});

test('floating reminders follow the zone a device reports', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  const { context, headers } = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const zone = async (data: object) =>
    (await (await context.put('/api/reminders/time-zone', { headers, data })).json()).timeZone;
  expect(await zone({ timeZone: 'Europe/London', changed: false })).toBe('Europe/London');
  // A second device only saying where it is does not move the user.
  expect(await zone({ timeZone: 'Asia/Tokyo', changed: false })).toBe('Europe/London');
  expect(await zone({ timeZone: 'Asia/Tokyo', changed: true })).toBe('Asia/Tokyo');
  expect(
    (
      await context.put('/api/reminders/time-zone', {
        headers,
        data: { timeZone: 'Nowhere/Land', changed: true },
      })
    ).status(),
  ).toBe(400);
});

test('quick times are kept per user', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  const alice = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const bob = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const settings = async (who: typeof alice) =>
    (await who.context.get('/api/reminders/settings', { headers: who.headers })).json();
  const defaults = { morning: '08:00', afternoon: '13:00', evening: '18:00' };
  expect(await settings(alice)).toEqual({ timeZone: null, times: defaults });

  const times = { morning: '06:30', afternoon: '12:00', evening: '20:15' };
  const save = (data: object) =>
    alice.context.put('/api/reminders/settings/times', { headers: alice.headers, data });
  expect((await save({ times: { ...times, evening: '25:00' }, timeZone: 'UTC' })).status()).toBe(
    400,
  );
  expect((await save({ times, timeZone: 'Europe/London' })).ok()).toBeTruthy();
  expect(await settings(alice)).toEqual({ timeZone: 'Europe/London', times });
  expect(await settings(bob)).toEqual({ timeZone: null, times: defaults });

  // Saving times is not a report of where the user is: the zone a device reported stays.
  expect((await save({ times: defaults, timeZone: 'Asia/Tokyo' })).ok()).toBeTruthy();
  expect(await settings(alice)).toEqual({ timeZone: 'Europe/London', times: defaults });
  // And reporting a zone leaves the times alone.
  expect((await save({ times, timeZone: 'Europe/London' })).ok()).toBeTruthy();
  await alice.context.put('/api/reminders/time-zone', {
    headers: alice.headers,
    data: { timeZone: 'Asia/Tokyo', changed: true },
  });
  expect(await settings(alice)).toEqual({ timeZone: 'Asia/Tokyo', times });
});

test('push subscriptions only go to browser push services', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  const { context, headers } = await account(playwright.request, { baseURL, extraHTTPHeaders });
  const anonymous = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
  expect((await anonymous.get('/api/push/key')).status()).toBe(401);
  const key = z
    .object({ publicKey: z.string() })
    .parse(await (await context.get('/api/push/key', { headers })).json());
  // An uncompressed P-256 point, as `pushManager.subscribe` takes it.
  expect(Buffer.from(key.publicKey, 'base64url')).toHaveLength(65);
  expect(
    z
      .object({ publicKey: z.string() })
      .parse(await (await context.get('/api/push/key', { headers })).json()),
  ).toEqual(key);

  const keys = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
  // Keys no browser could have made are turned away.
  expect(
    (
      await context.post('/api/push/subscriptions', {
        headers,
        data: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/short',
          keys: { ...keys, auth: 'c2VjcmV0' },
        },
      })
    ).status(),
  ).toBe(400);
  const subscribe = (endpoint: string) =>
    context.post('/api/push/subscriptions', { headers, data: { endpoint, keys } });
  // The server posts to a subscription's endpoint, so it must be a push service's.
  for (const endpoint of [
    'https://example.com/push',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://localhost/push',
    'https://169.254.169.254/latest',
  ]) {
    expect((await subscribe(endpoint)).status()).toBe(400);
  }
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`;
  expect((await subscribe(endpoint)).ok()).toBeTruthy();
  expect((await subscribe(endpoint)).ok()).toBeTruthy();
  expect(
    (await context.delete('/api/push/subscriptions', { headers, data: { endpoint } })).ok(),
  ).toBeTruthy();
  // With no subscription left there is nowhere to send a test.
  expect(
    await (await context.post('/api/push/test', { headers, data: { endpoint } })).json(),
  ).toEqual({ sent: 0 });
});
