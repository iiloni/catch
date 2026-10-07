import { crc32, deflateSync } from 'node:zlib';
import { expect, type Page, type Request, test } from '@playwright/test';
import { z } from 'zod';
import { card, noteAction, openDeck, openNote, seedNotes, signUp } from './helpers';

const PASSWORD = 'correct horse battery';

/** A PNG the browser can decode and draw, which the vault needs to make a thumbnail. */
function png(size: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  // Eight bits a channel, RGB.
  header.set([8, 2, 0, 0, 0], 8);
  // Each row starts with its filter byte; the rest is one flat color.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x7f)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const picture = { name: 'passport-scan.png', mimeType: 'image/png', buffer: png(16) };

const gate = (page: Page) => page.getByRole('dialog', { name: 'Vault' });
const enter = (page: Page) => page.getByRole('button', { name: 'Open the vault' }).click();
const leave = (page: Page) => page.getByRole('button', { name: 'Leave the vault' }).click();

/** Sets the vault up from the header's lock button and returns its recovery code. */
async function setUpVault(page: Page, { remember = false } = {}) {
  await enter(page);
  await gate(page).getByLabel('Vault password').fill(PASSWORD);
  await gate(page).getByLabel('Repeat it').fill(PASSWORD);
  if (remember) await gate(page).getByRole('switch', { name: 'Remember on this device' }).click();
  await gate(page).getByRole('button', { name: 'Create vault' }).click();
  await expect(gate(page).getByText('Save your recovery code')).toBeVisible();
  const code = (await gate(page).getByRole('status').textContent()) ?? '';
  expect(code).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  await gate(page).getByRole('button', { name: 'I have saved it' }).click();
  await expect(page.getByRole('heading', { name: 'Vault', exact: true })).toBeVisible();
  return code;
}

async function unlock(page: Page, password = PASSWORD) {
  await enter(page);
  await gate(page).getByLabel('Vault password').fill(password);
  await gate(page).getByRole('button', { name: 'Unlock', exact: true }).click();
}

/** Adds notes to the unlocked vault without typing them, and returns their ids. */
function seedVaultNotes(page: Page, titles: readonly string[], status?: string) {
  return page.evaluate(
    async ({ titles, status }) => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const made = titles.map((title) =>
        createNote({
          userId: getSignedInUser().id,
          status,
          vault: true,
          content: [{ type: 'heading', props: { level: 3 }, content: title }],
        }),
      );
      await Promise.all(made.map((note) => note.transaction.isPersisted.promise));
      return made.map((note) => note.id as string);
    },
    { titles, status },
  );
}

const SHAPES = [
  'notes',
  'vault-notes',
  'attachments',
  'tags',
  'note-tags',
  'reminders',
  'link-previews',
];

const shapeMessages = z.array(
  z.object({
    key: z.string().optional(),
    value: z.record(z.string(), z.unknown()).optional(),
    headers: z.object({ operation: z.string().optional() }).optional(),
  }),
);

/**
 * What the server syncs to this account from a shape: the rows as they stand, and every
 * message it sent as text, which also holds the rows since changed or deleted.
 */
async function shape(page: Page, name: string) {
  const token = await page.evaluate(() => localStorage.getItem('catch-auth-token'));
  const rows = new Map<string, Record<string, unknown>>();
  let text = '';
  let offset = '-1';
  let handle = '';
  // The first request is the snapshot from when the shape was made; later ones its changes.
  for (let request = 0; request < 20; request += 1) {
    const response = await page.request.get(
      `/api/shapes/${name}?offset=${offset}${handle ? `&handle=${handle}` : ''}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    text += body;
    for (const message of shapeMessages.parse(JSON.parse(body))) {
      if (!message.key) continue;
      if (message.headers?.operation === 'delete') rows.delete(message.key);
      else if (message.value) rows.set(message.key, { ...rows.get(message.key), ...message.value });
    }
    offset = response.headers()['electric-offset'] ?? offset;
    handle = response.headers()['electric-handle'] ?? handle;
    if (response.headers()['electric-up-to-date'] !== undefined) break;
  }
  return { rows: [...rows.values()], text };
}

const rows = async (page: Page, name: string) => (await shape(page, name)).rows;

test('the vault is set up, locks on leaving, and opens with its password or recovery code', async ({
  page,
}) => {
  await signUp(page);
  await seedNotes(page, ['Shopping list']);
  const code = await setUpVault(page);

  // Inside, the pages show the vault's notes and not the others.
  await expect(page.getByText('The vault is empty')).toBeVisible();
  await expect(card(page, 'Shopping list')).toHaveCount(0);
  await seedVaultNotes(page, ['Safe combination']);
  await expect(card(page, 'Safe combination')).toBeVisible();

  // A device not asked to remember the vault locks it on the way out.
  await leave(page);
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(card(page, 'Shopping list')).toBeVisible();
  await expect(card(page, 'Safe combination')).toHaveCount(0);

  await unlock(page, 'not the password');
  await expect(gate(page).getByRole('alert')).toBeVisible();
  await gate(page).getByLabel('Vault password').fill(PASSWORD);
  await gate(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(card(page, 'Safe combination')).toBeVisible();

  // A reload forgets the key; the recovery code opens the vault and sets a new password.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await enter(page);
  await gate(page).getByRole('button', { name: 'Use the recovery code' }).click();
  await gate(page).getByLabel('Recovery code').fill(code.toLowerCase());
  await gate(page).getByLabel('New vault password').fill('a brand new password');
  await gate(page).getByLabel('Repeat it').fill('a brand new password');
  await gate(page).getByRole('button', { name: 'Unlock and change password' }).click();
  await expect(card(page, 'Safe combination')).toBeVisible();

  await leave(page);
  await unlock(page, PASSWORD);
  await expect(gate(page).getByRole('alert')).toBeVisible();
  await gate(page).getByLabel('Vault password').fill('a brand new password');
  await gate(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(card(page, 'Safe combination')).toBeVisible();
});

test('the Deck and search show the vault’s notes while inside it', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Plain task'], 'todo');
  await setUpVault(page, { remember: true });
  await seedVaultNotes(page, ['Sealed task'], 'todo');

  const results = page.getByRole('region', { name: 'Results' });

  await openDeck(page);
  await expect(card(page, 'Sealed task')).toBeVisible();
  await expect(card(page, 'Plain task')).toHaveCount(0);

  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Search the vault' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search notes' }).fill('task');
  await expect(results.getByText('Sealed task')).toBeVisible();
  await expect(results.getByText('Plain task')).toHaveCount(0);

  // Remembered, the vault stays unlocked on leaving, and the pages go back to the others.
  await leave(page);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(results.getByText('Plain task')).toBeVisible();
  await expect(results.getByText('Sealed task')).toHaveCount(0);

  // The device kept the key, so a reload needs no password.
  await page.reload();
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Search the vault' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search notes' }).fill('task');
  await expect(results.getByText('Sealed task')).toBeVisible();
});

test('nothing a vault note holds reaches the server in the clear', async ({ page, isMobile }) => {
  test.skip(isMobile, 'What is sent does not depend on the layout');
  const sent: Request[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET') sent.push(request);
  });
  await signUp(page);
  await setUpVault(page);

  // Typed and attached through the UI, so every path a real note takes is watched.
  await page.getByRole('button', { name: 'New note' }).click();
  const window = page.getByRole('region', { name: 'New note', exact: true });
  await expect(window.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('Zebra crossing 4471 https://example.com/private-page');
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Add attachment' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    picker.getByRole('button', { name: 'Files', exact: true }).click(),
  ]);
  await chooser.setFiles(picture);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(card(page, 'Zebra crossing 4471')).toBeVisible();

  // The file opens under its real name on the device that holds the key.
  const dialog = await openNote(page, 'Zebra crossing 4471');
  const media = dialog.getByRole('region', { name: 'Media' });
  await expect(media.getByText('passport-scan.png')).toBeVisible();
  await expect(media.getByRole('img')).toBeVisible();

  // Tagging goes through the same sealed write.
  await page.evaluate(async () => {
    const { vaultNotes } = await import('/src/lib/vault.ts');
    const { createTag, setPrimaryTag } = await import('/src/lib/tags.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const note = vaultNotes.get()[0];
    if (!note) throw new Error('No vault note');
    const tag = createTag(getSignedInUser().id, {
      name: 'Documents',
      parentId: null,
      icon: null,
      color: null,
    });
    await tag.transaction.isPersisted.promise;
    await setPrimaryTag(note.id, tag.id).isPersisted.promise;
  });

  // Once the server has it all: the note, its picture and the picture's thumbnail.
  await expect
    .poll(async () => (await rows(page, 'attachments')).filter((row) => row.status === 'ready'))
    .toHaveLength(2);
  await expect.poll(() => rows(page, 'tags')).toHaveLength(1);

  const secrets = ['Zebra', '4471', 'private-page', 'passport-scan', 'image/png'];
  const png = picture.buffer.subarray(0, 8).toString('latin1');
  for (const request of sent) {
    const body = request.postDataBuffer()?.toString('latin1') ?? '';
    for (const secret of secrets) {
      expect(body, `${request.method()} ${request.url()}`).not.toContain(secret);
    }
    expect(body, `${request.method()} ${request.url()}`).not.toContain(png);
  }
  for (const name of SHAPES) {
    const { text } = await shape(page, name);
    for (const secret of secrets) expect(text, name).not.toContain(secret);
  }
  // The note went to the vault's table, and nothing was made for the server to read: no
  // ordinary note, no preview of its link and no record of which note carries the tag.
  expect(await rows(page, 'vault-notes')).toHaveLength(1);
  expect(await rows(page, 'notes')).toHaveLength(0);
  expect(await rows(page, 'link-previews')).toHaveLength(0);
  expect(await rows(page, 'note-tags')).toHaveLength(0);
  for (const row of await rows(page, 'attachments')) {
    expect(row).toMatchObject({ name: 'Vault file', mime_type: 'application/octet-stream' });
  }
});

test('a quick note written in the vault never becomes an ordinary note when the vault locks', async ({
  page,
}) => {
  await signUp(page);
  await setUpVault(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const window = page.getByRole('region', { name: 'New note', exact: true });
  await expect(window.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('Typed before the lock');

  // As the auto-lock does after the app has been away.
  await page.evaluate(async () => {
    const { lockVault } = await import('/src/lib/vault.ts');
    await lockVault();
  });
  await expect(window).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(card(page, 'Typed before the lock')).toHaveCount(0);

  // It was sealed while the key was still there.
  await unlock(page);
  await expect(card(page, 'Typed before the lock')).toBeVisible();
  await expect.poll(() => rows(page, 'vault-notes')).toHaveLength(1);
  expect(await rows(page, 'notes')).toHaveLength(0);
});

test('entering or leaving the vault closes the note left open beside the page', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone has no pane beside the page');
  await page.setViewportSize({ width: 1600, height: 900 });
  await signUp(page);
  await seedNotes(page, ['Plain note']);
  await setUpVault(page, { remember: true });
  await seedVaultNotes(page, ['Sealed note']);

  await openNote(page, 'Sealed note');
  await expect(page).toHaveURL(/[?&]note=/);
  await leave(page);
  await expect(page).not.toHaveURL(/[?&]note=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openNote(page, 'Plain note');
  await expect(page).toHaveURL(/[?&]note=/);
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Vault', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]note=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a trashed vault note’s reminder comes off, and comes back when it is restored', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Reminders and the trash work the same on a phone');
  await signUp(page);
  await setUpVault(page);
  const [id] = await seedVaultNotes(page, ['Renew passport']);
  await page.evaluate(async (id) => {
    const { setReminder } = await import('/src/lib/reminders.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const transaction = setReminder(
      { id, userId: getSignedInUser().id },
      { startsAt: '2099-01-01T09:00', timeZone: 'Europe/Lisbon', floating: true, recurrence: null },
    );
    await transaction.isPersisted.promise;
  }, id);
  await expect.poll(() => rows(page, 'reminders')).toHaveLength(1);
  await expect(
    card(page, 'Renew passport').getByRole('img', { name: /^Reminder: / }),
  ).toBeVisible();

  // The server cannot tell a vault note is in the trash, so it must hold nothing to ring.
  await noteAction(page, 'Renew passport', 'Move to trash');
  await expect(page.getByText('Moved to trash')).toBeVisible();
  await expect.poll(() => rows(page, 'reminders')).toHaveLength(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    card(page, 'Renew passport').getByRole('img', { name: /^Reminder: / }),
  ).toBeVisible();
  await expect
    .poll(() => rows(page, 'reminders'))
    .toMatchObject([{ note_id: id, starts_at: '2099-01-01T09:00' }]);
});
