import { expect, test } from '@playwright/test';
import { bearerToken, card, signUp } from './helpers';

const metadata = {
  title: 'Atuin — shell history',
  description: 'Sync and search your shell history.',
  siteName: 'Atuin',
  imageHash: null,
  imageWidth: null,
  imageHeight: null,
  iconHash: null,
  hue: null,
};

test('link intake fetches editable details, saves an ordinary note, and warns about duplicates', async ({
  page,
}) => {
  await signUp(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ json: metadata }));
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.locator('[contenteditable]')).toBeFocused();
  await page.keyboard.type('Draft before capture');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await expect(form).toBeVisible();
  await form.getByLabel('URL', { exact: true }).fill('https://atuin.sh/#install');
  await form.getByRole('button', { name: 'Fetch details' }).click();
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue(metadata.title);
  await expect(form.getByLabel('Description')).toHaveValue(metadata.description);
  await form.getByLabel('Title', { exact: true }).fill('Terminal tools');
  await form.getByLabel('Your notes').fill('Try this on the laptop.');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(form).toBeHidden();
  const captured = page
    .locator('[data-note-card]')
    .filter({ has: page.locator('[data-gallery-preview="https://atuin.sh/"]') });
  await expect(captured).toBeVisible();
  await expect(card(page, 'Draft before capture')).toBeVisible();
  // The card's hover dock sits over the face's bottom edge, so open from its top.
  await captured.locator('[data-gallery-preview]').click({ position: { x: 20, y: 20 } });
  const note = page.getByRole('dialog', { name: 'Edit note' });
  await expect(note.getByRole('textbox')).toContainText(metadata.description);
  await expect(note.getByRole('textbox')).toContainText('Try this on the laptop.');
  await expect(note.getByRole('textbox')).toContainText('https://atuin.sh/#install');
  await note.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await form.getByLabel('URL', { exact: true }).fill('https://atuin.sh/#another-section');
  await expect(form.getByText('Already in 1 note')).toBeVisible();
  await form.getByText('Already in 1 note').click();
  await form.getByRole('button', { name: 'Open note', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('dialog').getByRole('textbox')).toContainText('Terminal tools');
});

test('capture survives login with its URL and selected text and never saves on cancel', async ({
  page,
  context,
}) => {
  const email = await signUp(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ json: metadata }));
  await page.evaluate(() => {
    localStorage.removeItem('catch-auth-token');
    localStorage.removeItem('catch-user');
  });
  await context.clearCookies();
  const fragment = new URLSearchParams({
    url: 'https://atuin.sh/',
    title: 'Browser title',
    text: 'A selected passage',
  });
  await page.goto(`/capture#${fragment}`);
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/capture');
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('text')).toBe(
    'A selected passage',
  );
  await page.reload();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://atuin.sh/');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(metadata.title);
  await expect(page.getByLabel('Your notes')).toHaveValue('A selected passage');
  await page.getByLabel('URL', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(page.getByText('Catch your first note', { exact: true })).toBeVisible();
});

test('an older server permits manual capture and the note survives an offline reload', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Persistence and endpoint fallback do not depend on layout; capture and login run on both.',
  );
  await signUp(page);
  await page.route('**/api/link-previews/intake', (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  await page.goto(
    `/capture#${new URLSearchParams({ url: 'https://example.com/', title: 'Offline reading' })}`,
  );
  await expect(page.getByText(/Update your Catch server/)).toBeVisible();
  await page.getByLabel('Your notes').fill('Keep this for the train.');
  await page.route('**/api/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Link saved', exact: true })).toBeVisible();
  await page.goto('/');
  const captured = page
    .locator('[data-note-card]')
    .filter({ has: page.locator('[data-gallery-preview="https://example.com/"]') });
  await expect(captured).toBeVisible();
  // The card's hover dock sits over the face's bottom edge, so open from its top.
  await captured.locator('[data-gallery-preview]').click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('dialog', { name: 'Edit note' }).getByRole('textbox')).toContainText(
    'Keep this for the train.',
  );
  await page.unroute('**/api/**');
});

test('the Settings bookmarklet opens a compact capture from another site', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'The bookmarks bar is a desktop browser workflow; the same capture form is exercised on both.',
  );
  await signUp(page);
  await page.goto('/settings/general');
  const bookmarklet = await page
    .getByRole('link', { name: 'Save to Catch', exact: true })
    .getAttribute('href');
  expect(bookmarklet).toMatch(/^javascript:/);
  if (!bookmarklet) throw new Error('Missing bookmarklet');
  await context.route('**/api/link-previews/intake', (route) => route.fulfill({ json: metadata }));
  await page.route('https://capture-source.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Source page</title><p>Useful selected passage</p>',
    }),
  );
  await page.goto('https://capture-source.example/article?one=1&two=2#reading');
  await page.evaluate(() => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p')!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const opened = context.waitForEvent('page');
  await page.evaluate((code) => {
    const anchor = document.createElement('a');
    anchor.href = code;
    document.body.append(anchor);
    anchor.click();
  }, bookmarklet);
  const popup = await opened;
  await expect(popup.getByRole('heading', { name: 'Add Rich Link', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(popup.getByLabel('URL', { exact: true })).toHaveValue(
    'https://capture-source.example/article?one=1&two=2#reading',
  );
  await expect(popup.getByLabel('Title', { exact: true })).toHaveValue(metadata.title);
  await expect(popup.getByLabel('Your notes')).toHaveValue('Useful selected passage');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
  await popup
    .getByRole('dialog', { name: 'Save to', exact: true })
    .getByRole('button', { name: 'In progress', exact: true })
    .click();
  await popup.getByRole('button', { name: 'Background color' }).click();
  await popup.getByRole('button', { name: 'Orange', exact: true }).click();
  await popup.getByRole('button', { name: 'Background color' }).click();
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(popup.getByRole('heading', { name: 'Link saved', exact: true })).toBeVisible();
  await expect(popup.getByText('Your note is in Deck · In progress.')).toBeVisible();
  expect(
    await popup.evaluate(async () => {
      const modulePath = '/src/lib/collections.ts';
      const collections: {
        notesCollection: { values: () => Iterable<{ status: string | null; color: string }> };
      } = await import(modulePath);
      return [...collections.notesCollection.values()].map(({ status, color }) => ({
        status,
        color,
      }));
    }),
  ).toEqual([{ status: 'in_progress', color: 'orange' }]);
  const closed = popup.waitForEvent('close');
  // Closing the page can interrupt the click itself, even with navigation waiting disabled.
  await popup
    .getByRole('button', { name: 'Close window' })
    .click({ noWaitAfter: true })
    .catch((error: unknown) => {
      if (!popup.isClosed()) throw error;
    });
  await closed;
});

test(
  'link intake refuses private destinations and credentialed URLs',
  { tag: '@api' },
  async ({ request }, testInfo) => {
    const origin = new URL(testInfo.project.use.baseURL ?? '').origin;
    const account = await request.post('/api/auth/sign-up/email', {
      headers: { Origin: origin },
      data: { email: `capture-api-${Date.now()}@example.com`, name: '', password: 'password123' },
    });
    expect(account.ok()).toBeTruthy();
    const token = bearerToken(account);
    for (const url of [
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://[::1]/',
      'https://user:password@example.com/',
    ]) {
      const response = await request.post('/api/link-previews/intake', {
        headers: { Authorization: `Bearer ${token}` },
        data: { url },
      });
      expect(response.status(), url).toBe(422);
    }
  },
);
