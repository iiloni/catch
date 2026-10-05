import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { createNote, openNote, settledBox, signUp, waitForPageTransition } from './helpers';

async function pullSettings(touch: CDPSession, delta: number, whileHeld?: () => Promise<void>) {
  let timestamp = Date.now() / 1000;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 16, y: 240 }],
    timestamp,
  });
  const distances = [4, 10, 20, 40, 60, 90, 120, 150].filter(
    (distance) => distance <= Math.abs(delta),
  );
  for (const distance of distances) {
    // A short pull must be slow: like notes, a quick flick also dismisses the surface.
    timestamp += Math.abs(delta) < 110 ? 0.08 : 0.016;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 16, y: 240 + Math.sign(delta) * distance }],
      timestamp,
    });
  }
  // Rest on the page so release is not a fling and the next tap still works.
  await new Promise((resolve) => setTimeout(resolve, 200));
  timestamp += 0.2;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 16, y: 240 + delta }],
    timestamp,
  });
  await whileHeld?.();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: timestamp + 0.016,
  });
}

async function settingsPositions(page: Page) {
  return page.evaluate(() => {
    const selectors = [
      '[data-settings-swipe] h1',
      '[data-settings-content]',
      '[data-page-header]',
      '[data-dock]',
      '[data-page-bottom-blur]',
    ];
    return {
      scroll: window.scrollY,
      layers: selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing settings layer: ${selector}`);
        return { selector, top: element.getBoundingClientRect().top };
      }),
    };
  });
}

async function watchSettingsTitle(page: Page) {
  await page.evaluate(() => {
    const title = document.querySelector('[data-settings-swipe] h1');
    if (!title) throw new Error('Settings title is missing');
    const titles: string[] = [];
    const record = () => {
      const text = title.textContent ?? '';
      if (titles.at(-1) !== text) titles.push(text);
      document.documentElement.dataset.settingsTitleHistory = JSON.stringify(titles);
    };
    record();
    // A final URL assertion misses changes to the outgoing view-transition snapshot.
    const observer = new MutationObserver(record);
    observer.observe(title, { childList: true, characterData: true, subtree: true });
  });
}

async function expectSettingsTitleUnchanged(page: Page, title: string) {
  const titles = await page.evaluate(() =>
    JSON.parse(document.documentElement.dataset.settingsTitleHistory ?? '[]'),
  );
  expect(titles).toEqual([title]);
}

test('mobile settings leave with a pull at either scroll edge', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, 'Settings swipes are available on the narrow layout.');
  await page.setViewportSize({ width: 393, height: 500 });
  await signUp(page);
  const galleryUrl = page.url();
  const touch = await page.context().newCDPSession(page);

  for (const direction of [1, -1]) {
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Link capture', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await waitForPageTransition(page);
    const overflow = await page.evaluate((toward) => {
      const scroll = document.documentElement;
      window.scrollTo(0, toward > 0 ? 0 : scroll.scrollHeight);
      return scroll.scrollHeight - scroll.clientHeight;
    }, direction);
    expect(overflow).toBeGreaterThan(100);

    // Observe the held gesture: every part of the page must travel the same distance.
    await watchSettingsTitle(page);
    const before = await settingsPositions(page);
    await pullSettings(touch, direction * 150, async () => {
      await expect
        .poll(async () => {
          const held = await settingsPositions(page);
          return (held.layers[1].top - before.layers[1].top) * direction;
        })
        .toBeGreaterThan(60);
      const held = await settingsPositions(page);
      const distance = held.layers[1].top - before.layers[1].top;
      expect(held.scroll).toBe(before.scroll);
      for (const [index, layer] of held.layers.entries()) {
        expect(layer.top - before.layers[index].top, layer.selector).toBeCloseTo(distance, 0);
      }
      await testInfo.attach(`settings-pull-${direction > 0 ? 'down' : 'up'}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
    await expect(page).toHaveURL(galleryUrl);
    await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
    await waitForPageTransition(page);
    await expectSettingsTitleUnchanged(page, 'General');
    await expect(page.locator('[data-dock]')).toHaveCSS('transform', 'none');
  }

  // A directly opened short page has no Settings history entry to return through.
  await page.goto('/settings/account');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await waitForPageTransition(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await watchSettingsTitle(page);
  await pullSettings(touch, -150);
  await expect(page).toHaveURL(galleryUrl);
  await waitForPageTransition(page);
  await expectSettingsTitleUnchanged(page, 'Account');
});

test('mobile settings retain the page title while navigating back', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The narrow settings header names the open page.');
  await signUp(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await waitForPageTransition(page);
  await page.getByRole('button', { name: 'Settings page: General' }).tap();
  await page
    .getByRole('navigation', { name: 'Settings pages' })
    .getByRole('button', { name: 'Account', exact: true })
    .tap();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await waitForPageTransition(page);
  await watchSettingsTitle(page);
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  await waitForPageTransition(page);
  await expectSettingsTitleUnchanged(page, 'Account');
});

test('mobile settings scroll normally and keep short pulls open', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Settings swipes are available on the narrow layout.');
  await page.setViewportSize({ width: 393, height: 500 });
  await signUp(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(page.getByRole('region', { name: 'Link capture', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await waitForPageTransition(page);
  const settingsUrl = page.url();
  const touch = await page.context().newCDPSession(page);

  await pullSettings(touch, 40);
  await expect(page).toHaveURL(settingsUrl);
  for (const selector of [
    '[data-settings-content]',
    '[data-page-header]',
    '[data-dock]',
    '[data-page-bottom-blur]',
  ]) {
    await expect(page.locator(selector)).toHaveCSS('transform', 'none');
  }

  // An upward gesture at the top must scroll into the page instead of leaving it.
  await pullSettings(touch, -150);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  await expect(page).toHaveURL(settingsUrl);

  const middle = await page.evaluate(() => {
    const scroll = document.documentElement;
    const top = (scroll.scrollHeight - scroll.clientHeight) / 2;
    window.scrollTo(0, top);
    return window.scrollY;
  });
  await pullSettings(touch, 150);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(middle - 50);
  await expect(page).toHaveURL(settingsUrl);

  // At the bottom, a downward gesture scrolls back into the page.
  const bottom = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return window.scrollY;
  });
  await pullSettings(touch, 150);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(bottom - 50);
  await expect(page).toHaveURL(settingsUrl);
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
});

test('settings pages load promptly while all seven collections keep syncing over HTTP', async ({
  page,
  isMobile,
}) => {
  const polls = new Map<string, number>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith('/api/shapes/') &&
      (url.searchParams.get('live') === 'true' || url.searchParams.has('cache-buster'))
    )
      polls.set(url.pathname, (polls.get(url.pathname) ?? 0) + 1);
  });
  await signUp(page);
  await createNote(page, 'Navigation while syncing');
  if (!isMobile) await openNote(page, 'Navigation while syncing');
  await page.evaluate(async () => {
    const collections = await import('/src/lib/collections.ts');
    await Promise.all(
      [
        collections.notesCollection,
        collections.boardColumnsCollection,
        collections.linkPreviewsCollection,
        collections.attachmentsCollection,
        collections.tagsCollection,
        collections.noteTagsCollection,
        collections.remindersCollection,
      ].map((collection) => collection.preload()),
    );
  });
  await expect.poll(() => [...polls.values()].filter((count) => count >= 2).length).toBe(7);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Appearance', exact: true })).toBeVisible({
    timeout: 4000,
  });
  const pages = page.getByRole('navigation', { name: 'Settings pages' });
  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: General' }).click();
    await pages.getByRole('button', { name: 'Tags', exact: true }).click();
  } else {
    await pages.getByRole('link', { name: 'Tags', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'New tag', exact: true })).toBeVisible({
    timeout: 4000,
  });
  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: Tags' }).click();
    await pages.getByRole('button', { name: 'Account', exact: true }).click();
  } else {
    await pages.getByRole('link', { name: 'Account', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({
    timeout: 4000,
  });
});

/** Update is a user setting, with the project's links and the server's version. */
async function expectUpdatePage(page: Page) {
  await expect(page).toHaveURL(/\/settings\/update$/);
  await expect(page.getByRole('region', { name: 'Version', exact: true })).toContainText(
    'Server version',
  );
  await expect(page.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute(
    'href',
    'https://github.com/iiloni/catch',
  );
  await expect(page.getByRole('link', { name: 'GitHub releases' })).toHaveAttribute(
    'href',
    'https://github.com/iiloni/catch/releases',
  );
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  await expect(page.getByText('App version', { exact: true })).toBeHidden();
}

test('settings list their pages beside the open one on wide screens', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Phones pick pages from the dock.');
  await signUp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  // The page list takes the dock's place.
  await expect(page.getByRole('button', { name: 'New note' })).toBeHidden();

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'System' }).click();

  const pages = page.getByRole('navigation', { name: 'Settings pages' });
  await pages.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await pages.getByRole('link', { name: 'Update', exact: true }).click();
  await expectUpdatePage(page);

  // Switching pages replaced history, so one step back leaves Settings.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('on phones the dock picks settings pages, also by holding and sliding', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!isMobile, 'Wide screens list the pages beside the open one.');
  await signUp(page);
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await waitForPageTransition(page);

  const selector = page.getByRole('button', { name: 'Settings page: General' });
  await selector.tap();
  const picker = page.getByRole('navigation', { name: 'Settings pages' });
  await picker.getByRole('button', { name: 'Account' }).tap();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await waitForPageTransition(page);
  await expect(picker).toBeHidden();

  // Hold the selector, slide onto General and let go.
  const box = await settledBox(page.getByRole('button', { name: 'Settings page: Account' }));
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await expect(picker).toBeVisible();
  const target = await settledBox(picker.getByRole('button', { name: 'General' }));
  const end = target.y + target.height / 2;
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y + ((end - start.y) * step) / 6 }],
    });
  }
  // A finger lifted while still moving is a fling to Chrome, which then drops the click of
  // the next tap. Rest on the page first, as a person does.
  await page.waitForTimeout(200);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x, y: end }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await waitForPageTransition(page);

  await page.getByRole('button', { name: 'Settings page: General' }).tap();
  await picker.getByRole('button', { name: 'Update', exact: true }).tap();
  await expectUpdatePage(page);
  await waitForPageTransition(page);

  await page.getByRole('button', { name: 'Back' }).tap();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});
