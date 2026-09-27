import { expect, type Page } from '@playwright/test';

/** Signs up a fresh user, so each test starts with no notes. */
export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  return email;
}

/** Creates a note through the "Take a note…" composer. */
export async function createNote(page: Page, title: string, body?: string) {
  await page.getByRole('button', { name: 'Take a note…' }).click();
  // The editor loads lazily; wait until it can take keystrokes.
  await expect(page.getByRole('textbox').and(page.locator('[contenteditable]'))).toBeFocused();
  await page.keyboard.type(title);
  if (body) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(body);
  }
  await page
    .getByRole('region', { name: 'New note' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(card(page, title)).toBeVisible();
}

export function card(page: Page, title: string) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });
}

/** Opens a note in the editor dialog and returns the dialog. */
export async function openNote(page: Page, title: string) {
  await card(page, title).getByRole('button', { name: 'Open note' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Runs a toolbar action from the editor dialog, which works on touch and desktop. */
export async function noteAction(page: Page, title: string, action: string) {
  const dialog = await openNote(page, title);
  await dialog.getByRole('button', { name: action }).click();
  return dialog;
}
