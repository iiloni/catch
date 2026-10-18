import { expect, type Page, test } from '@playwright/test';
import { card, openDeck, seedNotes, settledBox, signUp, waitForPageTransition } from './helpers';

/** Android uses real touch input; desktop Firefox dispatches the same touch events. */
async function beginSwipe(page: Page, isMobile: boolean, x = 260, y = 60) {
  await waitForPageTransition(page);
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  const target = touch
    ? null
    : await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x, y });
  let timestamp = Date.now() / 1000;
  let offset = { x: 0, y: 0 };
  async function send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel') {
    const ended = type === 'touchEnd' || type === 'touchCancel';
    const point = { x: x + offset.x, y: y + offset.y };
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: ended ? [] : [{ ...point, id: 1 }],
        timestamp,
      });
    } else if (target) {
      await target.evaluate(
        (element, { type, ended, point, time }) => {
          if (!element) throw new Error('Missing swipe target');
          const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: {
              value: ended ? [] : [{ identifier: 0, clientX: point.x, clientY: point.y }],
            },
            timeStamp: { value: time },
          });
          element.dispatchEvent(event);
        },
        { type, ended, point, time: timestamp * 1000 },
      );
    }
  }
  await send('touchStart');
  return {
    async move(dx: number, dy = 0) {
      const from = offset;
      for (const fraction of [0.03, 0.06, 0.1, 0.2, 0.4, 0.6, 0.8, 1]) {
        timestamp += 0.016;
        offset = { x: from.x + (dx - from.x) * fraction, y: from.y + (dy - from.y) * fraction };
        await send('touchMove');
      }
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
    async end(cancel = false) {
      // A touch lifted in motion is a fling to Chrome, which drops the next tap's click.
      await page.waitForTimeout(110);
      timestamp += 0.11;
      await send(cancel ? 'touchCancel' : 'touchEnd');
      await touch?.detach();
      await target?.dispose();
    },
  };
}

async function swipe(
  page: Page,
  isMobile: boolean,
  dx: number,
  {
    x = dx < 0 ? 260 : 130,
    y = 60,
    dy = 0,
    cancel = false,
  }: { x?: number; y?: number; dy?: number; cancel?: boolean } = {},
) {
  const gesture = await beginSwipe(page, isMobile, x, y);
  await gesture.move(dx, dy);
  await gesture.end(cancel);
}

async function searchDockState(page: Page) {
  return page.locator('[data-dock] search').evaluate((field) => {
    const values = getComputedStyle(field)
      .clipPath.match(/^inset\(([^r]+) round/)?.[1]
      .trim()
      .split(/\s+/)
      .map(Number.parseFloat);
    if (!values) throw new Error('Missing Search field clip');
    const left = values[3] ?? values[1] ?? values[0];
    const input = field.querySelector('input');
    if (!input) throw new Error('Missing Search input');
    const filterIcon = document.querySelector('[data-dock] .lucide-sliders-horizontal');
    if (!filterIcon) throw new Error('Missing filter icon');
    return {
      progress: 1 - left / (4 + ((field.getBoundingClientRect().width - 8) * 2) / 3),
      textOpacity: Number(getComputedStyle(input).opacity),
      hidden: field.getAttribute('aria-hidden') === 'true',
      focused: document.activeElement === input,
      filterColor: getComputedStyle(filterIcon).color,
      foreground: getComputedStyle(document.body).color,
    };
  });
}

async function tabIndicatorState(page: Page) {
  return page.locator('[data-dock-indicator]').evaluate((indicator) => {
    const links = indicator.closest('nav')?.querySelectorAll('a');
    const deck = links?.[0];
    const gallery = links?.[1];
    const deckIcon = deck?.querySelector('svg');
    const galleryIcon = gallery?.querySelector('svg');
    if (!deck || !deckIcon || !galleryIcon) throw new Error('Missing dock tabs');
    const first = deck.getBoundingClientRect();
    return {
      position: (indicator.getBoundingClientRect().x - first.x) / first.width,
      deckColor: getComputedStyle(deckIcon).color,
      galleryColor: getComputedStyle(galleryIcon).color,
    };
  });
}

test('the dock tab indicator and icons track Deck and Gallery swipes without a second animation', async ({
  page,
  isMobile,
}, testInfo) => {
  await signUp(page);
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  const width = await page.evaluate(() => innerWidth);
  const indicator = page.locator('[data-dock-indicator]');
  await settledBox(indicator);
  await indicator.evaluate((el) => el.setAttribute('data-original-indicator', ''));
  expect((await tabIndicatorState(page)).position).toBeCloseTo(1, 2);

  const towardDeck = await beginSwipe(page, isMobile, 55);
  await towardDeck.move(width / 2);
  let state = await tabIndicatorState(page);
  expect(state.position).toBeCloseTo(0.5, 2);
  expect(state.deckColor).toBe(state.galleryColor);
  await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await testInfo.attach('tab-indicator-mid-swipe', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await towardDeck.move(width / 4);
  state = await tabIndicatorState(page);
  expect(state.position).toBeCloseTo(0.75, 2);
  expect(state.deckColor).not.toBe(state.galleryColor);
  await towardDeck.end(true);
  await expect.poll(async () => (await tabIndicatorState(page)).position).toBeCloseTo(1, 2);

  await swipe(page, isMobile, width * 0.55, { x: 55 });
  // The route commits as the finger lifts; the indicator arrives with the page.
  await expect(page).toHaveURL(/\/deck$/);
  await expect.poll(async () => (await tabIndicatorState(page)).position).toBeCloseTo(0, 2);
  await expect(indicator).toHaveAttribute('data-original-indicator', '');

  const towardGallery = await beginSwipe(page, isMobile, width - 35);
  await towardGallery.move(-width / 2);
  state = await tabIndicatorState(page);
  expect(state.position).toBeCloseTo(0.5, 2);
  expect(state.deckColor).toBe(state.galleryColor);
  await towardGallery.end(true);
  await expect.poll(async () => (await tabIndicatorState(page)).position).toBeCloseTo(0, 2);
  await swipe(page, isMobile, -width * 0.55, { x: width - 35 });
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await tabIndicatorState(page)).position).toBeCloseTo(1, 2);
  await expect(indicator).toHaveAttribute('data-original-indicator', '');

  await page.getByRole('link', { name: 'Deck', exact: true }).click();
  await expect(page).toHaveURL(/\/deck$/);
  await expect.poll(async () => (await tabIndicatorState(page)).position).toBeCloseTo(0, 2);
  await waitForPageTransition(page);
  await page.getByRole('link', { name: 'Gallery', exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await tabIndicatorState(page)).position).toBeCloseTo(1, 2);
});

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

test('the Search dock follows a held swipe, reversal and spring in both directions', async ({
  page,
  isMobile,
}, testInfo) => {
  await signUp(page);
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  const width = await page.evaluate(() => innerWidth);
  const entering = await beginSwipe(page, isMobile, width - 35);
  await entering.move(-width * 0.65);
  let dock = await searchDockState(page);
  expect(dock.progress).toBeCloseTo(0.65, 2);
  expect(dock.textOpacity).toBeCloseTo((0.65 - 0.35) / 0.45, 2);
  expect(dock.hidden).toBe(true);
  expect(dock.focused).toBe(false);
  expect(dock.filterColor).toBe(dock.foreground);
  await expect(page).toHaveURL(/\/$/);
  await testInfo.attach('dock-during-swipe', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await entering.move(-width * 0.45);
  dock = await searchDockState(page);
  expect(dock.progress).toBeCloseTo(0.45, 2);
  expect(dock.textOpacity).toBeCloseTo((0.45 - 0.35) / 0.45, 2);
  await entering.end(true);
  await expect.poll(async () => (await searchDockState(page)).progress).toBeCloseTo(0, 2);

  await swipe(page, isMobile, -width * 0.65, { x: width - 35 });
  await expect(page).toHaveURL(/\/search$/);
  await expect.poll(async () => (await searchDockState(page)).progress).toBeCloseTo(1, 2);
  dock = await searchDockState(page);
  expect(dock.textOpacity).toBe(1);
  expect(dock.focused).toBe(false);
  const leaving = await beginSwipe(page, isMobile, 55, 400);
  await leaving.move(width * 0.65);
  dock = await searchDockState(page);
  expect(dock.progress).toBeCloseTo(0.35, 2);
  expect(dock.textOpacity).toBeCloseTo(0, 2);
  await expect(page).toHaveURL(/\/search$/);
  await leaving.end(true);
  await expect.poll(async () => (await searchDockState(page)).progress).toBeCloseTo(1, 2);
  await swipe(page, isMobile, width * 0.65, { x: 55, y: 400 });
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await searchDockState(page)).progress).toBeCloseTo(0, 2);
  dock = await searchDockState(page);
  expect(dock.textOpacity).toBe(0);
});

test('Search tags and results allow page swipes while keeping their tap actions', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await seedNotes(page, ['Swipeable search result']);
  await swipe(page, isMobile, -140);
  await expect(page).toHaveURL(/\/search$/);
  const tag = page.getByRole('button', { name: 'Browse Untagged', exact: true });
  let box = await settledBox(tag);
  const tagSwipe = await beginSwipe(page, isMobile, box.x + 40, box.y + box.height / 2);
  await tagSwipe.move(140);
  expect(
    await page
      .locator('[data-pager-page="/search"] [data-page-content]')
      .evaluate((el) => el.getBoundingClientRect().x),
  ).toBeCloseTo(140, 0);
  await tagSwipe.end(true);
  await expect(page.locator('[data-pager-page]')).toHaveCount(1);
  await tag.click();
  const result = page.getByRole('button', { name: 'Open note', exact: true });
  await expect(result).toHaveText('Swipeable search result');
  box = await settledBox(result);
  await swipe(page, isMobile, 140, { x: box.x + 40, y: box.y + box.height / 2 });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('dialog')).toBeHidden();
  // Search keeps its filter while it is still sliding away; let it unmount first.
  await expect(page.locator('[data-pager-page]')).toHaveCount(1);
  await swipe(page, isMobile, -140);
  await expect(page).toHaveURL(/\/search$/);
  await tag.click();
  await result.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('textbox')).toContainText(
    'Swipeable search result',
  );
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

test('pages and headers track the finger before release and retain the incoming DOM on commit', async ({
  page,
  isMobile,
}, testInfo) => {
  await signUp(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const dock = await settledBox(page.locator('[data-dock]').first());
  const gesture = await beginSwipe(page, isMobile);
  await gesture.move(-120);
  const current = page.locator('[data-pager-page="/"]');
  const incoming = page.locator('[data-pager-page="/search"]');
  await expect(incoming.locator('[data-page-header]')).toBeAttached();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await current.locator('[data-page-content]').evaluate((el) => el.getBoundingClientRect().x),
  ).toBeCloseTo(-120, 0);
  expect(
    await current.locator('[data-page-header]').evaluate((el) => el.getBoundingClientRect().x),
  ).toBeCloseTo(-120, 0);
  const width = await page.evaluate(() => innerWidth);
  expect(
    await incoming.locator('[data-page-content]').evaluate((el) => el.getBoundingClientRect().x),
  ).toBeCloseTo(width - 120, 0);
  expect(
    await incoming.locator('[data-page-header]').evaluate((el) => el.getBoundingClientRect().x),
  ).toBeCloseTo(width - 120, 0);
  await expect(incoming).toHaveAttribute('inert');
  await expect(page.locator('[data-pager-page]')).toHaveCount(2);
  await incoming.evaluate((el) => el.setAttribute('data-preview-instance', 'retained'));
  const held = await page.locator('[data-dock]').first().boundingBox();
  expect(held?.x).toBeCloseTo(dock.x, 0);
  expect(held?.y).toBeCloseTo(dock.y, 0);
  await testInfo.attach('partial-swipe', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await gesture.move(-140);
  await gesture.end();
  await expect(page).toHaveURL(/\/search$/);
  await expect(incoming).toHaveAttribute('data-preview-instance', 'retained');
  await expect(incoming).not.toHaveAttribute('inert');
  await expect(page.locator('[data-pager-page]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});

test('a held swipe can reverse, cancel and spring home without navigating', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const gesture = await beginSwipe(page, isMobile);
  await gesture.move(-140);
  await expect(page.locator('[data-pager-page="/search"]')).toBeAttached();
  await gesture.move(70);
  await expect(page.locator('[data-pager-page="/deck"]')).toBeAttached();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page
      .locator('[data-pager-page="/"] [data-page-content]')
      .evaluate((el) => el.getBoundingClientRect().x),
  ).toBeCloseTo(70, 0);
  await gesture.end(true);
  await expect(page.locator('[data-pager-page]')).toHaveCount(1);
  await expect
    .poll(() => page.locator('[data-page-content]').evaluate((el) => el.getBoundingClientRect().x))
    .toBe(0);
  await expect(page).toHaveURL(/\/$/);
});

test('a scrolled gallery previews and returns at its own scroll position', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await seedNotes(page, [
    { title: 'Tall note', body: 'Enough content to scroll this page. '.repeat(180) },
    'Short note one',
    'Short note two',
  ]);
  await expect(card(page, 'Tall note')).toBeVisible();
  await page.evaluate(() => scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
  // Leave broad blank space beside the tall note. Android's touch targeting can
  // redirect a touch in a thin gutter to a card, which owns swipe-to-archive.
  const x = await page.evaluate(() => innerWidth - 100);
  await swipe(page, isMobile, -140, { x, y: 180 });
  await expect(page).toHaveURL(/\/search$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  const gesture = await beginSwipe(page, isMobile, 130);
  await gesture.move(140);
  const preview = page.locator('[data-pager-page="/"]');
  await expect(preview.locator('[data-page-header]')).toBeAttached();
  await expect(
    preview.getByRole('button', { name: 'Scroll to top', includeHidden: true }),
  ).toBeEnabled();
  await gesture.end();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
});

test('another touch can take over a settling swipe', async ({ page, isMobile }) => {
  await signUp(page);
  const first = await beginSwipe(page, isMobile);
  await first.move(-60);
  await first.end();
  const second = await beginSwipe(page, isMobile, 100);
  await second.move(200);
  await expect(page).toHaveURL(/\/$/);
  await second.end();
  await expect(page).toHaveURL(/\/deck$/);
  await expect(page.locator('[data-pager-page]')).toHaveCount(1);
});

test('the next swipe starts on the arriving page while the last one settles', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedNotes(page, ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']);
  await expect(card(page, 'Eight')).toBeVisible();
  const y = await page.evaluate(() => Math.round(innerHeight * 0.6));
  await swipe(page, isMobile, -160);
  // Search is short, so this lands on blank space where the Gallery's cards just were.
  const second = await beginSwipe(page, isMobile, 130, y);
  await expect(page).toHaveURL(/\/search$/);
  await second.move(160);
  await second.end();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-pager-page]')).toHaveCount(1);
});
