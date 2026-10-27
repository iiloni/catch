import { expect, test } from '@playwright/test';
import { settledBox, signUp } from './helpers';

for (const preview of [false, true]) {
  test(`the ${preview ? 'floating preview' : 'regular note'} toolbar keeps its press targets still`, async ({
    page,
    isMobile,
    browser,
  }, testInfo) => {
    test.skip(isMobile, 'Card toolbars are hidden on coarse pointers.');
    testInfo.annotations.push({ type: 'browser', description: browser.version() });
    await signUp(page);
    const id = await page.evaluate(async (preview) => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const url = 'https://example.com/toolbar-preview-keeps-each-control-under-the-pointer';
      const { id, transaction } = createNote({
        userId: getSignedInUser().id,
        content: [
          { type: 'heading', content: 'Toolbar target' },
          { type: 'paragraph', content: 'Keep the controls under the pointer. '.repeat(8) },
          { type: 'paragraph', content: url },
        ],
        galleryPreviewUrl: preview ? url : null,
      });
      await transaction.isPersisted.promise;
      return id;
    }, preview);
    const card = page.locator(`[data-note-card="${id}"]`);
    await card.hover({ position: { x: 40, y: 6 } });
    const before = await settledBox(card);
    await testInfo.attach('before-press', {
      body: await page.screenshot({ path: testInfo.outputPath('before-press.png') }),
      contentType: 'image/png',
    });

    for (const label of ['Pin', 'Background color', 'Tags', 'Move note', 'Reminder', 'Share']) {
      await card.hover({ position: { x: 40, y: 6 } });
      const button = card.getByRole('button', { name: label, exact: true });
      const resting = await settledBox(card);
      const target = await settledBox(button);
      // An edge press catches a card shrinking away before the click is released.
      await page.mouse.move(target.x + target.width / 2, target.y + 3);
      await page.mouse.down();
      await page.waitForTimeout(300);
      const held = await card.boundingBox();
      expect(held).not.toBeNull();
      expect(held?.width).toBeCloseTo(resting.width, 1);
      expect(held?.height).toBeCloseTo(resting.height, 1);
      const heldTarget = await button.boundingBox();
      expect(heldTarget?.x).toBeCloseTo(target.x, 1);
      expect(heldTarget?.y).toBeCloseTo(target.y, 1);
      if (label === 'Tags') {
        await testInfo.attach('held-toolbar-press', {
          body: await page.screenshot({ path: testInfo.outputPath('held-toolbar-press.png') }),
          contentType: 'image/png',
        });
      }
      await page.mouse.up();
      if (label === 'Pin') {
        await expect(card.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
      } else {
        await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
        if (label === 'Background color') {
          await page.getByRole('button', { name: 'Red', exact: true }).click();
          await expect(card).toHaveAttribute('data-note-color', 'red');
        }
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-slot="popover-content"]')).toBeHidden();
      }
      await expect(page.getByRole('dialog')).toBeHidden();
    }

    // Pressing the face still gives feedback; cancelling restores the whole silhouette.
    const face = await settledBox(card.getByRole('button', { name: 'Open note', exact: true }));
    await page.mouse.move(face.x + 20, face.y + 8);
    await page.mouse.down();
    await expect
      .poll(async () => (await card.boundingBox())?.width ?? 0)
      .toBeLessThan(before.width * 0.98);
    await page.mouse.move(before.x + before.width + 30, before.y);
    await page.mouse.up();
    expect((await settledBox(card)).width).toBeCloseTo(before.width, 1);
    await expect(page.getByRole('dialog')).toBeHidden();

    // Switch directly between menus, without dismissing the previous one first.
    const menus = ['Background color', 'Tags', 'Move note', 'Reminder', 'Share'];
    const openMenus = page.locator('[data-slot="popover-content"][data-state="open"]');
    await card.hover({ position: { x: 40, y: 6 } });
    for (const label of [...menus, ...menus.toReversed()]) {
      const button = card.getByRole('button', { name: label, exact: true });
      // The repeated Share closes on the second press; every other press switches menus.
      const wasOpen = (await button.getAttribute('aria-expanded')) === 'true';
      await button.click();
      await expect(openMenus).toHaveCount(wasOpen ? 0 : 1);
      for (const sibling of menus) {
        await expect(card.getByRole('button', { name: sibling, exact: true })).toHaveAttribute(
          'aria-expanded',
          String(!wasOpen && sibling === label),
        );
      }
    }
    await page.keyboard.press('Escape');
    await expect(openMenus).toHaveCount(0);
    const color = card.getByRole('button', { name: 'Background color', exact: true });
    await expect(color).toBeFocused();
    await color.press('Enter');
    await expect(openMenus).toHaveCount(1);
    await page.mouse.click(before.x + before.width + 40, before.y - 24);
    await expect(openMenus).toHaveCount(0);

    await card.hover({ position: { x: 40, y: 6 } });
    await card.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(card).toBeHidden();
  });
}
