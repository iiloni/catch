import { expect, test } from '@playwright/test';
import {
  API_PROTOCOL_HEADER,
  API_PROTOCOL_VERSION,
  SUPPORTED_API_PROTOCOLS,
} from '../packages/shared/src/protocol';
import { card, createNote, signIn, signUp } from './helpers';

test('the server refuses unsupported writes and shapes while recovery stays reachable', async ({
  request,
}) => {
  for (const [path, method] of [
    ['/api/notes', 'POST'],
    ['/api/shapes/notes', 'GET'],
  ] as const) {
    const response = await request.fetch(path, { method, headers: { [API_PROTOCOL_HEADER]: '' } });
    expect(response.status()).toBe(426);
    expect(await response.json()).toMatchObject({
      code: 'INCOMPATIBLE_PROTOCOL',
      protocol: SUPPORTED_API_PROTOCOLS,
    });
  }
  const response = await request.get('/api/compatibility', {
    headers: { [API_PROTOCOL_HEADER]: '' },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(SUPPORTED_API_PROTOCOLS);
});

test('an incompatible server pauses sync, retains queued edits through reload, and resumes', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = await signUp(page);
  const firstSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/notes' &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await createNote(page, 'Before upgrade');
  await firstSave;

  const protocol = { min: API_PROTOCOL_VERSION + 1, max: API_PROTOCOL_VERSION + 1 };
  let rejectedWrites = 0;
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/compatibility') return route.fulfill({ json: protocol });
    if (path.startsWith('/api/auth/') || path.startsWith('/api/updates') || path === '/api/health')
      return route.continue();
    if (route.request().method() === 'POST') rejectedWrites++;
    return route.fulfill({
      status: 426,
      json: { code: 'INCOMPATIBLE_PROTOCOL', error: 'Update required', protocol },
    });
  });

  // The initial bootstrap is still cached: rejection of this write tests the upgrade race.
  await createNote(page, 'Queued during upgrade');
  const paused = page.getByRole('button', { name: /^App update required/ });
  await expect(paused).toBeVisible();
  await expect(card(page, 'Queued during upgrade')).toBeVisible();
  expect(rejectedWrites).toBeGreaterThan(0);
  await paused.click();
  await expect(page.getByText(/local notes and queued changes are kept/)).toBeVisible();
  await page.getByRole('link', { name: 'View updates' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This app needs an update' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeEnabled();

  await page.goto('/');
  await expect(card(page, 'Before upgrade')).toBeVisible();
  await expect(card(page, 'Queued during upgrade')).toBeVisible();
  await createNote(page, 'Another queued note');
  await page.reload();
  await expect(card(page, 'Queued during upgrade')).toBeVisible();
  await expect(card(page, 'Another queued note')).toBeVisible();
  await expect(paused).toBeVisible();

  await page.unroute('**/api/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(paused).toBeHidden();
  const device = await browser.newContext();
  try {
    const fresh = await device.newPage();
    await signIn(fresh, email);
    for (const title of ['Before upgrade', 'Queued during upgrade', 'Another queued note']) {
      await expect(card(fresh, title)).toBeVisible({ timeout: 15_000 });
    }
  } finally {
    await device.close();
  }
});

test('a pre-protocol server asks for a server update without blocking settings', async ({
  page,
}) => {
  await signUp(page);
  await createNote(page, 'Local note');
  await page.route('**/api/compatibility', (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: /^Server update required/ })).toBeVisible();
  await page.goto('/settings/update');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your server needs an update' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});
