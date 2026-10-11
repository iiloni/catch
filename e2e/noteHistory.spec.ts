import { createHash } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import {
  type HistoryCapture,
  type HistoryState,
  historyArchiveSchema,
  historyListSchema,
  historyRestoreContextSchema,
  historyRestoreResultSchema,
} from '../packages/shared/src/history';
import {
  canonicalHistory,
  decodeHistory,
  encodeHistory,
} from '../packages/shared/src/historyCodec';
import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION } from '../packages/shared/src/protocol';
import { bearerToken, card, openNote, seedNotes, settledBox, signUp } from './helpers';

/** The dock's row while versions are reviewed: their list on a phone, and the actions. */
const historyDock = (page: Page) => page.locator('[data-history-dock]');

async function chooseVersion(page: Page, reason: string) {
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history).toBeVisible();
  const versions = history.getByRole('navigation', { name: 'Saved versions' });
  // Beside the reader when there is room; otherwise the dock grows into the list.
  if (await versions.isVisible()) {
    await versions.getByRole('button').filter({ hasText: reason }).last().click();
    return;
  }
  await historyDock(page).getByRole('button', { name: 'Choose a version' }).click();
  const list = historyDock(page).getByRole('listbox', { name: 'Choose a version' });
  await list.getByRole('option').filter({ hasText: reason }).last().click();
  await expect(list).toBeHidden();
}

let counter = 0;
const id = () => {
  const time = Date.now().toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${(++counter).toString(16).padStart(12, '0')}`;
};
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const state = (text: string): HistoryState => ({
  content: [{ id: 'body', type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }],
  files: [],
});
async function account(request: APIRequestContext) {
  const result = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: new URL(test.info().project.use.baseURL ?? '').origin },
    data: { email: `history-${id()}@example.com`, password: 'password123', name: '' },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return {
    Authorization: `Bearer ${bearerToken(result)}`,
    [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION),
  };
}
async function newNote(
  request: APIRequestContext,
  headers: Record<string, string>,
  content: HistoryState['content'],
) {
  const noteId = id();
  const response = await request.post('/api/notes', {
    headers,
    data: {
      id: noteId,
      content,
      color: 'blue',
      isPinned: true,
      isArchived: true,
      position: 'a0',
      hiddenLinks: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return noteId;
}
async function list(request: APIRequestContext, headers: Record<string, string>, noteId: string) {
  const response = await request.get(`/api/note-history/${noteId}`, { headers });
  expect(response.ok()).toBeTruthy();
  return historyListSchema.parse(await response.json());
}

test('history restores atomically, preserves note settings, rejects newer edits and never replays an old write over a restore', {
  tag: '@api',
}, async ({ request }) => {
  const headers = await account(request);
  const other = await account(request);
  const original = state('Original content');
  const noteId = await newNote(request, headers, original.content);
  const previewUrl = 'https://example.com/preview';
  expect(
    (
      await request.patch(`/api/notes/${noteId}`, {
        headers: { ...headers, [API_PROTOCOL_HEADER]: '5' },
        data: { galleryPreviewUrl: previewUrl },
      })
    ).ok(),
  ).toBeTruthy();
  const baseline = (await list(request, headers, noteId)).versions[0]!;
  const originId = id();
  const operationId = id();
  const edit = {
    content: state('Content before restore').content,
    history: { originId, operationId },
  };
  expect((await request.patch(`/api/notes/${noteId}`, { headers, data: edit })).ok()).toBeTruthy();
  const contextResponse = await request.get(`/api/note-history/${noteId}/restore-context`, {
    headers,
  });
  const context = historyRestoreContextSchema.parse(await contextResponse.json());
  expect(
    (
      await request.patch(`/api/notes/${noteId}`, {
        headers: { ...headers, [API_PROTOCOL_HEADER]: '5' },
        data: { content: state('A newer edit').content },
      })
    ).ok(),
  ).toBeTruthy();
  const restore = {
    operationId: id(),
    versionId: baseline.id,
    epoch: context.summary.epoch,
    expectedToken: context.summary.contentToken,
  };
  const conflict = await request.post(`/api/note-history/${noteId}/restore`, {
    headers,
    data: restore,
  });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'HISTORY_RESTORE_STALE' });
  const fresh = historyRestoreContextSchema.parse(
    await (await request.get(`/api/note-history/${noteId}/restore-context`, { headers })).json(),
  );
  const accepted = { ...restore, operationId: id(), expectedToken: fresh.summary.contentToken };
  const response = await request.post(`/api/note-history/${noteId}/restore`, {
    headers,
    data: accepted,
  });
  expect(response.ok()).toBeTruthy();
  const restored = historyRestoreResultSchema.parse(await response.json());
  expect(restored.note?.content).toEqual(original.content);
  expect(restored.note).toMatchObject({
    color: 'blue',
    isPinned: true,
    isArchived: true,
    position: 'a0',
    galleryPreviewUrl: previewUrl,
  });
  const count = (await list(request, headers, noteId)).summary.versionCount;
  expect((await request.patch(`/api/notes/${noteId}`, { headers, data: edit })).ok()).toBeTruthy();
  expect(
    (await request.post(`/api/note-history/${noteId}/restore`, { headers, data: accepted })).ok(),
  ).toBeTruthy();
  expect((await list(request, headers, noteId)).summary.versionCount).toBe(count);
  const receipt = historyRestoreResultSchema.parse(
    await (
      await request.get(`/api/note-history/${noteId}/restores/${accepted.operationId}`, { headers })
    ).json(),
  );
  expect(receipt.note?.content).toEqual(original.content);
  for (const path of [
    `/api/note-history/${noteId}`,
    `/api/note-history/${noteId}/versions/${baseline.id}`,
    `/api/note-history/${noteId}/restore-context`,
    `/api/note-history/${noteId}/restores/${accepted.operationId}`,
  ])
    expect((await request.get(path, { headers: other })).status()).toBe(404);
  expect(
    (
      await request.post(`/api/note-history/${noteId}/restore`, { headers: other, data: accepted })
    ).status(),
  ).toBe(404);
});

test('retained deltas reconstruct exactly, expired captures cannot return, and clear rejects the old epoch without changing current content', {
  tag: '@api',
}, async ({ request }) => {
  test.setTimeout(90_000);
  const headers = await account(request);
  let previous = state('An unchanged long paragraph '.repeat(100));
  const noteId = await newNote(request, headers, previous.content);
  let timeline = await list(request, headers, noteId);
  let parent = timeline.versions[0]!;
  const originId = id();
  let expiredCapture: HistoryCapture | undefined;
  for (let index = 1; index <= 140; index++) {
    const next = state(`${'An unchanged long paragraph '.repeat(100)} ${index}`);
    const encoded = encodeHistory(next, { state: previous, depth: parent.depth });
    const capture: HistoryCapture = {
      id: id(),
      noteId,
      epoch: timeline.summary.epoch,
      kind: 'note',
      originId,
      capturedAt: new Date(),
      reason: 'edit',
      representation: encoded.representation,
      parentId: encoded.representation === 'delta' ? parent.id : null,
      depth: encoded.depth,
      contentKey: digest(canonicalHistory(next)),
      payloadKey: digest(encoded.data),
      sourceKey: null,
      format: 1,
      data: Buffer.from(encoded.data).toString('base64'),
    };
    if (index === 1) expiredCapture = capture;
    const result = await request.post(`/api/note-history/${noteId}/captures`, {
      headers,
      data: capture,
    });
    expect(result.ok(), await result.text()).toBeTruthy();
    previous = next;
    parent = {
      ...capture,
      sequence: index + 1,
      receivedAt: new Date(),
      representation: encoded.representation,
      reason: 'edit',
    };
  }
  timeline = await list(request, headers, noteId);
  expect(timeline.summary.versionCount).toBe(128);
  const archive = historyArchiveSchema.parse(
    await (
      await request.get(`/api/note-history/${noteId}/versions/${parent.id}`, { headers })
    ).json(),
  );
  expect(archive.versions.length).toBeLessThanOrEqual(32);
  let decoded: HistoryState | undefined;
  for (const row of archive.versions) {
    expect(row.representation).not.toBe('vault-note');
    decoded = decodeHistory(
      Buffer.from(row.data, 'base64'),
      row.representation as 'snapshot' | 'delta',
      decoded,
    );
  }
  expect(decoded).toEqual(previous);
  expect(
    (
      await request.post(`/api/note-history/${noteId}/captures`, { headers, data: expiredCapture })
    ).ok(),
  ).toBeTruthy();
  expect((await list(request, headers, noteId)).summary.versionCount).toBe(128);
  const context = historyRestoreContextSchema.parse(
    await (await request.get(`/api/note-history/${noteId}/restore-context`, { headers })).json(),
  );
  const cleared = await request.post(`/api/note-history/${noteId}/clear`, {
    headers,
    data: { epoch: context.summary.epoch, expectedToken: context.summary.contentToken },
  });
  expect(cleared.ok()).toBeTruthy();
  expect((await list(request, headers, noteId)).summary.versionCount).toBe(0);
  const rejected = await request.post(`/api/note-history/${noteId}/captures`, {
    headers,
    data: expiredCapture,
  });
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: 'HISTORY_EPOCH_CHANGED' });
  expect(
    historyRestoreContextSchema.parse(
      await (await request.get(`/api/note-history/${noteId}/restore-context`, { headers })).json(),
    ).note?.content,
  ).toEqual(context.note?.content);
});

test('closing offline preserves history across an immediate reload', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Close history original']);
  const dialog = await openNote(page, 'Close history original');
  await page.route('**/api/**', (route) => route.abort());
  await dialog.getByRole('textbox').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Close history changed');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  const reopened = await openNote(page, 'Close history changed');
  await expect(reopened.getByRole('textbox')).toContainText('Close history changed');
  await page
    .getByRole('dialog', { name: 'Edit note' })
    .getByRole('button', { name: 'Version history', exact: true })
    .click();
  const history = page.getByRole('region', { name: 'Version history' });
  await chooseVersion(page, 'Earlier content');
  await expect(history.getByRole('region', { name: 'Version preview' })).toContainText(
    'Close history original',
  );
  await expect(historyDock(page).getByRole('button', { name: 'Restore original' })).toBeDisabled();
});

test('history preview leaves the editor alone, restores online, and saves a cached version as a new note offline', async ({
  page,
}) => {
  await signUp(page);
  const previewUrl = 'https://example.com/history-preview';
  await seedNotes(page, [{ title: 'Original title', body: previewUrl }]);
  const originalId = await card(page, 'Original title').getAttribute('data-note-card');
  const dialog = await openNote(page, 'Original title');
  await dialog
    .locator(`[data-link-card="${previewUrl}"]`)
    .getByRole('button', { name: 'Link options' })
    .click();
  await page.getByRole('menuitem', { name: 'Show as Gallery Preview' }).click();
  const editor = dialog.getByRole('textbox');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Changed title');
  await page
    .getByRole('dialog', { name: 'Edit note' })
    .getByRole('button', { name: 'Version history', exact: true })
    .click();
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history).toBeVisible();
  await expect(history.getByRole('status')).toHaveCount(0);
  await chooseVersion(page, 'Earlier content');
  await expect(history.getByRole('region', { name: 'Version preview' })).toContainText(
    'Original title',
  );
  await historyDock(page).getByRole('button', { name: 'Restore original' }).click();
  await history.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(history).toBeHidden();
  await expect(dialog.getByRole('textbox')).toContainText('Original title');
  await page
    .getByRole('dialog', { name: 'Edit note' })
    .getByRole('button', { name: 'Version history', exact: true })
    .click();
  await expect(history).toBeVisible();
  await expect(history.getByRole('status')).toHaveCount(0);
  await chooseVersion(page, 'Before restore');
  await expect(history.getByRole('region', { name: 'Version preview' })).toContainText(
    'Changed title',
  );
  await page.context().setOffline(true);
  await expect(historyDock(page).getByRole('button', { name: 'Restore original' })).toBeDisabled();
  await historyDock(page).getByRole('button', { name: 'Save as new note' }).click();
  await history.getByRole('button', { name: 'Back to note' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const restoredCard = page.locator(`[data-note-card="${originalId}"]`);
  await expect(restoredCard).toBeVisible();
  await expect(card(page, 'Changed title')).toBeVisible();
  await expect(restoredCard.locator('[data-gallery-preview]')).toHaveAttribute(
    'data-gallery-preview',
    previewUrl,
  );
  await expect(card(page, 'Changed title').locator('[data-gallery-preview]')).toHaveCount(0);
  const copyId = await card(page, 'Changed title').getAttribute('data-note-card');
  expect(
    await page.evaluate(async (id) => {
      const { notesCollection } = await import('/src/lib/collections.ts');
      return notesCollection.get(id!)?.galleryPreviewUrl;
    }, copyId),
  ).toBeNull();
  await page.context().setOffline(false);
});

test('history keeps the working editor and scroll position, and closes its picker before the reader', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signUp(page);
  await seedNotes(page, ['History navigation']);
  const dialog = await openNote(page, 'History navigation');
  const editor = dialog.getByRole('textbox');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(
    [
      'Changed navigation',
      ...Array.from(
        { length: 12 },
        (_, i) => `Paragraph ${i + 1}: keep the editor and its scroll position.`,
      ),
    ].join('\n'),
  );
  await editor.evaluate((element) => element.setAttribute('data-history-test', 'original-editor'));
  const entry = dialog.getByRole('button', { name: 'Version history', exact: true });
  await expect(
    page.locator('[data-note-toolbar]').getByRole('button', { name: 'Version history' }),
  ).toHaveCount(0);
  await entry.click();
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history).toBeVisible();
  const scrollTop = await dialog
    .locator('[data-note-scroll]')
    .evaluate((element) => element.scrollTop);
  await historyDock(page).getByRole('button', { name: 'Choose a version' }).click();
  const picker = historyDock(page).getByRole('listbox', { name: 'Choose a version' });
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(history).toBeVisible();
  await chooseVersion(page, 'Earlier content');
  await expect(history.getByRole('region', { name: 'Version preview' })).toContainText(
    'History navigation',
  );
  await historyDock(page).getByRole('button', { name: 'Restore original' }).click();
  await expect(history.getByRole('region', { name: 'Confirm restore' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history.getByRole('region', { name: 'Confirm restore' })).toBeHidden();
  await expect(history.getByRole('region', { name: 'Version preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history.getByRole('region', { name: 'Version preview' })).toBeHidden();
  await expect(history).toBeVisible();
  expect(
    await dialog
      .locator('[data-history-test="original-editor"]')
      .evaluate((element) => element.closest('[inert]')?.getAttribute('aria-hidden')),
  ).toBe('true');
  expect(await history.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await expect(editor).toHaveAttribute('data-history-test', 'original-editor');
  expect(await dialog.locator('[data-note-scroll]').evaluate((element) => element.scrollTop)).toBe(
    scrollTop,
  );
  await expect(entry).toBeFocused();
  await expect(editor).toContainText('Changed navigation');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await entry.click();
  await expect(history).toBeVisible();
  await expect(history.locator('..')).toHaveCSS('opacity', '1');
  await history.getByRole('button', { name: 'Back to note' }).click();
  await expect(history).toBeHidden();
  await expect(entry).toBeFocused();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor).not.toContainText('Paragraph 12:');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});

test('a phone reads versions from the dock, leaves by a pull and after clearing', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the dock lists versions only where none fit beside the reader');
  await signUp(page);
  await seedNotes(page, ['Dock history original']);
  const dialog = await openNote(page, 'Dock history original');
  const editor = dialog.getByRole('textbox');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Dock history changed');
  const entry = dialog.getByRole('button', { name: 'Version history', exact: true });
  await entry.click();
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history).toBeVisible();
  await expect(history.getByRole('status')).toHaveCount(0);
  const dock = historyDock(page);
  await expect(page.getByRole('toolbar', { name: 'Note actions' })).toBeHidden();
  const back = await settledBox(history.getByRole('button', { name: 'Back to note' }));
  expect(back.x).toBeLessThan(40);
  expect(back.y).toBeLessThan(80);

  const closed = await settledBox(dock);
  await dock.getByRole('button', { name: 'Choose a version' }).click();
  const list = dock.getByRole('listbox', { name: 'Choose a version' });
  await expect(list).toBeVisible();
  await expect(dock.getByRole('searchbox')).toHaveCount(0);
  await expect(dock.getByRole('textbox')).toHaveCount(0);
  // The dock grows upward from where it sits, as it does for a note's palette.
  const grown = await settledBox(dock);
  expect(grown.height).toBeGreaterThan(closed.height + 100);
  expect(Math.abs(grown.y + grown.height - (closed.y + closed.height))).toBeLessThan(2);
  const clear = dock.getByRole('button', { name: 'Clear history' });
  const clearBox = await settledBox(clear);
  expect(clearBox.x + clearBox.width / 2).toBeGreaterThan(grown.x + grown.width / 2);
  expect(clearBox.y).toBeLessThan((await settledBox(list)).y);

  // A pull down on the version being read leaves the reader and keeps the note open.
  await page.mouse.click(10, 300);
  await expect(list).toBeHidden();
  await chooseVersion(page, 'Earlier content');
  const preview = history.getByRole('region', { name: 'Version preview' });
  await expect(preview).toContainText('Dock history original');
  await history.getByRole('tab', { name: 'What changed' }).click();
  await expect(preview.locator('del', { hasText: 'original' })).toBeVisible();
  await expect(preview.locator('ins', { hasText: 'changed' })).toBeVisible();
  const box = await settledBox(preview);
  const x = box.x + box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: box.y + 20 }],
  });
  for (let step = 1; step <= 10; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: box.y + 20 + step * 22 }],
    });
  // Rest before lifting: a touch lifted while moving is a fling, which drops the next tap.
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(history).toBeHidden();
  await expect(editor).toContainText('Dock history changed');
  await expect(page.getByRole('toolbar', { name: 'Note actions' })).toBeVisible();

  await entry.click();
  await expect(history).toBeVisible();
  await dock.getByRole('button', { name: 'Choose a version' }).click();
  await clear.click();
  const confirm = dock.getByRole('region', { name: 'Confirm clear history' });
  await expect(confirm).toBeVisible();
  await expect(list).toBeHidden();
  await confirm.getByRole('button', { name: 'Clear history' }).click();
  await expect(history).toBeHidden();
  await expect(editor).toContainText('Dock history changed');
  await entry.click();
  await expect(history).toContainText('0 saved versions');
});

test('beside the reader, versions keep the note’s toolbar and card where they were', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'a phone has no room for the list; its dock holds it');
  await signUp(page);
  await seedNotes(page, ['Aligned history original']);
  const dialog = await openNote(page, 'Aligned history original');
  const editor = dialog.getByRole('textbox');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Aligned history changed');
  const close = await settledBox(dialog.getByRole('button', { name: 'Close', exact: true }));
  const card = await settledBox(
    dialog.locator('[data-slot="scroll-area"]:has(> [data-note-scroll])'),
  );
  await dialog.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history.getByRole('status')).toHaveCount(0);
  expect(await settledBox(history.getByRole('button', { name: 'Back to note' }))).toEqual(close);
  expect(await settledBox(history.locator('[data-note-history-card]'))).toEqual(card);

  const versions = history.getByRole('navigation', { name: 'Saved versions' });
  const clear = versions.getByRole('button', { name: 'Clear history' });
  const rows = await settledBox(versions.getByRole('button').first());
  expect((await settledBox(clear)).y).toBeGreaterThan(rows.y + rows.height);
  await expect(clear).toHaveCSS(
    'color',
    await clear.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'text-destructive';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }),
  );
  await expect(historyDock(page).getByRole('button', { name: 'Choose a version' })).toHaveCount(0);
  await clear.click();
  await history
    .getByRole('region', { name: 'Confirm clear history' })
    .getByRole('button', { name: 'Clear history' })
    .click();
  await expect(history).toBeHidden();
  await expect(editor).toContainText('Aligned history changed');
});

test('vault history restores encrypted content and keeps cached history sealed across lock and reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  await page.getByRole('button', { name: 'Open the vault' }).click();
  const gate = page.getByRole('dialog', { name: 'Vault' });
  await gate.getByLabel('Vault password').fill('history vault password');
  await gate.getByLabel('Repeat it').fill('history vault password');
  await gate.getByRole('button', { name: 'Create vault' }).click();
  await gate.getByRole('button', { name: 'I have saved it' }).click();
  const secret = `Private history ${Date.now()}`;
  await page.evaluate(async (title) => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const made = createNote({
      userId: getSignedInUser().id,
      vault: true,
      content: [{ type: 'heading', props: { level: 3 }, content: title }],
    });
    await made.transaction.isPersisted.promise;
  }, secret);
  const dialog = await openNote(page, secret);
  await dialog.getByRole('textbox').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(`${secret} edited`);
  await page
    .getByRole('dialog', { name: 'Edit note' })
    .getByRole('button', { name: 'Version history', exact: true })
    .click();
  const history = page.getByRole('region', { name: 'Version history' });
  await expect(history).toBeVisible();
  await expect(history.getByRole('status')).toHaveCount(0);
  await chooseVersion(page, 'Earlier content');
  await expect(history.getByRole('region', { name: 'Version preview' })).toContainText(secret);
  await historyDock(page).getByRole('button', { name: 'Restore original' }).click();
  await history.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(history).toBeHidden();
  await expect(dialog.getByRole('textbox')).toHaveText(secret);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Leave the vault' }).click();
  const persisted = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const values: unknown[] = [];
    for (const info of databases.filter((row) => row.name?.startsWith('catch-history-'))) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const name of db.objectStoreNames) {
        values.push(
          await new Promise<unknown>((resolve, reject) => {
            const request = db.transaction(name).objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
        );
      }
      db.close();
    }
    return JSON.stringify(values);
  });
  expect(persisted).not.toContain(secret);
  await page.reload();
  await page.getByRole('button', { name: 'Open the vault' }).click();
  await gate.getByLabel('Vault password').fill('history vault password');
  await gate.getByRole('button', { name: 'Unlock', exact: true }).click();
  const reopened = await openNote(page, secret);
  await page
    .getByRole('dialog', { name: 'Edit note' })
    .getByRole('button', { name: 'Version history', exact: true })
    .click();
  await expect(history).toBeVisible();
  await expect(history.getByRole('status')).toHaveCount(0);
  await chooseVersion(page, 'Before restore');
  await expect(history.getByRole('region', { name: 'Version preview' })).toContainText(
    `${secret} edited`,
  );
  await page.context().setOffline(true);
  await expect(historyDock(page).getByRole('button', { name: 'Restore original' })).toBeDisabled();
  await historyDock(page).getByRole('button', { name: 'Save as new note' }).click();
  await history.getByRole('button', { name: 'Back to note' }).click();
  await reopened.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card(page, `${secret} edited`)).toBeVisible();
  await page.context().setOffline(false);
});
