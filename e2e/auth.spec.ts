import { expect, test } from '@playwright/test';
import { createNote, openNote, signUp } from './helpers';

test('signing in returns to the linked note, including after a failed attempt and reload', async ({
  page,
}) => {
  const email = await signUp(page);
  await createNote(page, 'Linked note', 'Open this note after signing in.');
  await openNote(page, 'Linked note');
  const noteUrl = new URL(page.url());
  const destination = `${noteUrl.pathname}${noteUrl.search}#details`;

  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(destination);
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination);
  await page.reload();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrongpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination);

  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new URL(destination, noteUrl.origin).href);
  await expect(page.getByRole('dialog').getByRole('textbox')).toContainText('Linked note');
});

test('creating an account returns to the original page with its query and fragment', async ({
  page,
}) => {
  const destination = '/archive?source=shared+link#saved';
  await page.goto(destination);
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination);
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(`e2e-${crypto.randomUUID()}@example.com`);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(new URL(destination, page.url()).href);
  await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
});

test('signing in directly still opens the gallery', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
});
