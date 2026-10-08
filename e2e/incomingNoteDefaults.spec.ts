import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { card, openDeck, signUp } from './helpers';

const id = () => {
  const value = randomUUID();
  return `${value.slice(0, 14)}7${value.slice(15)}`;
};

async function configureDefaults(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('catch-auth-token'));
  const headers = { Authorization: `Bearer ${token}` };
  const reading = id();
  const web = id();
  const later = id();
  const column = id();
  for (const tag of [
    { id: reading, name: 'Reading', parentId: null, color: 'blue', icon: 'book-open' },
    { id: web, name: 'Web', parentId: reading, color: null, icon: null },
    { id: later, name: 'Later', parentId: null, color: null, icon: null },
  ]) {
    expect((await page.request.post('/api/tags', { headers, data: tag })).ok()).toBeTruthy();
  }
  expect(
    (
      await page.request.post('/api/board-columns', {
        headers,
        data: { id: column, name: 'Inbox', color: 'amber', position: 'z0' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto('/settings/general');
  const section = page.getByRole('region', { name: 'Incoming notes', exact: true });
  await expect(section.getByRole('option', { name: 'Deck · Inbox', exact: true })).toBeAttached();
  await section.getByLabel('Save incoming notes to').selectOption(column);
  await section.getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Blue: Reading', exact: true }).click();
  await page.getByRole('button', { name: 'Web', exact: true }).click();
  // Close only the palette; Android Back is covered by the palette's own tests.
  await section.getByText('Save incoming notes to', { exact: true }).click();
  await section.getByRole('checkbox', { name: 'Later', exact: true }).check();
  await expect(
    section.getByRole('checkbox', { name: 'Reading / Web', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(section.getByLabel('Save incoming notes to')).toHaveValue(column);
  await expect(section.getByRole('checkbox', { name: 'Later', exact: true })).toBeChecked();
  await expect(section.getByText('Web', { exact: true }).first()).toBeVisible();
  return { column, reading, web, later, headers };
}

async function stage(page: Page, kind: 'files' | 'link') {
  return page.evaluate(async (kind) => {
    const modulePath = '/src/lib/shareInbox.ts';
    const inbox: { captureWebShare: (form: FormData) => Promise<string> } = await import(
      modulePath
    );
    const form = new FormData();
    form.set('title', kind === 'files' ? 'Shared file' : 'Shared link');
    form.set('text', kind === 'files' ? 'Shared caption' : 'https://example.com/incoming');
    if (kind === 'files')
      form.append('files', new File(['data'], 'shared.txt', { type: 'text/plain' }));
    return inbox.captureWebShare(form);
  }, kind);
}

test('incoming settings place link captures in a custom Deck column with primary and secondary tags', async ({
  page,
}) => {
  await signUp(page);
  await configureDefaults(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ status: 404 }));
  await page.goto('/capture#url=https%3A%2F%2Fexample.com%2Fincoming&title=Captured%20link');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Captured link');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(page.getByText('Your note is in Deck · Inbox.')).toBeVisible();
  await page.getByRole('button', { name: 'Open note', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor.getByRole('textbox')).toContainText('Captured link');
  await expect(editor.getByRole('button', { name: 'Reading / Web', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Later', exact: true })).toBeVisible();
  await expect(editor.locator('[data-note-color="blue"]').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await openDeck(page);
  await expect(
    page
      .getByRole('region', { name: 'Inbox column' })
      .getByRole('heading', { name: 'Captured link' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    card(page, 'Captured link').getByRole('button', { name: 'Reading / Web', exact: true }),
  ).toBeVisible();
  await expect(
    card(page, 'Captured link').getByRole('button', { name: 'Later', exact: true }),
  ).toBeVisible();
});

test('offline file and link shares retain defaults and completed receipts preserve later placement and tags', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Offline persistence and receipt replay do not depend on layout; settings and capture run on both.',
  );
  test.setTimeout(90_000);
  await signUp(page);
  const { column, web, later } = await configureDefaults(page);
  await page.route('**/api/**', (route) => route.abort());
  const files = await stage(page, 'files');
  await page.goto(`/share?id=${files}`);
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor.getByRole('textbox')).toContainText('Shared caption');
  await expect(editor.getByText('shared.txt', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Reading / Web', exact: true })).toBeVisible();
  await page.reload();
  await expect(editor.getByRole('textbox')).toContainText('Shared caption');
  await expect(editor.getByRole('button', { name: 'Later', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  const link = await stage(page, 'link');
  await page.goto(`/share?id=${link}`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Shared link');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(editor.getByRole('textbox')).toContainText('Shared link');
  await expect(editor.getByRole('button', { name: 'Reading / Web', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  // Change the completed share using the same actions as its dock, then deliver it again.
  await page.evaluate(
    async ({ link, web, later, column }) => {
      const notesPath = '/src/lib/notes.ts';
      const tagsPath = '/src/lib/tags.ts';
      const collectionsPath = '/src/lib/collections.ts';
      const notes: {
        getNote: (id: string) => { status: string | null } | undefined;
        sendNoteToGallery: (id: string) => unknown;
      } = await import(notesPath);
      const tags: {
        setPrimaryTag: (id: string, tagId: string | null, color: string) => unknown;
        setSecondaryTag: (id: string, tagId: string, selected: boolean) => unknown;
      } = await import(tagsPath);
      const collections: { waitForWriteStored: (transaction: unknown) => Promise<void> } =
        await import(collectionsPath);
      if (notes.getNote(link)?.status !== column)
        throw new Error('Share did not use the selected column');
      await collections.waitForWriteStored(notes.sendNoteToGallery(link));
      await collections.waitForWriteStored(tags.setPrimaryTag(link, null, 'red'));
      await collections.waitForWriteStored(tags.setSecondaryTag(link, later, false));
      await collections.waitForWriteStored(tags.setSecondaryTag(link, web, false));
    },
    { link, web, later, column },
  );
  await page.goto(`/share?id=${link}`);
  await expect(editor.getByRole('textbox')).toContainText('Shared link');
  await expect(editor.getByRole('button', { name: 'Reading / Web', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Later', exact: true })).toHaveCount(0);
  await expect(editor.locator('[data-note-color="red"]').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card(page, 'Shared link')).toBeVisible();
});
