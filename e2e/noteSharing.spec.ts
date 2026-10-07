import { type APIRequestContext, expect, test } from '@playwright/test';
import { z } from 'zod';
import { sharedNoteViewSchema } from '../packages/shared/src/sharing';
import { bearerToken, card, noteAction, seedNotes, signUp } from './helpers';

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
  name = '',
) {
  // A context each, so neither account's session cookie rides along with the other's token.
  const context = await playwright.newContext(options);
  const response = await context.post('/api/auth/sign-up/email', {
    headers: { Origin: 'https://localhost' },
    data: {
      email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name,
      password: 'password123',
    },
  });
  expect(response.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${bearerToken(response)}` };
  return { context, headers };
}

const noteId = () => crypto.randomUUID().replace(/^(.{14})./, '$17');
const shareToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/** The rows of one of the account's shapes, as a device that has caught up holds them. */
async function syncedRows(
  context: APIRequestContext,
  headers: Record<string, string>,
  shape: string,
) {
  const rows: Record<string, unknown>[] = [];
  let offset = '-1';
  let handle = '';
  // The first request is the snapshot from when the shape was made; later ones its changes.
  for (let request = 0; request < 20; request += 1) {
    const response = await context.get(
      `/api/shapes/${shape}?offset=${offset}${handle ? `&handle=${handle}` : ''}`,
      { headers },
    );
    expect(response.ok()).toBeTruthy();
    for (const row of shapeRows.parse(await response.json())) {
      const index = rows.findIndex((item) => item.key === row.key);
      // A delete carries its key and no value.
      if (row.headers?.operation === 'delete') {
        if (index >= 0) rows.splice(index, 1);
        continue;
      }
      if (!row.value) continue;
      if (index >= 0) rows[index] = { ...rows[index], ...row.value };
      else rows.push({ key: row.key, ...row.value });
    }
    offset = response.headers()['electric-offset'] ?? offset;
    handle = response.headers()['electric-handle'] ?? handle;
    if (response.headers()['electric-up-to-date'] !== undefined) break;
  }
  return rows;
}

const paragraph = (text: string) => [{ type: 'paragraph', content: text }];

test('a share link is read without an account and added by one, until it is ended', {
  tag: '@api',
}, async ({ playwright, baseURL, extraHTTPHeaders }) => {
  const options = { baseURL, extraHTTPHeaders };
  const alice = await account(playwright.request, options, 'Alice');
  const bob = await account(playwright.request, options);
  const anonymous = await playwright.request.newContext(options);
  const id = noteId();
  const token = shareToken();
  await alice.context.post('/api/notes', {
    headers: alice.headers,
    data: { id, content: paragraph('Trip plan'), color: 'blue' },
  });

  const share = (who: typeof alice, note: string, value: string) =>
    who.context.put(`/api/note-shares/${note}`, { headers: who.headers, data: { token: value } });
  const read = (context: APIRequestContext, headers?: Record<string, string>) =>
    context.get(`/api/shares/${token}`, { headers });

  // Nothing is shared until its owner says so, and only its owner can.
  expect((await read(anonymous)).status()).toBe(404);
  expect((await anonymous.put(`/api/note-shares/${id}`, { data: { token } })).status()).toBe(401);
  expect((await share(bob, id, token)).status()).toBe(404);
  expect((await share(alice, id, 'too-short')).status()).toBe(400);

  const created = await share(alice, id, token);
  expect(created.ok()).toBeTruthy();
  expect((await created.json()).txid).toEqual(expect.any(Number));
  // A queued write sent again, and a second device sharing the same note, change nothing.
  expect(await (await share(alice, id, token)).json()).toEqual({ txid: null });
  expect(await (await share(alice, id, shareToken())).json()).toEqual({ txid: null });
  // One token opens one note.
  const other = noteId();
  await alice.context.post('/api/notes', {
    headers: alice.headers,
    data: { id: other, content: [] },
  });
  expect((await share(alice, other, token)).status()).toBe(409);
  expect(await syncedRows(alice.context, alice.headers, 'note-shares')).toEqual([
    expect.objectContaining({ note_id: id, token }),
  ]);

  const guestView = await read(anonymous);
  expect(guestView.status()).toBe(200);
  expect(guestView.headers()['cache-control']).toContain('no-store');
  expect(sharedNoteViewSchema.parse(await guestView.json())).toMatchObject({
    noteId: id,
    ownerName: 'Alice',
    content: paragraph('Trip plan'),
    color: 'blue',
    attachments: [],
    viewer: 'guest',
  });
  expect((await (await read(alice.context, alice.headers)).json()).viewer).toBe('owner');
  expect((await (await read(bob.context, bob.headers)).json()).viewer).toBe('user');

  // Adding takes an account. The owner already has the note.
  expect((await anonymous.post(`/api/shares/${token}/accept`)).status()).toBe(401);
  const accept = (who: typeof alice) =>
    who.context.post(`/api/shares/${token}/accept`, { headers: who.headers });
  expect(await (await accept(alice)).json()).toEqual({ noteId: id, txid: null });
  const accepted = await (await accept(bob)).json();
  expect(accepted).toEqual({ noteId: id, txid: expect.any(Number) });
  expect(await (await accept(bob)).json()).toEqual({ noteId: id, txid: null });
  expect((await (await read(bob.context, bob.headers)).json()).viewer).toBe('member');

  // Electric sends each value as Postgres writes it, so JSON and booleans arrive as text: a
  // boolean is `true` in a shape's first rows and `t` in the changes that follow.
  const bool = (value: unknown) => ['true', 't'].includes(String(value));
  const bobsCopy = async () => {
    const rows = await syncedRows(bob.context, bob.headers, 'shared-notes');
    const row = rows.find((candidate) => candidate.note_id === id);
    return (
      row && {
        ownerName: row.owner_name,
        color: row.color,
        content: JSON.parse(String(row.content)),
        isAvailable: bool(row.is_available),
        isPinned: bool(row.is_pinned),
      }
    );
  };
  expect(await bobsCopy()).toEqual({
    ownerName: 'Alice',
    content: paragraph('Trip plan'),
    color: 'blue',
    isAvailable: true,
    isPinned: false,
  });
  // The note is nobody else's to sync, and never the reader's to edit.
  expect(await syncedRows(alice.context, alice.headers, 'shared-notes')).toEqual([]);
  expect(
    (await syncedRows(bob.context, bob.headers, 'notes')).find((row) => row.id === id),
  ).toBeUndefined();
  expect(
    (
      await bob.context.patch(`/api/notes/${id}`, {
        headers: bob.headers,
        data: { content: paragraph('Mine now') },
      })
    ).status(),
  ).toBe(404);

  // The reader's copy follows the owner's edits, and keeps the reader's own arrangement.
  expect(
    (
      await bob.context.patch(`/api/shared-notes/${id}`, {
        headers: bob.headers,
        data: { isPinned: true },
      })
    ).ok(),
  ).toBeTruthy();
  await alice.context.patch(`/api/notes/${id}`, {
    headers: alice.headers,
    data: { content: paragraph('Trip plan, revised') },
  });
  expect(await bobsCopy()).toMatchObject({
    content: paragraph('Trip plan, revised'),
    isPinned: true,
  });
  expect((await (await read(anonymous)).json()).content).toEqual(paragraph('Trip plan, revised'));

  // Reader colors follow the owner's tag tree as well as direct note color writes.
  const tag = noteId();
  expect(
    (
      await alice.context.post('/api/tags', {
        headers: alice.headers,
        data: { id: tag, name: 'Trips', color: 'yellow', parentId: null, icon: null },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await alice.context.patch(`/api/note-tags/${id}`, {
        headers: alice.headers,
        data: { primaryTagId: tag },
      })
    ).ok(),
  ).toBeTruthy();
  expect(await bobsCopy()).toMatchObject({ color: 'yellow' });
  expect(
    (
      await alice.context.patch(`/api/tags/${tag}`, {
        headers: alice.headers,
        data: { color: 'green' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(await bobsCopy()).toMatchObject({ color: 'green' });
  expect(
    (await alice.context.delete(`/api/tags/${tag}`, { headers: alice.headers })).ok(),
  ).toBeTruthy();
  expect(await bobsCopy()).toMatchObject({ color: 'default' });

  // Undo uses the original link and arrangement, but gets fresh content from the owner.
  await bob.context.delete(`/api/shared-notes/${id}`, { headers: bob.headers });
  const latest = paragraph('Trip plan, edited while removed');
  await alice.context.patch(`/api/notes/${id}`, {
    headers: alice.headers,
    data: { content: latest },
  });
  const placement = { isPinned: true, isArchived: true, position: 'a5' };
  const restore = () =>
    bob.context.post(`/api/shares/${token}/accept`, {
      headers: bob.headers,
      data: placement,
    });
  expect((await restore()).ok()).toBeTruthy();
  expect(await (await restore()).json()).toEqual({ noteId: id, txid: null });
  const [restored] = await syncedRows(bob.context, bob.headers, 'shared-notes');
  expect(restored).toMatchObject({ token, position: placement.position });
  expect(bool(restored.is_archived)).toBe(true);
  expect(await bobsCopy()).toMatchObject({
    content: latest,
    isPinned: true,
  });
  expect(
    (
      await bob.context.post(`/api/shares/${token}/accept`, {
        headers: bob.headers,
        data: { isPinned: 'yes' },
      })
    ).status(),
  ).toBe(400);

  // In its owner's trash the note is shared as nothing, and comes back when restored.
  await alice.context.patch(`/api/notes/${id}`, {
    headers: alice.headers,
    data: { deletedAt: new Date().toISOString() },
  });
  expect((await read(anonymous)).status()).toBe(404);
  expect(await bobsCopy()).toMatchObject({ content: [], isAvailable: false });
  await alice.context.patch(`/api/notes/${id}`, {
    headers: alice.headers,
    data: { deletedAt: null },
  });
  expect((await read(anonymous)).status()).toBe(200);
  expect(await bobsCopy()).toMatchObject({
    content: latest,
    isAvailable: true,
  });

  // Ending the sharing is the owner's alone, and takes the note out of the reader's gallery.
  expect(
    await (await bob.context.delete(`/api/note-shares/${id}`, { headers: bob.headers })).json(),
  ).toEqual({ txid: null });
  expect((await read(anonymous)).status()).toBe(200);
  const ended = await alice.context.delete(`/api/note-shares/${id}`, { headers: alice.headers });
  expect((await ended.json()).txid).toEqual(expect.any(Number));
  expect((await read(anonymous)).status()).toBe(404);
  expect((await accept(bob)).status()).toBe(404);
  expect(await bobsCopy()).toBeUndefined();
});

test('a shared note is read from its link and added to another gallery', async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('Dismissed', 'AbortError');
      },
    });
  });
  await signUp(page);
  await seedNotes(page, [{ title: 'Trip plan', body: 'Pack the tent' }]);

  await noteAction(page, 'Trip plan', 'Share');
  await page.getByRole('button', { name: /^(Create link|Share link)$/ }).click();
  const link = await page.getByLabel('Share link').inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  // The link works once the queued write has reached the server.
  await expect
    .poll(async () => (await page.request.get(link.replace('/s/', '/api/shares/'))).status())
    .toBe(200);
  // Escape closes the panel; on a phone a second one only dismisses the button's tooltip.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Share link')).toBeHidden();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(
    card(page, 'Trip plan').getByRole('img', { name: 'Shared with a link' }),
  ).toBeVisible();

  // Someone with no account reads it.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  const shared = guest.getByRole('article', { name: 'Shared note' });
  await expect(shared.getByRole('heading', { name: 'Trip plan' })).toBeVisible();
  await expect(shared.getByText('Pack the tent')).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Sign in to add to your notes' })).toBeVisible();
  await guest.context().close();

  // Someone with an account adds it to their gallery, where it can only be read.
  const reader = await (await browser.newContext()).newPage();
  await signUp(reader);
  await reader.goto(link);
  // Simulate a gallery already visited in this app session, then hold its next sync poll.
  // An already-ready collection must not turn a pending accepted copy into a missing note.
  await reader.evaluate(async () => {
    const { notesCollection, sharedNotesCollection } = await import('/src/lib/collections.ts');
    await Promise.all([notesCollection.preload(), sharedNotesCollection.preload()]);
  });
  let releaseSync!: () => void;
  let pollHeld!: () => void;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  const heldPoll = new Promise<void>((resolve) => {
    pollHeld = resolve;
  });
  await reader.route('**/api/shapes/shared-notes?*', async (route) => {
    pollHeld();
    await syncGate;
    await route.continue();
  });
  await heldPoll;
  const acceptedResponse = reader.waitForResponse(
    (response) => response.url().includes('/accept') && response.request().method() === 'POST',
  );
  await reader.getByRole('button', { name: 'Add to my notes' }).click();
  try {
    expect((await acceptedResponse).ok()).toBeTruthy();
    await expect(reader.getByRole('button', { name: 'Adding…' })).toBeVisible();
    await expect(reader).toHaveURL(link);
  } finally {
    releaseSync();
  }
  const dialog = reader.getByRole('dialog');
  await expect(dialog.getByText('Pack the tent')).toBeVisible();
  await expect(dialog.getByText(/Read only$/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Move to trash' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(card(reader, 'Trip plan').getByRole('img', { name: /^Shared/ })).toBeVisible();

  // It follows its owner's edits.
  await page.evaluate(async () => {
    const { notesCollection } = await import('/src/lib/collections.ts');
    const { updateNote } = await import('/src/lib/notes.ts');
    const [note] = [...notesCollection.values()];
    await updateNote(note.id, {
      content: [{ type: 'heading', props: { level: 3 }, content: 'Trip plan, revised' }],
    }).isPersisted.promise;
  });
  await expect(card(reader, 'Trip plan, revised')).toBeVisible();

  await noteAction(reader, 'Trip plan, revised', 'Remove from my notes');
  await expect(card(reader, 'Trip plan, revised')).toHaveCount(0);
  await reader.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card(reader, 'Trip plan, revised')).toBeVisible();
  await reader.reload();
  await expect(card(reader, 'Trip plan, revised')).toBeVisible();

  // And leaves when its owner stops sharing it.
  await noteAction(page, 'Trip plan, revised', 'Share');
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(card(reader, 'Trip plan, revised')).toHaveCount(0);
  await reader.goto(link);
  await expect(reader.getByRole('heading', { name: 'This note is not shared' })).toBeVisible();
  await reader.context().close();
});

test('note content shares a Markdown copy without making a Catch link', async ({
  page,
  isMobile,
}) => {
  await page.addInitScript(() => {
    const sent: string[] = [];
    Object.defineProperty(window, 'sentNoteContent', { value: sent });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        sent.push(data.text ?? data.url ?? '');
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sent.push(text);
        },
      },
    });
  });
  await signUp(page);
  await seedNotes(page, [{ title: 'Trip plan', body: 'Pack the tent' }]);
  await noteAction(page, 'Trip plan', 'Share');
  await page.getByRole('tab', { name: 'Note content', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue(
    /### Trip plan[\s\S]*Pack the tent/,
  );
  await page
    .getByRole('button', { name: isMobile ? 'Share content' : 'Copy content', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'sentNoteContent')))
    .toEqual(['### Trip plan\n\nPack the tent']);
  await page.getByRole('tab', { name: 'Catch link', exact: true }).click();
  await expect(page.getByLabel('Share link')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: isMobile ? 'Share link' : 'Create link', exact: true }),
  ).toBeEnabled();
});
