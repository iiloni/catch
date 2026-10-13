import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('preview servers offer a device icon choice that survives reload and leaves Update branding alone', async ({
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
  await expect(stable).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/favicon-mark.svg',
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
  await expect(picker).toBeHidden();
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/favicon-mark.svg',
  );
});

test('development servers keep the stable icon without an icon chooser', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings/general');
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'App icon', exact: true })).toBeHidden();
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/favicon-mark.svg',
  );
});
