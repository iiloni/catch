import { type APIRequestContext, expect, test } from '@playwright/test';
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

test('a note is given a repeating reminder, which is then removed', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Call the dentist']);

  const editor = await openNote(page, 'Call the dentist');
  await noteToolbar(page).getByRole('button', { name: 'Remind me' }).click();
  const sheet = page.getByRole('dialog', { name: 'Remind me' });
  await sheet.getByLabel('Date', { exact: true }).fill('2031-03-04');
  await sheet.getByLabel('Time', { exact: true }).fill('09:30');
  await sheet.getByLabel('Repeat').selectOption('Weekly');
  // 2031-03-04 is a Tuesday, which a weekly reminder starts on.
  await expect(sheet.getByRole('button', { name: 'Tuesday' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet.getByRole('button', { name: 'Thursday' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();

  // Setting a reminder leaves the note open, with the reminder under its text.
  const chip = editor.getByRole('button', { name: /^Reminder: .*weekly on tue, thu$/i });
  await expect(chip).toContainText('2031');
  await expect(noteToolbar(page).getByRole('button', { name: 'Change reminder' })).toBeVisible();
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
  await expect(sheet.getByLabel('Repeat')).toHaveValue('weekly');
  await expect(sheet.getByLabel('Time', { exact: true })).toHaveValue('09:30');
  await sheet.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Reminder removed')).toBeVisible();
  // While the sheet slides away it is still the layer Escape closes.
  await expect(sheet).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('No reminders')).toBeVisible();
  await backToGallery(page);
  await expect(
    card(page, 'Call the dentist').getByRole('img', { name: /^Reminder: / }),
  ).toHaveCount(0);
});

test('a reminder for a time that has passed cannot be saved', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The sheet is the same on both layouts; the test above opens it on each.');
  await signUp(page);
  await seedNotes(page, ['Water the plants']);
  await openNote(page, 'Water the plants');
  await noteToolbar(page).getByRole('button', { name: 'Remind me' }).click();
  const sheet = page.getByRole('dialog', { name: 'Remind me' });
  await sheet.getByLabel('Date', { exact: true }).fill('2020-01-01');
  await expect(sheet.getByRole('alert')).toContainText('That time has passed');
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  // A repeating reminder may start in the past: it rings at its next time.
  await sheet.getByLabel('Repeat').selectOption('Daily');
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeEnabled();
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
      if (!row.value) continue;
      const operation = row.headers?.operation;
      const index = rows.findIndex((item) => item.key === row.key);
      if (operation === 'delete') {
        if (index >= 0) rows.splice(index, 1);
      } else if (index >= 0) {
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

  const keys = { p256dh: 'BPk', auth: 'c2VjcmV0' };
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
