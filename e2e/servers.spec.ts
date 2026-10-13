import { expect, test } from '@playwright/test';
import { card, seedNotes } from './helpers';

// Enable the installed bundle's connection boundary while retaining browser SQLite for
// these routing/outbox tests. Both mock origins serve the same fixture user ID, as cloned
// servers do; Android's alarm/widget identities have separate native lifecycle tests.
test('Android connections keep restored IDs and offline writes in separate account stores', async ({
  page,
}, info) => {
  const home = 'https://home.catch.test';
  const work = 'https://work.catch.test';
  await page.route(/\/src\/lib\/serverUrl\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /export const supportsMultipleServers = \(\) =>[^;]+;/,
      'export const supportsMultipleServers = () => true;',
    );
    await route.fulfill({ response, body });
  });
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error('Missing worktree URL');
  const routed: string[] = [];
  await page.route(/^https:\/\/(home|work)\.catch\.test\/api\//, async (route) => {
    const url = new URL(route.request().url());
    routed.push(url.origin + url.pathname);
    const response = await route.fetch({
      url: new URL(url.pathname + url.search, base).href,
      headers: { ...(await route.request().allHeaders()), host: new URL(base).host },
    });
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'access-control-allow-origin': new URL(base).origin,
        'access-control-allow-credentials': 'true',
      },
    });
  });
  const email = `e2e-servers-${Date.now()}@example.com`;
  const signup = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: new URL(base).origin },
    data: { email, name: 'Same account', password: 'password123' },
  });
  expect(signup.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByLabel('Server URL').fill(home);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const avatar = page.getByRole('button', { name: 'Account: Same account', exact: true });
  await expect(avatar).toBeVisible();
  await seedNotes(page, ['Cached home note']);
  await expect(card(page, 'Cached home note')).toBeVisible();
  // Keep a write on this device: adding an account must wait for persistence, not delivery.
  await page.route(`${home}/api/**`, (route) => route.abort('internetdisconnected'));
  await page.evaluate(async () => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { waitForPendingWritesStored } = await import('/src/lib/collections.ts');
    createNote({
      userId: getSignedInUser().id,
      content: [{ type: 'heading', props: { level: 3 }, content: 'Unsent home note' }],
    });
    await waitForPendingWritesStored();
  });
  await expect(card(page, 'Unsent home note')).toBeVisible();
  await avatar.click();
  await page.getByRole('link', { name: 'Add account' }).click();
  await expect(page.getByRole('button', { name: 'home.catch.test', exact: true })).toBeVisible();
  await page.getByLabel('Server URL').fill(work);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('work.catch.test', { exact: true })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(avatar).toBeVisible();
  await expect(card(page, 'Unsent home note')).toBeHidden();
  const accounts = await page.evaluate(async () => {
    const { getAccounts } = await import('/src/lib/auth.ts');
    return getAccounts().map(({ id, server, user }) => ({ id, server, userId: user.id }));
  });
  expect(accounts).toHaveLength(2);
  expect(accounts[0]?.userId).toBe(accounts[1]?.userId);
  expect(accounts[0]?.id).not.toBe(accounts[1]?.id);
  await avatar.click();
  await info.attach('android-server-account-switcher', {
    body: await page.screenshot({ path: info.outputPath('server-accounts.png') }),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: /Same account.*home\.catch\.test/ }).click();
  await expect(card(page, 'Unsent home note')).toBeVisible();
  await expect(card(page, 'Cached home note')).toBeVisible();
  // Removing the inactive connection signs out on its own origin and preserves this queue.
  await avatar.click();
  await page
    .getByRole('button', { name: `Sign out ${email} on work.catch.test`, exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(card(page, 'Unsent home note')).toBeVisible();
  await expect.poll(() => routed.includes(`${work}/api/auth/sign-out`)).toBe(true);
  expect(routed.filter((url) => url === `${home}/api/auth/sign-out`)).toEqual([]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
