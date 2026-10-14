import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { card, openNote, seedNotes, signUp } from './helpers';

const first = 'https://example.com/first';
const second = 'https://example.com/second';

test('a gallery preview image opens its link while the title opens the note', async ({
  page,
  context,
}) => {
  const hash = 'b'.repeat(64);
  // Keep preview metadata deterministic while exercising the real shape subscription.
  await page.route('**/api/shapes/link-previews?*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const messages = z
      .array(z.object({ value: z.record(z.string(), z.unknown()).optional() }).passthrough())
      .parse(await response.json());
    for (const message of messages) {
      if (message.value?.url === first) {
        Object.assign(message.value, {
          status: 'ready',
          title: 'Image preview',
          site_name: 'Example',
          image_hash: hash,
          image_width: 640,
          image_height: 400,
        });
      }
    }
    await route.fulfill({ response, json: messages });
  });
  await page.route(`**/api/link-previews/assets/${hash}`, (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await context.route(first, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Linked page</title>' }),
  );
  await signUp(page);
  const id = await page.evaluate(async (href) => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { id, transaction } = createNote({
      userId: getSignedInUser().id,
      content: [{ type: 'paragraph', content: `${href}#details` }],
      galleryPreviewUrl: href,
    });
    await transaction.isPersisted.promise;
    return id;
  }, first);
  const chosen = page.locator(`[data-note-card="${id}"]`);
  const imageLink = chosen.getByRole('link', { name: 'Open link: Image preview' });
  await expect(imageLink).toBeVisible();
  const galleryUrl = page.url();
  for (const keyboard of [false, true]) {
    const opened = page.waitForEvent('popup');
    if (keyboard) await imageLink.press('Enter');
    else await imageLink.click();
    const popup = await opened;
    await expect(popup).toHaveURL(`${first}#details`);
    await expect(page).toHaveURL(galleryUrl);
    await expect(page.getByRole('dialog')).toBeHidden();
    await popup.close();
  }
  // The hover toolbar covers the text's lower area; use its top edge.
  await chosen
    .getByRole('button', { name: 'Open note', exact: true })
    .click({ position: { x: 20, y: 6 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`note=${id}`));
});

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
