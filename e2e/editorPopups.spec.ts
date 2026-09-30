import { expect, test } from '@playwright/test';
import { openNote, signUp } from './helpers';

test.beforeEach(async ({ page }) => {
  await signUp(page);
  await page.evaluate(async () => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { transaction } = createNote({
      userId: getSignedInUser().id,
      content: [
        { type: 'heading', props: { level: 3 }, content: 'Popup focus' },
        { type: 'paragraph', content: 'Selected text' },
        { type: 'image', props: { url: '' } },
        { type: 'paragraph', content: 'Last paragraph' },
      ],
    });
    await transaction.isPersisted.promise;
  });
});

test('the image embed field keeps focus and accepts a URL', async ({ page }) => {
  const dialog = await openNote(page, 'Popup focus');
  await dialog.getByText('Add image', { exact: true }).click();
  const field = page.locator('[data-test="embed-input"]');
  await field.click();
  await expect(field).toBeFocused();
  const url = new URL('/favicon.png', page.url()).href;
  await page.keyboard.type(url);
  await expect(field).toHaveValue(url);
  await page.getByRole('button', { name: 'Embed image', exact: true }).click();
  await expect(dialog.locator('[data-content-type="image"] img')).toHaveAttribute('src', url);
  await expect(dialog.locator('[data-content-type="paragraph"]').last()).toHaveText(
    'Last paragraph',
  );
});

test('the formatting dropdown preserves the selected block', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Touch devices use the dock formatting bar.');
  const dialog = await openNote(page, 'Popup focus');
  const paragraph = dialog.locator('[data-content-type="paragraph"]').first();
  await paragraph.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('Selected text');
  await page.locator('.bn-formatting-toolbar').getByRole('combobox').click();
  const option = page.getByRole('option', { name: 'Heading 2', exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(dialog.locator('[data-content-type="heading"][data-level="2"]')).toHaveText(
    'Selected text',
  );
  await expect(dialog.locator('[data-content-type="paragraph"]').last()).toHaveText(
    'Last paragraph',
  );
});

test('the formatting link popup keeps focus and links the selected text', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Touch devices use the dock formatting bar.');
  const dialog = await openNote(page, 'Popup focus');
  await dialog.locator('[data-content-type="paragraph"]').first().click();
  await expect(dialog.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('Selected text');
  await page.locator('[data-test="createLink"]').click();
  const field = page.locator('.bn-form-popover input[name="url"]');
  await field.click();
  await expect(field).toBeFocused();
  await page.keyboard.type('https://example.com');
  await field.press('Enter');
  await expect(dialog.getByRole('link', { name: 'Selected text', exact: true })).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(dialog.locator('[data-content-type="paragraph"]').last()).toHaveText(
    'Last paragraph',
  );
});

test('clicking the editor gutter still focuses the nearby block', async ({ page, isMobile }) => {
  const dialog = await openNote(page, 'Popup focus');
  const paragraph = dialog.locator('[data-content-type="paragraph"]').last();
  const box = await paragraph.boundingBox();
  const editor = dialog.locator('.bn-editor');
  const editorBox = await editor.boundingBox();
  if (!box || !editorBox) throw new Error('Missing editor layout');
  const point = { x: editorBox.x + editorBox.width - 4, y: box.y + box.height / 2 };
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(editor).toBeFocused();
  await page.keyboard.type('!');
  await expect(paragraph).toHaveText('Last paragraph!');
});

test('block handles stay inset and align with the first line, including touch-sized lists', async ({
  page,
  isMobile,
}) => {
  await page.evaluate(async () => {
    document.documentElement.style.setProperty('--safe-area-inset-left', '12px');
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { transaction } = createNote({
      userId: getSignedInUser().id,
      content: [
        { id: 'title', type: 'heading', props: { level: 3 }, content: 'Handle alignment' },
        { id: 'heading', type: 'heading', props: { level: 2 }, content: 'A larger heading' },
        {
          id: 'wrapped',
          type: 'paragraph',
          content: 'A paragraph with several lines of text to check the first line. '.repeat(3),
        },
        { id: 'bullet', type: 'bulletListItem', content: 'A bullet item' },
        { id: 'numbered', type: 'numberedListItem', content: 'A numbered item' },
        { id: 'checkbox', type: 'checkListItem', content: 'A checklist item' },
        { id: 'empty', type: 'paragraph', content: [] },
      ],
    });
    await transaction.isPersisted.promise;
  });
  const dialog = await openNote(page, 'Handle alignment');
  const editor = dialog.locator('.bn-editor');
  for (const id of ['title', 'heading', 'wrapped', 'bullet', 'numbered', 'checkbox', 'empty']) {
    const inline = editor.locator(`[data-id="${id}"] .bn-inline-content`).first();
    await inline.scrollIntoViewIfNeeded();
    const box = await inline.boundingBox();
    if (!box) throw new Error('Missing block layout');
    await page.mouse.move(box.x + 1, box.y + 4);
    const handle = dialog.getByRole('button', { name: 'Open block menu' });
    await expect(handle).toBeVisible();
    await expect
      .poll(() =>
        inline.evaluate((inline) => {
          const icon = document.querySelector('[data-test="dragHandle"]');
          if (!icon) return Number.POSITIVE_INFINITY;
          const iconBounds = icon.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(inline);
          const firstLine = Array.from(range.getClientRects()).find((rect) => rect.height > 0);
          const line = firstLine ?? inline.getBoundingClientRect();
          return Math.abs(iconBounds.y + iconBounds.height / 2 - (line.y + line.height / 2));
        }),
      )
      .toBeLessThan(2);
    const target = await handle.boundingBox();
    const editorBounds = await editor.boundingBox();
    if (!target || !editorBounds) throw new Error('Missing handle layout');
    expect(target.x - editorBounds.x).toBeGreaterThanOrEqual(isMobile ? 16 : 8);
    expect(target.x + target.width).toBeLessThanOrEqual(box.x + 1);
    if (isMobile) {
      expect(target.width).toBe(32);
      expect(target.height).toBe(32);
      const blockBounds = await editor.locator(`[data-id="${id}"]`).first().boundingBox();
      if (!blockBounds) throw new Error('Missing block bounds');
      expect(blockBounds.x - (target.x + target.width)).toBeCloseTo(4, 0);
    }
  }
  await page.screenshot({ path: `test-results/block-handle-${isMobile ? 'touch' : 'mouse'}.png` });
  await dialog.getByRole('button', { name: 'Open block menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Add block', exact: true })).toBeVisible();
});
