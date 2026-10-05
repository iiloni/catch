import { expect, type Page, test } from '@playwright/test';
import { card, seedNotes, settledBox, signUp } from './helpers';

const avatar = (page: Page, email: string) =>
  page.getByRole('button', { name: `Account: ${email}`, exact: true });

/** Signs a second account in from the account list, beside the one in use. */
async function addAccount(page: Page, current: string) {
  const email = `e2e-added-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: new URL(page.url()).origin },
    data: { email, name: '', password: 'password123' },
  });
  expect(response.ok()).toBeTruthy();
  await avatar(page, current).click();
  await page.getByRole('link', { name: 'Add account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(avatar(page, email)).toBeVisible({ timeout: 30_000 });
  return email;
}

test('accounts signed in together keep their own notes and switch by tap or swipe', async ({
  page,
}) => {
  const first = await signUp(page);
  await seedNotes(page, ['First account note']);
  await expect(card(page, 'First account note')).toBeVisible();

  const second = await addAccount(page, first);
  await expect(card(page, 'First account note')).toBeHidden();
  await seedNotes(page, ['Second account note']);
  await expect(card(page, 'Second account note')).toBeVisible();

  await avatar(page, second).click();
  const accounts = page.getByRole('list', { name: 'Accounts' });
  await expect(accounts.getByRole('button', { name: second, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await accounts.getByRole('button', { name: first, exact: true }).click();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Switched to ${first}`)).toBeVisible();
  await expect(card(page, 'First account note')).toBeVisible();
  await expect(card(page, 'Second account note')).toBeHidden();
  // The server answers for the account in use, not for the last one to sign in.
  await seedNotes(page, ['Written after switching back']);

  const box = await settledBox(avatar(page, first));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 12, { steps: 3 });
  await page.mouse.move(x, y - 30, { steps: 3 });
  await page.mouse.up();
  await expect(avatar(page, second)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'Second account note')).toBeVisible();
  await expect(card(page, 'Written after switching back')).toBeHidden();
  // A swipe is not a tap: the list stays closed.
  await expect(page.getByRole('list', { name: 'Accounts' })).toBeHidden();
});

test('other tabs follow a switch, and signing out one account leaves the rest', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Tabs and signing out do not depend on the layout.');
  const first = await signUp(page);
  await seedNotes(page, ['First account note']);
  const second = await addAccount(page, first);

  const tab = await page.context().newPage();
  await tab.goto('/');
  await expect(avatar(tab, second)).toBeVisible({ timeout: 30_000 });
  await avatar(page, second).click();
  const accounts = page.getByRole('list', { name: 'Accounts' });
  await accounts.getByRole('button', { name: first, exact: true }).click();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  // The other tab held the second account's notes; it loads again as the first.
  await expect(avatar(tab, first)).toBeVisible({ timeout: 30_000 });
  await expect(card(tab, 'First account note')).toBeVisible();
  await tab.close();

  await avatar(page, first).click();
  await page.getByRole('button', { name: `Sign out ${second}`, exact: true }).click();
  await expect(accounts.getByRole('button', { name: second, exact: true })).toBeHidden();
  await expect(accounts.getByRole('listitem')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Signing out the account in use goes to sign-in only when no other is left.
  await addAccount(page, first);
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'First account note')).toBeVisible();
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Back to your notes' })).toBeHidden();
});
