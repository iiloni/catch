import { expect, type Page, test } from '@playwright/test';

async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Catch' })).toBeVisible();
}

test('notes sync across tabs and survive a reload', async ({ page, context }) => {
  await signUp(page);

  await page.getByLabel('New note').fill('Buy oat milk');
  await page.getByLabel('New note').press('Enter');
  await expect(page.getByRole('heading', { name: 'Buy oat milk' })).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await expect(otherTab.getByRole('heading', { name: 'Buy oat milk' })).toBeVisible();

  await otherTab.getByLabel('New note').fill('Call the plumber');
  await otherTab.getByLabel('New note').press('Enter');
  await expect(page.getByRole('heading', { name: 'Call the plumber' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Buy oat milk' })).toBeVisible();

  await page.getByRole('heading', { name: 'Buy oat milk' }).hover();
  await page
    .getByRole('article')
    .filter({ hasText: 'Buy oat milk' })
    .getByRole('button', { name: 'Move to trash' })
    .click();
  await expect(otherTab.getByRole('heading', { name: 'Buy oat milk' })).toBeHidden();
});

test('users only see their own notes', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await signUp(alice);
  await alice.getByLabel('New note').fill('Alice secret');
  await alice.getByLabel('New note').press('Enter');
  await expect(alice.getByRole('heading', { name: 'Alice secret' })).toBeVisible();

  const bob = await (await browser.newContext()).newPage();
  await signUp(bob);
  await expect(bob.getByText('Alice secret')).toBeHidden();
});
