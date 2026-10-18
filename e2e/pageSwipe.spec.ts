import { expect, type Page, test } from '@playwright/test';
import { card, openDeck, seedNotes, settledBox, signUp, waitForPageTransition } from './helpers';

/** Android uses real touch input; desktop Firefox exercises the same handler with touch events. */
async function swipe(
  page: Page,
  isMobile: boolean,
  dx: number,
  {
    x = dx < 0 ? 260 : 130,
    y = 60,
    dy = 0,
    cancel = false,
  }: {
    x?: number;
    y?: number;
    dy?: number;
    cancel?: boolean;
  } = {},
) {
  await waitForPageTransition(page);
  if (isMobile) {
    const touch = await page.context().newCDPSession(page);
    let timestamp = Date.now() / 1000;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
      timestamp,
    });
    for (const fraction of [0.03, 0.06, 0.1, 0.2, 0.4, 0.6, 0.8, 1]) {
      timestamp += 0.016;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx * fraction, y: y + dy * fraction, id: 1 }],
        timestamp,
      });
    }
    await page.waitForTimeout(100);
    await touch.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
      timestamp: timestamp + 0.1,
    });
    await touch.detach();
  } else {
    await page.evaluate(
      ({ x, y, dx, dy, cancel }) => {
        const touched = document.elementFromPoint(x, y);
        if (!touched) throw new Error('Missing swipe target');
        const send = (type: string, fraction: number, time: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: {
              value:
                type === 'touchend' || type === 'touchcancel'
                  ? []
                  : [
                      {
                        identifier: 0,
                        clientX: x + dx * fraction,
                        clientY: y + dy * fraction,
                      },
                    ],
            },
            timeStamp: { value: time },
          });
          touched.dispatchEvent(event);
        };
        send('touchstart', 0, 0);
        send('touchmove', 1, 100);
        send(cancel ? 'touchcancel' : 'touchend', 1, 150);
      },
      { x, y, dx, dy, cancel },
    );
  }
}

test('swipes switch adjacent main pages without wrapping or adding history', async ({
  page,
  isMobile,
  browser,
}) => {
  test.info().annotations.push({ type: 'browser', description: browser.version() });
  await signUp(page);
  const history = await page.evaluate(() => window.history.length);
  await swipe(page, isMobile, 140);
  await expect(page.getByRole('heading', { name: 'Deck', exact: true })).toBeVisible();
  await swipe(page, isMobile, 140);
  await expect(page).toHaveURL(/\/deck$/);
  await swipe(page, isMobile, -140);
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  await swipe(page, isMobile, -140);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search notes' })).not.toBeFocused();
  await swipe(page, isMobile, -140);
  await expect(page).toHaveURL(/\/search$/);
  await swipe(page, isMobile, 140);
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.history.length)).toBe(history);
});

test('short, vertical, cancelled, and mouse gestures stay on the page', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await swipe(page, isMobile, -35);
  await swipe(page, isMobile, -100, { dy: 160 });
  await swipe(page, isMobile, -140, { cancel: true });
  await page.mouse.move(260, 140);
  await page.mouse.down();
  await page.mouse.move(120, 140, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/$/);
});

test('swipes leave open notes and the composer on their current page', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await seedNotes(page, ['Stay here']);
  await card(page, 'Stay here').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await swipe(page, isMobile, -140, { y: 400 });
  await expect(page).toHaveURL(/\/\?note=/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await swipe(page, isMobile, -140);
  await expect(page).toHaveURL(/\/$/);
  await expect(popup).toBeVisible();
});

test('deck columns scroll before a fresh swipe at the outer edge changes pages', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Native horizontal scrolling needs the Android touch project.');
  await signUp(page);
  await openDeck(page);
  const column = page.locator('[data-board-column]').first();
  const pager = column.locator('..');
  const box = await settledBox(column);
  await swipe(page, isMobile, -140, { y: box.y + 150 });
  await expect.poll(() => pager.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/deck$/);
  // Let the native scroll and its snap finish before positioning the next gesture.
  await settledBox(column);
  await pager.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await settledBox(page.locator('[data-board-column]').last());
  await expect
    .poll(() =>
      pager.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft),
    )
    .toBeLessThan(2);
  await swipe(page, isMobile, -140, { y: box.y + 150 });
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
});

test('search filter panels retain their gestures and reduced motion still navigates', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await swipe(page, isMobile, -140);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter notes', exact: true }).click();
  await swipe(page, isMobile, 140);
  await expect(page).toHaveURL(/\/search$/);
  // A real touch outside dismisses the panel before touchstart, but must not navigate.
  const panel = page.getByRole('region', { name: 'Search filters', exact: true });
  if (await panel.isVisible())
    await page.getByRole('button', { name: 'Filter notes', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await swipe(page, isMobile, 140);
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
});
