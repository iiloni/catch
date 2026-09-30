import { expect, type Page } from '@playwright/test';

/** Signs up a fresh user, so each test starts with no notes. */
export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  return email;
}

/** Signs in as a user `signUp` created, as on another device. */
export async function signIn(page: Page, email: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
}

/** Creates a note through the quick-note window above the dock. */
export async function createNote(page: Page, title: string, body?: string) {
  await page.getByRole('button', { name: 'New note' }).click();
  // The editor loads lazily; wait until it can take keystrokes.
  await expect(page.getByRole('textbox').and(page.locator('[contenteditable]'))).toBeFocused();
  await page.keyboard.type(title);
  if (body) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(body);
  }
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(card(page, title)).toBeVisible();
}

/** Opens Archive or Trash from the switcher floating above the dock. */
export async function openGalleryPage(page: Page, name: 'Archive' | 'Trash') {
  await page.getByRole('link', { name: 'Gallery' }).click();
  await page
    .getByRole('navigation', { name: 'Gallery pages' })
    .getByRole('button', { name })
    .click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

export async function backToGallery(page: Page) {
  await page.getByRole('button', { name: 'Back to Gallery' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
}

export function card(page: Page, title: string) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });
}

/** Opens a note in the editor and returns it. */
export async function openNote(page: Page, title: string) {
  await card(page, title).getByRole('button', { name: 'Open note' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The editor grows out of the card and swaps in BlockNote once the transition settles.
  await expect(dialog.getByRole('textbox')).toBeVisible();
  return dialog;
}

/** The open note's toolbar, which the dock turns into while the editor is open. */
export function noteToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Note actions' });
}

/** Runs a note action from the editor (its header) or the dock's note toolbar. */
export async function noteAction(page: Page, title: string, action: string) {
  const dialog = await openNote(page, title);
  await dialog.or(noteToolbar(page)).getByRole('button', { name: action, exact: true }).click();
  return dialog;
}

/**
 * Waits for a page slide to finish. While it runs, the transition's snapshots cover the
 * page and take pointer input, which raw mouse gestures (unlike clicks) do not retry.
 */
export async function waitForPageTransition(page: Page) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
}

/** Opens the note's move picker and chooses a deck column or Gallery. */
export async function moveNote(page: Page, title: string, destination = 'New Default') {
  const dialog = await noteAction(page, title, 'Move note');
  await page
    .getByRole('group', { name: 'Move note', exact: true })
    .getByRole('button', { name: destination, exact: true })
    .click();
  return dialog;
}
