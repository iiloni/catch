import { expect, test } from '@playwright/test';
import { openGalleryPage, settledBox, signUp, waitForPageTransition } from './helpers';

test('search reverses unfinished dock morphs without replacing the side button', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);

  const result = await page
    .getByRole('link', { name: 'Search', exact: true })
    .evaluate(async (link) => {
      const field = document.querySelector<HTMLElement>('[data-dock] search');
      const input = field?.querySelector('input');
      const side = document.querySelector('[data-dock] button[aria-label="New note"]');
      if (!field || !input || !side) throw new Error('Missing dock controls');
      const left = () => {
        const insets = getComputedStyle(field).clipPath.match(/^inset\(([^r]+) round/);
        if (!insets) throw new Error('Missing field clip');
        const values = insets[1].trim().split(/\s+/).map(Number.parseFloat);
        return values[3] ?? values[1] ?? values[0];
      };
      const closed = left();
      let interruptedAt: number | null = null;
      let reopenedAt: number | null = null;
      let sameSide = true;
      (link as HTMLElement).click();
      const end = performance.now() + 10_000;
      while (performance.now() < end) {
        await new Promise(requestAnimationFrame);
        const inset = left();
        sameSide &&= side.isConnected;
        if (interruptedAt === null && inset > 10 && inset < closed - 10) {
          interruptedAt = inset;
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } else if (
          interruptedAt !== null &&
          reopenedAt === null &&
          field.getAttribute('aria-hidden') === 'true' &&
          inset > interruptedAt + 5 &&
          inset < closed - 5
        ) {
          reopenedAt = inset;
          (link as HTMLElement).click();
        } else if (
          reopenedAt !== null &&
          inset === 0 &&
          field.getAttribute('aria-hidden') === 'false'
        ) {
          return {
            interruptedAt,
            reopenedAt,
            sameSide,
            focused: document.activeElement === input,
            sideLabel: side.getAttribute('aria-label'),
          };
        }
      }
      throw new Error(`Search did not reverse: ${JSON.stringify({ interruptedAt, reopenedAt })}`);
    });
  expect(result.interruptedAt).toBeGreaterThan(0);
  expect(result.reopenedAt).toBeGreaterThan(result.interruptedAt!);
  expect(result.sameSide).toBe(true);
  expect(result.focused).toBe(true);
  expect(result.sideLabel).toBe('Filter notes');
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole('textbox', { name: 'Search notes' })).toHaveCSS('opacity', '1');
});

test('reduced motion switches search controls immediately and keeps keyboard focus', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUp(page);
  const states = await page
    .getByRole('link', { name: 'Search', exact: true })
    .evaluate(async (link) => {
      const field = document.querySelector<HTMLElement>('[data-dock] search');
      const input = field?.querySelector('input');
      const side = document.querySelector('[data-dock] button[aria-label="New note"]');
      if (!field || !input || !side) throw new Error('Missing dock controls');
      const snapshot = () => ({
        clip: getComputedStyle(field).clipPath,
        label: side.getAttribute('aria-label'),
        focused: document.activeElement === input,
      });
      (link as HTMLElement).click();
      await new Promise(requestAnimationFrame);
      const opened = snapshot();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(requestAnimationFrame);
      return { opened, closed: snapshot(), sameSide: side.isConnected };
    });
  expect(states.opened.clip).toMatch(/^inset\(0px round/);
  expect(states.opened.label).toBe('Filter notes');
  expect(states.opened.focused).toBe(true);
  expect(states.closed.clip).not.toMatch(/^inset\(0px round/);
  expect(states.closed.label).toBe('New note');
  expect(states.closed.focused).toBe(false);
  expect(states.sameSide).toBe(true);
  await expect(page).not.toHaveURL(/\/search$/);
});

test('back navigation clears a pending search intent before revisiting Archive', async ({
  page,
}) => {
  await signUp(page);
  await openGalleryPage(page, 'Archive');
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  await openGalleryPage(page, 'Archive');
  await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search notes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
});

test('a touch tap opens search instead of closing it with its trailing click', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'needs touch input');
  await signUp(page);
  await waitForPageTransition(page);
  const link = page.getByRole('link', { name: 'Search', exact: true });
  const box = await settledBox(link);
  // The tap trails a compatibility click; with the close button mounted under the
  // finger by then, search must stay open.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole('textbox', { name: 'Search notes' })).toBeVisible();
  // A later tap on Close still leaves search.
  await page.waitForTimeout(400);
  await waitForPageTransition(page);
  const close = page.getByRole('button', { name: 'Close search', exact: true });
  const closeBox = await settledBox(close);
  await page.touchscreen.tap(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
  await expect(page).not.toHaveURL(/\/search$/);
});

test('search page slides while its dock transition follows the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);
  const directions = await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    const root = document.documentElement;
    const dock = document.querySelector('[data-dock]');
    if (!dock) throw new Error('Missing dock');
    const directions: { samples: number; positionError: number; pageTravel: number }[] = [];
    for (const opening of [true, false]) {
      keyboardHeight.jump(opening ? 0 : 320);
      const trigger = dock.querySelector<HTMLElement>(
        opening ? 'a[aria-label="Search"]' : 'button[aria-label="Close search"]',
      );
      if (!trigger) throw new Error('Missing search control');
      trigger.click();
      let samples = 0;
      let positionError = 0;
      let pageTravel = 0;
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        const height = Math.min(320, (frame + 1) * 16);
        keyboardHeight.set(opening ? height : 320 - height);
        if (!root.matches(':active-view-transition')) continue;
        const group = getComputedStyle(root, '::view-transition-group(dock)');
        const top = Number.parseFloat(group.top);
        const size = Number.parseFloat(group.height);
        // The group acquires its measured bounds once both page snapshots exist.
        if (!Number.isFinite(top) || !Number.isFinite(size)) continue;
        const bottom = innerHeight - top - size;
        const expected = Number.parseFloat(getComputedStyle(dock).bottom);
        positionError = Math.max(positionError, Math.abs(bottom - expected));
        const page = getComputedStyle(root, '::view-transition-new(root)');
        pageTravel = Math.max(pageTravel, Math.abs(new DOMMatrix(page.transform).m41));
        samples++;
      }
      directions.push({ samples, positionError, pageTravel });
    }
    keyboardHeight.jump(0);
    return directions;
  });
  for (const direction of directions) {
    expect(direction.samples).toBeGreaterThan(3);
    expect(direction.positionError).toBeLessThan(1);
    expect(direction.pageTravel).toBeGreaterThan(5);
  }
});
