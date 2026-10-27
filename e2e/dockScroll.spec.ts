import { expect, type Page, test } from '@playwright/test';
import { card, openNote, seedNotes, settledBox, signUp, waitForPageTransition } from './helpers';

async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
  // The browser delivers scroll events on a frame, after scrollY has changed.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function expectDock(page: Page, hidden: boolean) {
  const dock = page.locator('[data-dock]');
  await expect(dock).toHaveAttribute('data-scroll-hidden', String(hidden));
  await expect
    .poll(() =>
      dock.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= window.innerHeight;
      }),
    )
    .toBe(hidden);
}

test.beforeEach(async ({ page }) => {
  await signUp(page);
  await seedNotes(
    page,
    Array.from({ length: 30 }, (_, index) => ({
      title: `Scroll note ${index}`,
      body: 'Enough content to browse beyond the dock. '.repeat(index === 29 ? 100 : 12),
    })),
  );
  await expect(card(page, 'Scroll note 29')).toBeVisible();
  await waitForPageTransition(page);
});

test('dock and edge blur leave together after deliberate scrolling and reverse after a threshold', async ({
  page,
}, testInfo) => {
  await testInfo.attach('browser-version', {
    body: page.context().browser()?.version() ?? 'unknown',
    contentType: 'text/plain',
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await scrollTo(page, 24);
  await expectDock(page, false);
  await scrollTo(page, 72);
  await expectDock(page, true);
  const blur = page.locator('[data-page-bottom-blur]');
  await expect
    .poll(() => blur.evaluate((element) => element.getBoundingClientRect().top >= innerHeight - 1))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dock-hidden.png') });

  // Small movements and reversals must not flash the dock back into view.
  await scrollTo(page, 220);
  await scrollTo(page, 200);
  await expectDock(page, true);
  await scrollTo(page, 210);
  await scrollTo(page, 180);
  await expectDock(page, true);
  await scrollTo(page, 160);
  await expectDock(page, false);
  await expect
    .poll(() => blur.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeCloseTo(await page.evaluate(() => innerHeight), 0);
  await page.screenshot({ path: testInfo.outputPath('dock-visible.png') });

  await scrollTo(page, 240);
  await expectDock(page, true);
  await scrollTo(page, 20);
  await expectDock(page, false);
});

test('keyboard focus, navigation and an open note keep dock actions available', async ({
  page,
}) => {
  await scrollTo(page, 300);
  await expectDock(page, true);
  const gallery = page.locator('[data-dock] a[aria-label="Gallery"]');
  await page.keyboard.press('Tab');
  await gallery.focus();
  await expectDock(page, false);
  await scrollTo(page, 400);
  await expectDock(page, false);
  await gallery.blur();
  await scrollTo(page, 500);
  await expectDock(page, true);

  // Changing routes restores the dock even when the old page left it hidden.
  await page
    .locator('[data-dock] a[aria-label="Search"]')
    .evaluate((link: HTMLAnchorElement) => link.click());
  await expectDock(page, false);
  await waitForPageTransition(page);
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await waitForPageTransition(page);
  await expectDock(page, false);
  // Pointer focus left on a tab must still allow the browsing dock to hide.
  await page.getByRole('link', { name: 'Deck', exact: true }).click();
  await waitForPageTransition(page);
  await page.getByRole('link', { name: 'Gallery', exact: true }).click();
  await waitForPageTransition(page);
  await scrollTo(page, 0);
  await scrollTo(page, 300);
  await expectDock(page, true);
  await scrollTo(page, 0);
  await openNote(page, 'Scroll note 29');
  await expectDock(page, false);
  const noteScroll = page.locator('[data-note-scroll]');
  await noteScroll.evaluate((scroller) => scroller.scrollTo(0, 200));
  await expect.poll(() => noteScroll.evaluate((scroller) => scroller.scrollTop)).toBeGreaterThan(0);
  await expectDock(page, false);
});

test('opening previews reveals the dock and closing them allows it to hide again', async ({
  page,
}, testInfo) => {
  await testInfo.attach('browser-version', {
    body: page.context().browser()?.version() ?? 'unknown',
    contentType: 'text/plain',
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedNotes(page, [{ title: 'Scroll previews', body: 'https://example.com' }]);
  const underlay = page.getByRole('button', { name: /^Link: / });
  await expect(underlay).toBeVisible();
  await scrollTo(page, 72);
  await expectDock(page, true);
  const entrance = page.evaluate(
    () =>
      new Promise<Array<{ dockMiddle: number; clipBottom: number }>>((resolve, reject) => {
        const samples: Array<{ dockMiddle: number; clipBottom: number }> = [];
        let start: number | undefined;
        let frame = 0;
        const timeout = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error('Did not capture the preview entrance'));
        }, 10_000);
        function capture(time: number) {
          const panel = document.querySelector('[data-link-overlay]');
          const dock = document.querySelector('[data-dock]');
          if (panel?.parentElement && dock) {
            start ??= time;
            const bounds = dock.getBoundingClientRect();
            samples.push({
              dockMiddle: bounds.top + bounds.height / 2,
              clipBottom: panel.parentElement.getBoundingClientRect().bottom,
            });
            if (time - start >= 600) {
              clearTimeout(timeout);
              resolve(samples);
              return;
            }
          }
          frame = requestAnimationFrame(capture);
        }
        frame = requestAnimationFrame(capture);
      }),
  );
  await underlay.click();
  const frames = await entrance;
  await testInfo.attach('preview-entrance', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  expect(frames.length).toBeGreaterThan(3);
  expect(frames[0].dockMiddle - frames.at(-1)!.dockMiddle).toBeGreaterThan(24);
  for (const frame of frames) {
    expect(Math.abs(frame.clipBottom - frame.dockMiddle)).toBeLessThan(1);
  }
  const overlay = page.locator('[data-link-overlay]');
  await expect(overlay).toBeVisible();
  await expectDock(page, false);
  await expect(page.locator('[data-dock]')).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      page
        .locator('[data-page-bottom-blur]')
        .evaluate((element) => element.getBoundingClientRect().bottom),
    )
    .toBeCloseTo(await page.evaluate(() => innerHeight), 0);
  await settledBox(overlay);
  await page.screenshot({ path: testInfo.outputPath('previews-with-dock.png') });

  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toBeHidden();
  await expectDock(page, false);
  const y = await page.evaluate(() => window.scrollY);
  await scrollTo(page, y + 72);
  await expectDock(page, true);
});

test('reduced motion switches the dock and blur without sliding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scrollTo(page, 300);
  await expectDock(page, true);
  await expect
    .poll(() =>
      page
        .locator('[data-page-bottom-blur]')
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual((await page.evaluate(() => innerHeight)) - 1);
  await scrollTo(page, 240);
  await expectDock(page, false);
});
