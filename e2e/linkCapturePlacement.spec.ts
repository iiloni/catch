import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { card, openDeck, signUp } from './helpers';

const id = () => {
  const value = randomUUID();
  return `${value.slice(0, 14)}7${value.slice(15)}`;
};

async function seedChoices(page: Page) {
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
  // Visit the form online so these server-seeded choices reach the device's cache.
  await page.goto('/capture');
  await page.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
  const destination = page.getByRole('dialog', { name: 'Save to', exact: true });
  await expect(destination.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Choose tags' }).click();
  await expect(page.getByRole('checkbox', { name: 'Later', exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Secondary tags', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page.reload();
  await page.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
  await expect(destination.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/');
  return { column, reading, web, later, headers };
}

async function choosePlacement(page: Page, column: string) {
  await page.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
  const destination = page.getByRole('dialog', { name: 'Save to', exact: true });
  const inbox = destination.getByRole('button', { name: 'Inbox', exact: true });
  await expect(inbox).toHaveAttribute('data-deck-column', column);
  await expect(
    destination.getByRole('button', { name: 'Send to gallery', exact: true }),
  ).toHaveAttribute('aria-current', 'location');
  await inbox.click();
  await expect(destination).toBeHidden();
  await page.getByRole('button', { name: 'Save to Deck · Inbox', exact: true }).click();
  await expect(inbox).toHaveAttribute('aria-current', 'location');
  await destination.getByRole('button', { name: 'Send to gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
  await inbox.click();
  await page.getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Blue: Reading', exact: true }).click();
  await page.getByRole('button', { name: 'Web', exact: true }).click();
  await page.getByRole('button', { name: 'Background color' }).click();
  const primaryBadge = page
    .getByRole('region', { name: 'Link placement' })
    .locator('[title="Reading / Web"][data-note-color="blue"]');
  await expect(primaryBadge).toHaveText('Web');
  await expect(primaryBadge.locator('svg')).toBeVisible();
  await page.getByRole('button', { name: 'Choose tags' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reading / Web', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Later', exact: true }).check();
  await page
    .getByRole('dialog', { name: 'Secondary tags', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
}

async function stage(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/lib/shareInbox.ts';
    const inbox: { captureWebShare: (form: FormData) => Promise<string> } = await import(
      modulePath
    );
    const form = new FormData();
    form.set('title', 'Shared link');
    form.set('text', 'https://example.com/incoming');
    return inbox.captureWebShare(form);
  });
}

async function selectInbox(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  const tab = page.getByRole('tab', { name: /^Inbox / });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test('the capture form saves to a chosen custom Deck column with primary and secondary tags', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  const { column } = await seedChoices(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ status: 404 }));
  await page.goto('/capture#url=https%3A%2F%2Fexample.com%2Fincoming&title=Captured%20link');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Captured link');
  await choosePlacement(page, column);
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
  await selectInbox(page, isMobile);
  await expect(
    page
      .getByRole('region', { name: 'Inbox column' })
      .getByRole('heading', { name: 'Captured link' }),
  ).toBeVisible();
  await page.reload();
  await selectInbox(page, isMobile);
  await expect(
    card(page, 'Captured link').getByRole('button', { name: 'Reading / Web', exact: true }),
  ).toBeVisible();
  await expect(
    card(page, 'Captured link').getByRole('button', { name: 'Later', exact: true }),
  ).toBeVisible();
});

test('a link share uses its dialog choices offline and completed receipts preserve later edits', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Offline persistence does not depend on layout; capture placement runs on both.',
  );
  test.setTimeout(90_000);
  await signUp(page);
  const { column, web, later } = await seedChoices(page);
  await page.route('**/api/**', (route) => route.abort());
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  const link = await stage(page);
  await page.goto(`/share?id=${link}`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Shared link');
  await choosePlacement(page, column);
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

test('a pending native link share offers placement and tag choices inside the app dialog', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  const { column } = await seedChoices(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ status: 404 }));
  const link = await stage(page);
  await page.reload();
  const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await expect(capture.getByLabel('URL', { exact: true })).toHaveValue(
    'https://example.com/incoming',
  );
  await choosePlacement(page, column);
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(capture).toBeHidden();
  await page.goto(`/share?id=${link}`);
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor.getByRole('button', { name: 'Reading / Web', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Later', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await openDeck(page);
  await selectInbox(page, isMobile);
  await expect(
    page
      .getByRole('region', { name: 'Inbox column' })
      .getByRole('heading', { name: 'Shared link' }),
  ).toBeVisible();
});
