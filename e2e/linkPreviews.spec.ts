import { expect, test } from '@playwright/test';
import { card, createNote, openNote, settledBox, signUp } from './helpers';

test('a note’s links show under its card, in an overlay and in the open note', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Links', 'see https://example.com/page and https://example.org');

  // Before or after the server fetches them, the underlay names the first link.
  const underlay = page.getByRole('button', { name: /^2 links, first / });
  await expect(underlay).toBeVisible();
  await underlay.click();
  await expect(page.getByRole('dialog', { name: '2 links' })).toBeVisible();
  const overlay = page.getByRole('dialog');
  await expect(overlay.getByRole('link')).toHaveCount(2);
  await expect(overlay.getByRole('link').first()).toHaveAttribute(
    'href',
    'https://example.com/page',
  );

  // Removing a preview leaves the link in the note's text.
  await overlay.getByRole('button', { name: 'Link options' }).first().click();
  await page.getByRole('menuitem', { name: 'Remove preview' }).click();
  await expect(overlay.getByRole('link')).toHaveCount(1);
  await expect(overlay).toHaveAccessibleName('Link');
  await overlay.getByRole('button', { name: 'Close' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.getByRole('button', { name: /^Link: / })).toBeVisible();
  await expect(card(page, 'Links')).toContainText('https://example.com/page');

  const dialog = await openNote(page, 'Links');
  const links = dialog.getByRole('region', { name: 'Links' });
  await expect(links.getByRole('link')).toHaveAttribute('href', 'https://example.org');
});

test('link previews can be turned off in Settings', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Bookmarks', 'https://example.com is a link and some text');
  await expect(page.getByRole('button', { name: /^Link: / })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Link previews' }).click();
  await page.goBack();
  await expect(card(page, 'Bookmarks')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Link: / })).toBeHidden();
});

test('the link overlay dismisses with an upward or downward touch swipe', async ({ page }) => {
  test.skip(test.info().project.name !== 'android');
  await signUp(page);
  await createNote(page, 'Swipe links', 'https://example.com and https://example.org');
  const underlay = page.getByRole('button', { name: /^2 links, first / });
  const overlay = page.getByRole('dialog', { name: '2 links' });
  const cdp = await page.context().newCDPSession(page);

  for (const delta of [-150, 150]) {
    await underlay.click();
    await expect(overlay).toBeVisible();
    // The overlay rises from the dock; aim at its header once it has arrived.
    const header = await settledBox(overlay.locator('header'));
    const x = header.x + 30;
    const y = header.y + header.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (delta * step) / 6 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(overlay).toBeHidden();
  }
});

test('the dock tray fades away and its overlay gathers media above links', async ({
  page,
  isMobile,
}, testInfo) => {
  if (!isMobile) await page.setViewportSize({ width: 600, height: 900 });
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.locator('[contenteditable]')).toBeFocused();
  await page.keyboard.type('Preview tray');
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(
      `Paragraph ${i + 1}: some longer note content to keep the attachments and links below the fold.`,
    );
  }
  await page.keyboard.press('Enter');
  await page.keyboard.type('https://example.com and https://example.org');
  await page.getByRole('button', { name: 'Close new note' }).click();
  await openNote(page, 'Preview tray');
  const noteId = new URL(page.url()).searchParams.get('note');
  if (!noteId) throw new Error('Missing note ID');
  await page.evaluate(async (id) => {
    const { addAttachment } = await import('/src/lib/attachments.ts');
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
      ),
      (char) => char.charCodeAt(0),
    );
    await addAttachment(id, new File([bytes], 'catalog.png', { type: 'image/png' }));
    document.querySelector('[data-note-scroll]')?.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, noteId);
  const tray = page.locator('button[data-link-underlay].glass-thick');
  await expect(tray).toBeVisible();
  await expect(tray).toHaveCSS('opacity', '1');
  const fade = await page.evaluate(async () => {
    const tray = document.querySelector<HTMLButtonElement>(
      'button[data-link-underlay].glass-thick',
    );
    if (!tray) throw new Error('Missing dock tray');
    const wrapper = tray.parentElement;
    const samples: Array<{ connected: boolean; opacity: number; wrapperOpacity: string }> = [];
    tray.click();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      function sample() {
        samples.push({
          connected: tray.isConnected,
          opacity: Number(getComputedStyle(tray).opacity),
          wrapperOpacity: wrapper ? getComputedStyle(wrapper).opacity : '',
        });
        if (performance.now() - start < 600) requestAnimationFrame(sample);
        else resolve();
      }
      requestAnimationFrame(sample);
    });
    return samples;
  });
  const lastVisible = fade.filter((sample) => sample.connected).at(-1);
  // The last frame seen before the tray leaves; a busy machine draws the fade in fewer of them.
  expect(lastVisible?.opacity).toBeLessThan(0.1);
  expect(lastVisible?.wrapperOpacity).toBe('1');
  const overlay = page.locator('[data-link-overlay]');
  await expect(overlay).toHaveAccessibleName('Media · 1');
  const media = overlay.getByRole('region', { name: 'Media', exact: true });
  const links = overlay.getByRole('region', { name: 'Links', exact: true });
  await expect(media.getByRole('button', { name: 'View catalog.png' })).toBeVisible();
  const mediaBounds = await media.boundingBox();
  const linkBounds = await links.boundingBox();
  if (!mediaBounds || !linkBounds) throw new Error('Missing preview cards');
  expect(mediaBounds.y + mediaBounds.height).toBeLessThan(linkBounds.y);
  await page.screenshot({ path: testInfo.outputPath('media-and-links.png') });
  await media.getByRole('button', { name: 'View catalog.png' }).click();
  const viewer = page.locator('[data-media-viewer]');
  await expect(viewer.getByRole('img', { name: 'catalog.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(overlay).toBeVisible();
  // An inline action leaves the preview overlay and returns to this note's editor.
  await media.getByRole('button', { name: 'Manage catalog.png' }).click();
  await page.getByRole('menuitem', { name: 'Add to note', exact: true }).click();
  await expect(overlay).toBeHidden();
  await expect(page.locator('.note-editor [data-content-type="image"]')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('[data-note-scroll]')?.scrollTo(0, 0));
  await expect(tray).toBeVisible();
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Add attachment' })).toBeVisible();
  await expect(tray).toHaveCount(0);
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await expect(tray).toBeVisible();
});
