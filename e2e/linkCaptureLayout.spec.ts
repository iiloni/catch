import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { settledBox, signUp } from './helpers';

async function keyboard(page: Page, height: number) {
  await page.evaluate(async (height) => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    const from = keyboardHeight.get();
    for (let step = 1; step <= 10; step++) {
      await new Promise(requestAnimationFrame);
      keyboardHeight.set(from + ((height - from) * step) / 10);
    }
  }, height);
}

async function expectFieldsFit(surface: Locator, height: number, keyboardHeight = 0) {
  await expect
    .poll(() =>
      surface.evaluate(
        (surface, { height, keyboardHeight }) => {
          const form = surface.querySelector('form');
          const area = form?.querySelector('[data-slot="scroll-area-viewport"]');
          const footer = surface.hasAttribute('data-link-overlay')
            ? document.querySelector('[data-dock]')
            : form?.querySelector('[data-capture-actions]');
          if (!area || !footer) throw new Error('Missing capture form');
          const windowBounds = surface.getBoundingClientRect();
          const scrollBounds = area.getBoundingClientRect();
          const footerBounds = footer.getBoundingClientRect();
          return (
            windowBounds.top >= -1 &&
            windowBounds.bottom <= height - keyboardHeight + 1 &&
            scrollBounds.height > 0 &&
            scrollBounds.bottom <= footerBounds.top &&
            footerBounds.bottom <= height - keyboardHeight + 1 &&
            surface.scrollWidth <= surface.clientWidth
          );
        },
        { height, keyboardHeight },
      ),
    )
    .toBe(true);
}

async function expectFocusVisible(surface: Locator) {
  await expect
    .poll(() =>
      surface.evaluate((surface) => {
        const area = surface.querySelector('[data-slot="scroll-area-viewport"]');
        const focused = document.activeElement;
        if (!area || !focused || !area.contains(focused)) return false;
        const bounds = area.getBoundingClientRect();
        const field = focused.getBoundingClientRect();
        return field.top >= bounds.top - 1 && field.bottom <= bounds.bottom + 1;
      }),
    )
    .toBe(true);
}

for (const entry of ['sheet', 'bookmarklet', 'share'] as const) {
  test(`${entry}: small screens scroll the fields and keep actions above an overlay keyboard`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await signUp(page);
    const token = await page.evaluate(() => localStorage.getItem('catch-auth-token'));
    for (let index = 0; index < 10; index++) {
      const uuid = randomUUID();
      const response = await page.request.post('/api/tags', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          id: `${uuid.slice(0, 14)}7${uuid.slice(15)}`,
          name: `Capture tag ${index}`,
          parentId: null,
          color: null,
          icon: null,
        },
      });
      expect(response.ok()).toBeTruthy();
    }
    await page.route('**/api/link-previews/intake', (route) =>
      route.fulfill({
        json: {
          title: 'Shared page',
          description: 'Page details',
          siteName: 'Example',
          imageHash: null,
          imageWidth: null,
          imageHeight: null,
          iconHash: null,
          hue: null,
        },
      }),
    );
    if (entry === 'sheet') {
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      await page.getByRole('button', { name: 'Save link', exact: true }).click();
    } else if (entry === 'bookmarklet')
      await page.goto('/capture#url=https%3A%2F%2Fexample.com%2F');
    else {
      const id = await page.evaluate(async () => {
        const { captureWebShare } = await import('/src/lib/shareInbox.ts');
        const form = new FormData();
        form.set('text', 'https://example.com/');
        return captureWebShare(form);
      });
      await page.goto(`/share?id=${id}`);
    }
    const surface =
      entry === 'sheet'
        ? page.getByRole('dialog', { name: 'Add Rich Link', exact: true })
        : page.locator('main');
    await expect(surface.getByLabel('URL', { exact: true })).toBeVisible();
    if (entry === 'sheet') {
      await surface.getByLabel('URL', { exact: true }).fill('https://example.com/');
      await surface.getByRole('button', { name: 'Fetch details' }).click();
    }
    await expect(surface.getByLabel('Description')).toHaveValue('Page details');
    await settledBox(surface.locator('[data-link-details]'));
    await settledBox(surface);
    await expectFieldsFit(surface, 480);
    const area = surface.locator('[data-slot="scroll-area-viewport"]');
    // Scroll the actual container: Chromium reports fieldset overflow without allowing
    // its scrollTop to move, which previously left these fields over the footer.
    await area.evaluate((area) => {
      area.scrollTop = area.scrollHeight;
    });
    expect(await area.evaluate((area) => area.scrollTop)).toBeGreaterThan(0);
    await surface.getByLabel('Your notes').fill('Small screen capture');
    await expectFocusVisible(surface);
    await expect(page.getByRole('button', { name: 'Save link', exact: true })).toBeInViewport();

    await page.setViewportSize({ width: 360, height: 740 });
    await surface.getByLabel('Your notes').focus();
    await keyboard(page, 300);
    await expectFieldsFit(surface, 740, 300);
    await expectFocusVisible(surface);
    await page.keyboard.type(' with the keyboard open');
    await expect(surface.getByLabel('Your notes')).toHaveValue(
      'Small screen capture with the keyboard open',
    );
    await surface.getByLabel('URL', { exact: true }).focus();
    await expectFocusVisible(surface);

    await surface.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
    const destination = page.getByRole('dialog', { name: 'Save to', exact: true });
    await expect(
      destination.getByRole('button', { name: 'New Default', exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await destination.boundingBox();
        return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 440);
      })
      .toBe(true);
    await destination.getByRole('button', { name: 'In progress', exact: true }).click();
    await expect(
      surface.getByRole('button', { name: 'Save to Deck · In progress', exact: true }),
    ).toBeVisible();

    await surface.getByRole('button', { name: 'Choose tags' }).click();
    const picker = page.getByRole('dialog', { name: 'Secondary tags', exact: true });
    await expect(
      picker.getByRole('checkbox', { name: 'Capture tag 0', exact: true }),
    ).toBeVisible();
    await picker.getByRole('textbox', { name: 'Find tags' }).focus();
    // The overlay keyboard changes while search has focus, without resizing the viewport.
    for (const height of [300, 380, 0, 300]) {
      await keyboard(page, height);
      await expect
        .poll(async () => {
          const bounds = await picker.boundingBox();
          return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 740 - height);
        })
        .toBe(true);
    }
    const tagList = picker.locator('[data-slot="scroll-area-viewport"]');
    await tagList.evaluate((area) => {
      area.scrollTop = area.scrollHeight;
    });
    expect(await tagList.evaluate((area) => area.scrollTop)).toBeGreaterThan(0);
    await picker.getByRole('checkbox', { name: 'Capture tag 9', exact: true }).check();
    await picker.getByRole('textbox', { name: 'Find tags' }).fill('Capture tag 9');
    await expect(
      picker.getByRole('checkbox', { name: 'Capture tag 9', exact: true }),
    ).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();

    await keyboard(page, 0);
    await page.setViewportSize({ width: 640, height: 360 });
    await expectFieldsFit(surface, 360);
    await surface.getByLabel('Your notes').focus();
    await expectFocusVisible(surface);
    await page.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(surface.getByLabel('URL', { exact: true })).toBeHidden();
  });
}
