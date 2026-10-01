import { expect, type Locator, type Page, test } from '@playwright/test';
import { z } from 'zod';

// Signing in reloads the page to open that user's local database. The dev server sends the
// app unbundled, so on a busy machine that load far outlasts the default five seconds.
const APP_LOAD_TIMEOUT = 30_000;

const signUpResponse = z.object({
  token: z.string(),
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
});

/**
 * Signs up a fresh user, so each test starts with no notes. The account is made through the
 * API and its session stored as the app stores one, which takes one page load where the form
 * takes two. `auth.spec.ts` covers the form.
 */
export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;
  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: origin },
    data: { email, name: '', password: 'password123' },
  });
  expect(response.ok()).toBeTruthy();
  const { token, user } = signUpResponse.parse(await response.json());
  const context = page.context();
  await context.setStorageState({
    // The form's request leaves the session cookie in the browser too.
    cookies: await context.cookies(),
    origins: [
      {
        origin,
        localStorage: [
          { name: 'catch-auth-token', value: response.headers()['set-auth-token'] ?? token },
          { name: 'catch-user', value: JSON.stringify(user) },
        ],
      },
    ],
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  return email;
}

/** Signs in as a user `signUp` created, as on another device. */
export async function signIn(page: Page, email: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
}

/** Creates a note through the quick-note window above the dock. */
export async function createNote(page: Page, title: string, body?: string) {
  await page.getByRole('button', { name: 'New note' }).click();
  // The previous editor can still be animating closed while this one loads.
  await expect(
    page.getByRole('region', { name: 'New note', exact: true }).getByRole('textbox'),
  ).toBeFocused();
  await page.keyboard.type(title);
  if (body) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(body);
  }
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(card(page, title)).toBeVisible();
}

/**
 * Adds notes without typing them, for tests that are about something other than writing a
 * note. Each lands first, as a typed note does, so the last one listed leads the page.
 * `status` puts them in that deck column instead of the gallery.
 */
export async function seedNotes(
  page: Page,
  notes: readonly (string | { title: string; body: string })[],
  status?: string,
) {
  await page.evaluate(
    async ({ notes, status }) => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const saved = notes.map((note) => {
        const { title, body } = typeof note === 'string' ? { title: note, body: null } : note;
        return createNote({
          userId: getSignedInUser().id,
          status,
          content: [
            { type: 'heading', props: { level: 3 }, content: title },
            ...(body === null ? [] : [{ type: 'paragraph', content: body }]),
          ],
        }).transaction.isPersisted.promise;
      });
      await Promise.all(saved);
    },
    { notes, status },
  );
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

/**
 * Where an element rests once it has stopped moving. Something that animates in is visible
 * before it arrives, and a raw pointer gesture aimed at it then lands on whatever is there.
 */
export async function settledBox(locator: Locator) {
  let box = await locator.boundingBox();
  await expect
    .poll(async () => {
      const previous = box;
      box = await locator.boundingBox();
      return previous !== null && box !== null && previous.x === box.x && previous.y === box.y;
    })
    .toBe(true);
  if (!box) throw new Error('Missing layout');
  return box;
}

/** Opens the Deck and waits for it to slide in, so a raw pointer gesture can follow. */
export async function openDeck(page: Page) {
  await page.getByRole('link', { name: 'Deck' }).click();
  // The slide starts once the page has rendered; any sooner there is nothing to wait for.
  await expect(page.getByRole('heading', { name: 'Deck' })).toBeVisible();
  await waitForPageTransition(page);
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
