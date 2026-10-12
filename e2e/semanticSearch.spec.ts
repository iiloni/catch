import { expect, test } from '@playwright/test';
import { aiConfigurationSchema } from '../packages/shared/src/ai';
import { fakeEmbeddingProvider } from './fixtures/embeddingProvider';
import { bearerToken, seedNotes, settledBox, signUp, waitForPageTransition } from './helpers';

// Uses a real provider through Docker's host gateway; search and indexing hit the real API.
let fake: Awaited<ReturnType<typeof fakeEmbeddingProvider>>;
let token: string;
test.beforeAll(async ({ request }) => {
  fake = await fakeEmbeddingProvider('0.0.0.0');
  const auth = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost' },
    data: { email: 'admin@example.com', password: 'adminadmin' },
  });
  token = bearerToken(auth);
  const headers = { Authorization: `Bearer ${token}` };
  const saved = aiConfigurationSchema.parse(
    await (await request.get('/api/admin/ai', { headers })).json(),
  );
  const response = await request.put('/api/admin/ai', {
    headers,
    data: {
      enabled: true,
      revision: saved.revision,
      embedding: {
        provider: 'compatible',
        baseUrl: `http://host.docker.internal:${fake.port}/v1`,
        model: 'fake-embedding',
        profile: 'plain',
      },
      apiKey: null,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});
test.afterAll(async ({ request }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const saved = aiConfigurationSchema.parse(
    await (await request.get('/api/admin/ai', { headers })).json(),
  );
  await request.put('/api/admin/ai', {
    headers,
    data: { enabled: false, revision: saved.revision, embedding: saved.embedding },
  });
  await fake.close();
});

test('semantic search starts off, finds related notes and preserves keyword fallback and pending edits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page);
  await seedNotes(page, ['Bicycle ride', 'Milk shopping']);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await waitForPageTransition(page);
  const field = page.getByRole('textbox', { name: 'Search notes' });
  await field.fill('cycling');
  await expect(page.getByText('No matching notes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const semantic = page.getByRole('switch', { name: 'AI search', exact: true });
  await expect(semantic).toBeEnabled();
  await expect(semantic).not.toBeChecked();
  await semantic.focus();
  await semantic.press('Space');
  await expect(semantic).toBeChecked();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  // The worker runs independently of a user's toggle; wait for the durable background index.
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/admin/ai', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const progress = aiConfigurationSchema.parse(await response.json()).progress;
        return progress.ready === progress.total;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await expect(page.getByRole('article').filter({ hasText: 'Bicycle ride' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Related meaning', { exact: true }).first()).toBeVisible();
  await page.route('**/api/search', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Provider unavailable' }),
    }),
  );
  await field.fill('Milk');
  await expect(page.getByRole('article').filter({ hasText: 'Milk shopping' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Showing keyword results' }),
  ).toBeVisible();
  await page.unroute('**/api/search');
  // Recovery retries the unchanged query while keeping the keyword fallback visible.
  await expect(page.getByRole('status').filter({ hasText: 'Showing keyword results' })).toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await expect(semantic).toBeChecked();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page.route('**/api/notes/**', (route) => route.abort());
  await page.evaluate(async () => {
    const { noteStore } = await import('/src/lib/noteStore.ts');
    const { notesCollection } = await import('/src/lib/collections.ts');
    const { write } = await import('/src/lib/collections.ts');
    const note = [...notesCollection.values()].find((n) =>
      JSON.stringify(n.content).includes('Milk shopping'),
    )!;
    write(() => {
      noteStore.update(note.id, (draft) => {
        draft.content = [{ type: 'paragraph', content: 'Pending cycling groceries' }];
        draft.updatedAt = new Date();
      });
    });
  });
  await field.fill('cycling');
  await expect(
    page.getByRole('article').filter({ hasText: 'Pending cycling groceries' }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await field.fill('groceries');
  await expect(
    page.getByRole('article').filter({ hasText: 'Pending cycling groceries' }),
  ).toBeVisible();
  await page.context().setOffline(false);
});

test('an older server hides semantic mode, and vault queries issue no search requests', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.route('**/api/search/capabilities', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await signUp(page);
  await seedNotes(page, ['Local keyword note']);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await waitForPageTransition(page);
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await expect(page.getByRole('switch', { name: 'AI search', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page.getByRole('textbox', { name: 'Search notes' }).fill('keyword');
  await expect(page.getByRole('article').filter({ hasText: 'Local keyword note' })).toBeVisible();
  await page.unroute('**/api/search/capabilities');
  let searchRequests = 0;
  page.on('request', (request) => {
    if (/\/api\/search(?:\/capabilities)?$/.test(new URL(request.url()).pathname)) searchRequests++;
  });
  await page.evaluate(async () => {
    const { createVault, vaultMode } = await import('/src/lib/vault.ts');
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    await createVault('a vault password', false);
    vaultMode.set(true);
    await createNote({
      userId: getSignedInUser()!.id,
      vault: true,
      content: [{ type: 'paragraph', content: 'private vault query' }],
    }).transaction.isPersisted.promise;
  });
  await expect(page.getByRole('heading', { name: 'Search the vault' })).toBeVisible();
  const before = searchRequests;
  await page.getByRole('textbox', { name: 'Search notes' }).fill('private vault query');
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await expect(page.getByRole('switch', { name: 'AI search', exact: true })).toHaveCount(0);
  // Negative privacy assertion: wait beyond the semantic request debounce.
  await page.waitForTimeout(700);
  expect(searchRequests).toBe(before);
  expect(fake.calls.flatMap((call) => call.input).join(' ')).not.toContain('private vault query');
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page
    .getByRole('article')
    .filter({ hasText: 'private vault query' })
    .getByRole('button', { name: 'Open note', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search notes' }).clear();
  await expect(
    page
      .getByRole('region', { name: 'Recent' })
      .getByRole('button', { name: 'private vault query', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.values(localStorage).join(' '))).not.toContain(
    'private vault query',
  );
  await page.getByRole('textbox', { name: 'Search notes' }).fill('private vault query');
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(async () => (await import('/src/lib/vault.ts')).vaultMode.set(false));
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await waitForPageTransition(page);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search notes' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'private vault query', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const ai = page.getByRole('switch', { name: 'AI search', exact: true });
  await expect(ai).toBeEnabled();
  await ai.click();
  await expect(ai).toBeChecked();
  await page.waitForTimeout(700);
  expect(fake.calls.flatMap((call) => call.input).join(' ')).not.toContain('private vault query');
});

test('recent searches retain AI mode and restore text-only searches without provider requests', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page);
  await seedNotes(page, ['Bicycle ride', 'Milk shopping']);
  await page.evaluate(() =>
    localStorage.setItem('catch-recent-searches', JSON.stringify(['shopping'])),
  );
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await waitForPageTransition(page);
  const recent = page.getByRole('region', { name: 'Recent' });
  await expect(recent.getByRole('button', { name: 'shopping', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const filters = page.getByRole('region', { name: 'Search filters' });
  const tabs = await settledBox(filters.getByRole('tablist', { name: 'Filter type' }));
  const divider = await settledBox(filters.getByRole('separator'));
  const archive = await settledBox(filters.getByRole('switch', { name: 'Show archived notes' }));
  const ai = filters.getByRole('switch', { name: 'AI search', exact: true });
  const aiBox = await settledBox(ai);
  expect(divider.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  expect(archive.y).toBeGreaterThan(divider.y);
  expect(aiBox.y).toBeGreaterThan(archive.y + archive.height);
  await ai.focus();
  await ai.press('Space');
  await expect(ai).toBeChecked();
  await settledBox(ai.locator('[data-slot="switch-thumb"]'));
  await page.screenshot({ path: test.info().outputPath('search-filters.png') });
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const field = page.getByRole('textbox', { name: 'Search notes' });
  await field.fill('cycling');
  const bicycle = page.getByRole('article').filter({ hasText: 'Bicycle ride' });
  await expect(bicycle).toBeVisible({ timeout: 30_000 });
  await bicycle.getByRole('button', { name: 'Open note', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await field.clear();
  const aiRecent = recent.getByRole('button', { name: 'cycling AI search', exact: true });
  await expect(aiRecent.locator('[data-recent-ai]')).toBeVisible();
  await expect(page.locator('[data-search-view="results"]')).toHaveCount(0);
  await settledBox(aiRecent);
  await page.screenshot({ path: test.info().outputPath('search-recents.png') });
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/api/search')) requests++;
  });
  await recent.getByRole('button', { name: 'shopping', exact: true }).click();
  await expect(field).toHaveValue('shopping');
  const milk = page.getByRole('article').filter({ hasText: 'Milk shopping' });
  await expect(milk).toBeVisible();
  // Wait beyond the request debounce to check that replaying a text entry switches AI off.
  await page.waitForTimeout(700);
  expect(requests).toBe(0);
  await milk.getByRole('button', { name: 'Open note', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await field.clear();
  await expect(
    recent.getByRole('button', { name: 'shopping', exact: true }).locator('[data-recent-ai]'),
  ).toHaveCount(0);
  await aiRecent.click();
  await expect(field).toHaveValue('cycling');
  await expect(bicycle).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => requests).toBeGreaterThan(0);
  await field.clear();
  await page.reload();
  await expect(
    recent.getByRole('button', { name: 'cycling AI search', exact: true }),
  ).toBeVisible();
  await expect(recent.getByRole('button', { name: 'shopping', exact: true })).toBeVisible();
});

test('admin discovers and tests embedding models, saves, and refuses a concurrent configuration edit', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto('/settings/admin/ai');
  const model = page.getByRole('combobox', { name: 'Embedding model', exact: true });
  await expect(model).toHaveValue('fake-embedding');
  const endpoint = page.getByLabel('Server endpoint');
  const originalEndpoint = await endpoint.inputValue();
  for (const value of ['', 'http://', 'http://host.docker.000/v1']) {
    await endpoint.fill(value);
    await expect(endpoint).toHaveValue(value);
    await expect(page.getByRole('button', { name: 'Test embedding' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
  }
  await endpoint.fill(originalEndpoint);
  await expect(page.getByRole('button', { name: 'Test embedding' })).toBeEnabled();
  await page.getByRole('button', { name: 'Discover models' }).click();
  await expect(page.getByRole('button', { name: 'Input format', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'AI setup guide' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Found 1 model' })).toBeVisible();
  // Discovered models are suggested under the field, which still takes any name.
  await expect(page.getByRole('option', { name: 'fake-embedding', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'chat-only', exact: true })).toHaveCount(0);
  await model.fill('nothing like it');
  await expect(page.getByRole('option')).toHaveCount(0);
  await model.fill('fake');
  await page.getByRole('option', { name: 'fake-embedding', exact: true }).click();
  await expect(model).toHaveValue('fake-embedding');
  await expect(page.getByRole('option')).toHaveCount(0);
  // A name entered manually still has to generate actual embeddings.
  await model.fill('chat-only');
  await page.getByRole('button', { name: 'Test embedding' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 400');
  await model.fill('fake-embedding');
  await page.getByRole('button', { name: 'Test embedding' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Embedding verified: 3 dimensions' }),
  ).toBeVisible();
  await model.fill('nomic-embed-text');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'AI configuration saved' }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('ai-configuration.png'), fullPage: true });
  const headers = { Authorization: `Bearer ${token}` };
  const saved = aiConfigurationSchema.parse(
    await (await page.request.get('/api/admin/ai', { headers })).json(),
  );
  expect(saved.embedding.profile).toBe('nomic');
  expect(
    fake.calls.some((call) => call.input.includes('search_query: Catch embedding connection test')),
  ).toBe(true);
  const edit = await page.request.put('/api/admin/ai', {
    headers,
    data: { enabled: false, embedding: saved.embedding, revision: saved.revision },
  });
  expect(edit.ok()).toBeTruthy();
  await model.fill('unsaved-model');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another session');
});

test('AI configuration rejects a regular account on every route', { tag: '@api' }, async ({
  request,
}) => {
  const auth = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'https://localhost' },
    data: {
      email: `ai-guard-${Date.now()}@example.com`,
      password: 'password123',
      name: 'Reader',
    },
  });
  const headers = { Authorization: `Bearer ${bearerToken(auth)}` };
  for (const [path, method] of [
    ['', 'GET'],
    ['', 'PUT'],
    ['/models', 'POST'],
    ['/test', 'POST'],
    ['/retry', 'POST'],
    ['/rebuild', 'POST'],
  ]) {
    const response = await request.fetch(`/api/admin/ai${path}`, { method, headers, data: {} });
    expect(response.status()).toBe(403);
  }
});
