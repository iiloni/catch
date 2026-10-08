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
  // With several signed in, the address says whose page it is.
  await expect(page).toHaveURL(/\/u\/2\/$/);
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
  // Raw pointer gestures do not wait for the toast covering the phone's avatar to leave.
  const switchedToast = page.locator('[data-sonner-toast]', { hasText: `Switched to ${first}` });
  await switchedToast.getByRole('button', { name: 'Close toast' }).click();
  await expect(switchedToast).toBeHidden();
  await expect(page).toHaveURL(/\/u\/1\/$/);
  await expect(card(page, 'First account note')).toBeVisible();
  await expect(card(page, 'Second account note')).toBeHidden();
  const noteId = await page
    .locator('[data-note-card]', { hasText: 'First account note' })
    .first()
    .getAttribute('data-note-card');
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

  // A reminder's notification opens the app as the account it rang for.
  const firstId = await page.evaluate(
    (email) =>
      (
        JSON.parse(localStorage.getItem('catch-accounts') ?? '[]') as {
          user: { id: string; email: string };
        }[]
      ).find(({ user }) => user.email === email)?.user.id,
    first,
  );
  await page.goto(`/?note=${noteId}&account=${firstId}`);
  await expect(page.getByRole('dialog').getByRole('textbox')).toContainText('First account note', {
    timeout: 30_000,
  });
  expect(page.url()).toBe(new URL(`/u/1/?note=${noteId}`, page.url()).href);
  await expect(page.getByText(`Switched to ${first}`)).toBeVisible();
});

test('tabs show different accounts side by side, and signing one out leaves the rest', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Tabs and signing out do not depend on the layout.');
  const first = await signUp(page);
  await seedNotes(page, ['First account note']);
  const second = await addAccount(page, first);
  await seedNotes(page, ['Second account note']);

  // A new tab starts as the account last used.
  const tab = await page.context().newPage();
  await tab.goto('/');
  await expect(avatar(tab, second)).toBeVisible({ timeout: 30_000 });
  await avatar(page, second).click();
  const accounts = page.getByRole('list', { name: 'Accounts' });
  await accounts.getByRole('button', { name: first, exact: true }).click();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'First account note')).toBeVisible();

  // The other tab keeps the second account, through a reload and while writing.
  await tab.reload();
  await expect(avatar(tab, second)).toBeVisible({ timeout: 30_000 });
  await expect(card(tab, 'Second account note')).toBeVisible();
  await seedNotes(tab, ['Written in the second tab']);
  await seedNotes(page, ['Written in the first tab']);
  await expect(card(tab, 'Written in the second tab')).toBeVisible();
  await expect(card(tab, 'Written in the first tab')).toBeHidden();
  await expect(card(page, 'Written in the first tab')).toBeVisible();
  await expect(card(page, 'Written in the second tab')).toBeHidden();

  await avatar(page, first).click();
  await page.getByRole('button', { name: `Sign out ${second}`, exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Sign out ${second}?` });
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(confirm).toBeHidden();
  await avatar(page, first).click();
  await expect(accounts.getByRole('listitem')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // The tab that was showing the signed-out account moves to the one that is left.
  await expect(avatar(tab, first)).toBeVisible({ timeout: 30_000 });
  await expect(card(tab, 'Written in the first tab')).toBeVisible();
  await tab.close();

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

test('changing a name belongs to the tab’s account while another is active on the device', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Account isolation across tabs does not depend on the layout.');
  const first = await signUp(page);
  const second = await addAccount(page, first);
  const tab = await page.context().newPage();
  await tab.goto('/u/2/settings/account');
  await avatar(page, second).click();
  await page
    .getByRole('list', { name: 'Accounts' })
    .getByRole('button', { name: first, exact: true })
    .click();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  await tab.getByRole('button', { name: 'Change name' }).click();
  const dialog = tab.getByRole('dialog', { name: 'Change name' });
  await dialog.getByLabel('Name', { exact: true }).fill('Second Account');
  await dialog.getByRole('button', { name: 'Save name' }).click();
  await expect(dialog).toBeHidden();
  await expect(tab.getByRole('region', { name: 'Signed in as' })).toContainText('Second Account');
  await page.reload();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  await avatar(page, first).click();
  await expect(page.getByRole('list', { name: 'Accounts' })).toContainText('Second Account');
  await page.goto('/u/1/settings/account');
  const summary = page.getByRole('region', { name: 'Signed in as' });
  await expect(summary).toContainText(first);
  await expect(summary).not.toContainText('Second Account');
  await tab.reload();
  await expect(tab.getByRole('region', { name: 'Signed in as' })).toContainText('Second Account');
  await tab.close();
});

test('an address names its account, as a bookmark of it does', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Addresses do not depend on the layout.');
  const first = await signUp(page);
  await seedNotes(page, ['First account note']);
  // One account has nobody to be told apart from.
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  const second = await addAccount(page, first);
  await seedNotes(page, ['Second account note']);

  // The tab shows the second account; the address asks for the first.
  await page.goto('/u/1/search');
  await expect(page).toHaveURL(/\/u\/1\/search$/);
  await page.goto('/u/1/');
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'First account note')).toBeVisible();
  // Moving about the app and opening a note stay at the account's addresses.
  await card(page, 'First account note').click();
  await expect(page).toHaveURL(/\/u\/1\/\?note=/);
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('textbox')).toContainText('First account note', {
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/u\/1\/$/);

  // Another tab opens the other account's address beside it.
  const tab = await page.context().newPage();
  await tab.goto('/u/2/');
  await expect(avatar(tab, second)).toBeVisible({ timeout: 30_000 });
  await expect(card(tab, 'Second account note')).toBeVisible();
  await tab.close();
  await page.reload();
  await expect(avatar(page, first)).toBeVisible({ timeout: 30_000 });

  // An address of an account that signed out asks for it, then carries on to its page.
  await avatar(page, first).click();
  await page.getByRole('button', { name: `Sign out ${second}`, exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Sign out ${second}?` });
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(confirm).toBeHidden();
  await avatar(page, first).click();
  await expect(page.getByRole('list', { name: 'Accounts' }).getByRole('listitem')).toHaveCount(1);
  await page.goto('/u/2/search');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsearch$/);
  await page.getByLabel('Email').fill(second);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/u\/2\/search$/, { timeout: 30_000 });
  await page.goto('/u/2/');
  await expect(avatar(page, second)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'Second account note')).toBeVisible();
});
