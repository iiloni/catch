import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('dev builds offer all icon choices on preview servers and leave Update branding alone', async ({
  page,
}) => {
  let channel = 'preview';
  await page.route('**/api/updates', (route) =>
    route.fulfill({ json: { version: null, channel } }),
  );
  await signUp(page);
  await page.goto('/settings/general');
  const picker = page.getByRole('region', { name: 'App icon', exact: true });
  const stable = picker.getByRole('button', { name: 'Stable', exact: true });
  const preview = picker.getByRole('button', { name: 'Preview', exact: true });
  await expect(picker.getByRole('button', { name: 'Dev', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/dev/favicon-mark.svg',
  );
  await preview.click();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/preview/favicon-mark.svg',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/preview/apple-touch-icon.png',
  );
  await page.reload();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/preview/favicon-mark.svg',
  );
  await stable.click();
  await expect(stable).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/favicon-mark.svg',
  );
  await page.goto('/settings/update');
  await expect(page.locator('img[alt="Catch"][src*="catch-lockup-stacked-"]')).toHaveAttribute(
    'src',
    /stacked-preview-/,
  );
  await page.goto('/settings/general');
  await preview.click();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  channel = 'stable';
  await page.reload();
  await expect(picker).toBeVisible();
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/preview/favicon-mark.svg',
  );
});

test('dev builds default to dev and preview the selected icon above three text-only choices', async ({
  page,
}) => {
  await signUp(page);
  await page.goto('/settings/general');
  const picker = page.getByRole('region', { name: 'App icon', exact: true });
  await expect(picker.getByRole('button', { name: 'Dev', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(picker.getByRole('img', { name: 'Dev app icon', exact: true })).toHaveAttribute(
    'src',
    '/dev/icon-small.svg',
  );
  await expect(picker.locator('button img')).toHaveCount(0);
  for (const [name, path] of [
    ['Stable', ''],
    ['Preview', '/preview'],
    ['Dev', '/dev'],
  ] as const) {
    await picker.getByRole('button', { name, exact: true }).click();
    await expect(
      picker.getByRole('img', { name: `${name} app icon`, exact: true }),
    ).toHaveAttribute('src', `${path}/icon-small.svg`);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
      'href',
      `${path}/favicon-mark.svg`,
    );
  }
  await page.reload();
  await expect(picker.getByRole('button', { name: 'Dev', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(picker.getByRole('img', { name: 'Dev app icon', exact: true })).toBeVisible();
});
