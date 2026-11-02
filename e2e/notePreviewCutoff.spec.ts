import { expect, type Page, test } from '@playwright/test';
import { card, noteAction, openNote, seedNotes, signUp } from './helpers';

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

async function chooseCutoff(page: Page) {
  await page.keyboard.type('/preview');
  await page.getByRole('option', { name: /Preview cutoff/ }).click();
}

async function closeNote(page: Page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('a preview cutoff ends the card and leaves the full note', async ({ page }) => {
  await seedNotes(page, [{ title: 'Reading list', body: 'Worth a look' }]);
  const dialog = await openNote(page, 'Reading list');
  await dialog.locator('[data-content-type="paragraph"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await chooseCutoff(page);
  await expect(dialog.getByText('Card preview ends here')).toBeVisible();

  // The cursor lands below the marker, on a line the editor added for it.
  await page.keyboard.type('Only inside the note');
  await closeNote(page);

  const note = card(page, 'Reading list');
  await expect(note.getByText('Worth a look')).toBeVisible();
  await expect(note.getByText('Only inside the note')).toBeHidden();
  await expect(note.getByText('Card preview ends here')).toBeHidden();
  await expect(note.getByText('…')).toBeVisible();

  const reopened = await openNote(page, 'Reading list');
  await expect(reopened.getByText('Only inside the note')).toBeVisible();
  await expect(reopened.getByText('Card preview ends here')).toBeVisible();
});

test('a note keeps one cutoff, which can be moved and removed', async ({ page }) => {
  await seedNotes(page, [{ title: 'Moved', body: 'First line' }]);
  const dialog = await openNote(page, 'Moved');
  await dialog.locator('[data-content-type="paragraph"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await chooseCutoff(page);
  await page.keyboard.type('Second line');
  await page.keyboard.press('Enter');
  await chooseCutoff(page);
  await expect(dialog.getByText('Card preview ends here')).toHaveCount(1);
  await closeNote(page);
  await expect(card(page, 'Moved').getByText('Second line')).toBeVisible();

  const reopened = await openNote(page, 'Moved');
  await reopened.getByRole('button', { name: 'Remove card preview cutoff' }).click();
  await expect(reopened.getByText('Card preview ends here')).toHaveCount(0);
});

test('a share link shows the whole note without the cutoff', async ({ page, browser }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('Dismissed', 'AbortError');
      },
    });
  });
  await page.evaluate(async () => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    await createNote({
      userId: getSignedInUser().id,
      content: [
        { type: 'heading', props: { level: 3 }, content: 'Shared list' },
        { type: 'divider', props: { previewEnd: true } },
        { type: 'paragraph', content: 'Past the cutoff' },
      ],
    }).transaction.isPersisted.promise;
  });
  await expect(card(page, 'Shared list')).toBeVisible();
  await expect(card(page, 'Shared list').getByText('Past the cutoff')).toBeHidden();

  await noteAction(page, 'Shared list', 'Share');
  await page.getByRole('button', { name: /^(Create link|Share link)$/ }).click();
  const link = await page.getByLabel('Share link').inputValue();
  await expect
    .poll(async () => (await page.request.get(link.replace('/s/', '/api/shares/'))).status())
    .toBe(200);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  const shared = guest.getByRole('article', { name: 'Shared note' });
  await expect(shared.getByText('Past the cutoff')).toBeVisible();
  await expect(shared.getByText('Card preview ends here')).toBeHidden();
  await guest.context().close();
});
