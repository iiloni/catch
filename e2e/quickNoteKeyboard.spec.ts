import { expect, test } from '@playwright/test';
import { card, settledBox, signUp } from './helpers';

for (const dismissal of ['dock', 'outside', 'Escape'] as const) {
  test(`quick-note ${dismissal} dismissal releases focus before its exit animation`, async ({
    page,
  }) => {
    await signUp(page);
    for (const filled of [false, true]) {
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      const popup = page.getByRole('region', { name: 'New note', exact: true });
      const editor = popup.locator('[contenteditable="true"]');
      await expect(editor).toBeFocused();
      const title = `Saved with ${dismissal}`;
      if (filled) await page.keyboard.type(title);
      await settledBox(popup);
      // A removed editor dismisses the real keyboard too late. Capture the surface at
      // blur, while it should still be fully painted and connected at the start of exit.
      await editor.evaluate((element) => {
        const popup = element.closest<HTMLElement>('section[aria-label="New note"]')!;
        popup.dataset.blurState = '';
        element.addEventListener(
          'blur',
          () => {
            popup.dataset.blurState = JSON.stringify({
              connected: element.isConnected,
              opacity: Number(getComputedStyle(popup).opacity),
            });
          },
          { once: true },
        );
      });
      // Keep the element handle to inspect the captured event after the animation unmounts it.
      const surface = await popup.elementHandle();
      if (!surface) throw new Error('Missing quick-note surface');
      if (dismissal === 'dock') {
        await page.getByRole('button', { name: filled ? 'Save note' : 'Close new note' }).click();
      } else if (dismissal === 'outside') {
        await page.getByRole('heading', { name: 'Gallery', exact: true }).click({ force: true });
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(popup).toBeHidden();
      const captured = await surface.evaluate((element) => element.dataset.blurState);
      expect(captured).toBeTruthy();
      expect(JSON.parse(captured!)).toMatchObject({ connected: true, opacity: 1 });
      if (filled) await expect(card(page, title)).toBeVisible();
      else await expect(page.getByRole('article')).toHaveCount(0);
      await surface.dispose();
    }
  });
}
