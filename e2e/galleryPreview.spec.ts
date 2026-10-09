import { expect, test } from '@playwright/test';
import { card, openNote, seedNotes, signUp } from './helpers';

const first = 'https://example.com/first';
const second = 'https://example.com/second';

test('any link can be the card preview, and the choice can return to text', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, [{ title: 'Preview choices', body: `${first}\n${second}` }]);
  const original = card(page, 'Preview choices');
  await expect(original).toBeVisible();
  const id = await original.getAttribute('data-note-card');
  const face = page.locator(`[data-note-card="${id}"] [data-gallery-preview]`);
  await expect(face).toHaveCount(0);
  const editor = await openNote(page, 'Preview choices');
  const choose = async (url: string, action: string) => {
    await editor
      .locator(`[data-link-card="${url}"]`)
      .getByRole('button', { name: 'Link options' })
      .click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };

  await choose(second, 'Show as Gallery Preview');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(face).toHaveAttribute('data-gallery-preview', second);
  await expect(page.getByRole('button', { name: /^2 links, first / })).toBeVisible();

  // The card's hover dock sits over the face's bottom edge, so reopen from its top.
  await face.click({ position: { x: 20, y: 20 } });
  await expect(editor.getByRole('textbox')).toContainText('Preview choices');
  await choose(first, 'Show as Gallery Preview');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(face).toHaveAttribute('data-gallery-preview', first);

  await face.click({ position: { x: 20, y: 20 } });
  await choose(first, 'Show Text in Gallery');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(face).toHaveCount(0);
  await expect(original).toContainText(second);
});

test('an offline preview choice survives reload, and hiding it falls back to text', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Persistence is independent of layout; choosing links runs on both.');
  await signUp(page);
  await seedNotes(page, [{ title: 'Offline choice', body: `${first}\n${second}` }]);
  const id = await card(page, 'Offline choice').getAttribute('data-note-card');
  const editor = await openNote(page, 'Offline choice');
  await page.route('**/api/**', (route) => route.abort());
  await editor
    .locator(`[data-link-card="${second}"]`)
    .getByRole('button', { name: 'Link options' })
    .click();
  await page.getByRole('menuitem', { name: 'Show as Gallery Preview' }).click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const { waitForPendingWritesStored } = await import('/src/lib/collections.ts');
    await waitForPendingWritesStored();
  });
  await page.reload();
  const chosen = page.locator(`[data-note-card="${id}"]`);
  await expect(chosen.locator('[data-gallery-preview]')).toHaveAttribute(
    'data-gallery-preview',
    second,
  );
  // The card's hover dock sits over the face's bottom edge, so open from its top.
  await chosen.locator('[data-gallery-preview]').click({ position: { x: 20, y: 20 } });
  await expect(editor.getByRole('textbox')).toContainText('Offline choice');
  await editor
    .locator(`[data-link-card="${second}"]`)
    .getByRole('button', { name: 'Link options' })
    .click();
  await page.getByRole('menuitem', { name: 'Remove preview', exact: true }).click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chosen.locator('[data-gallery-preview]')).toHaveCount(0);
  await expect(chosen).toContainText(second);
  await page.unroute('**/api/**');
});
