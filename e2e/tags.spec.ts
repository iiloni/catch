import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import {
  card,
  createNote,
  noteToolbar,
  openNote,
  seedNotes,
  settledBox,
  signIn,
  signUp,
} from './helpers';

test.setTimeout(90_000);

const id = () => {
  const value = randomUUID();
  return `${value.slice(0, 14)}7${value.slice(15)}`;
};
async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('catch-auth-token'));
  return { Authorization: `Bearer ${token}` };
}
async function addTag(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
  parentId: string | null = null,
  color: string | null = null,
) {
  const tagId = id();
  const response = await request.post('/api/tags', {
    headers,
    data: { id: tagId, name, parentId, color, icon: parentId ? null : 'briefcase' },
  });
  expect(response.status()).toBe(200);
  return tagId;
}

test('secondary tag search keeps focus and selection usable above the keyboard', async ({
  page,
  request,
}) => {
  await signUp(page);
  const headers = await auth(page);
  const work = await addTag(request, headers, 'Work', null, 'blue');
  await addTag(request, headers, 'Projects', work);
  await addTag(request, headers, 'Ideas');
  for (let index = 0; index < 10; index++) await addTag(request, headers, `Other ${index}`, work);
  await createNote(page, 'Searchable tags');
  const dialog = await openNote(page, 'Searchable tags');
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Secondary tags' });
  const search = picker.getByRole('textbox', { name: 'Find tags' });
  await search.click();
  await expect(search).toBeFocused();
  await expect(picker.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(1);
  await expect(picker.locator('[data-slot="scroll-area-thumb"]')).toBeVisible();
  // Chromium emulation has no on-screen keyboard; report its height as Android does.
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.type('Projects');
  await expect(search).toHaveValue('Projects');
  await expect(picker.getByRole('checkbox', { name: 'Ideas', exact: true })).toHaveCount(0);
  const projects = picker.getByRole('checkbox', { name: 'Work / Projects', exact: true });
  await projects.check();
  await expect(projects).toBeChecked();
  await search.click();
  await expect(search).toBeFocused();
  await search.clear();
  await expect(picker.getByRole('checkbox', { name: 'Ideas', exact: true })).toBeVisible();
  const bounds = await picker.boundingBox();
  const keyboardTop = await page.evaluate(() => innerHeight - 320);
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(keyboardTop);
  await picker.getByRole('button', { name: 'Collapse Work' }).click();
  await dialog.getByRole('heading', { name: 'Searchable tags' }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
});

test('secondary branches move following rows smoothly on collapse, expansion and reversal', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);
  const headers = await auth(page);
  const root = await addTag(request, headers, 'Work', null, 'blue');
  const child = await addTag(request, headers, 'Projects', root);
  await addTag(request, headers, 'Catch', child);
  await addTag(request, headers, 'Zebra');
  await createNote(page, 'Animated tags');
  await openNote(page, 'Animated tags');
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Secondary tags' });
  const selected = picker.getByRole('checkbox', { name: 'Work / Projects', exact: true });
  await selected.check();
  await expect
    .poll(() => picker.evaluate((section) => section.parentElement?.style.height))
    .toBe('auto');

  for (const action of ['Collapse Work', 'Expand Work']) {
    const samples = await picker.evaluate(async (section, label) => {
      const following = section.querySelector('input[aria-label="Zebra"]')?.closest('label');
      const button = section.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!following || !button) throw new Error('Missing tree controls');
      const position = () =>
        following.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const values = [position()];
      button.click();
      const start = performance.now();
      while (performance.now() - start < 750) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        values.push(position());
      }
      return values;
    }, action);
    const start = samples[0];
    const end = samples[samples.length - 1];
    expect(Math.abs(end - start)).toBeGreaterThan(80);
    const intermediate = samples.filter(
      (value) => value > Math.min(start, end) + 2 && value < Math.max(start, end) - 2,
    );
    expect(new Set(intermediate.map((value) => Math.round(value))).size).toBeGreaterThan(3);
  }

  // Reopening during an exit must cancel it without duplicating rows or losing selection.
  await picker.evaluate(async (section) => {
    section.querySelector<HTMLButtonElement>('button[aria-label="Collapse Work"]')?.click();
    const start = performance.now();
    while (performance.now() - start < 60)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    section.querySelector<HTMLButtonElement>('button[aria-label="Expand Work"]')?.click();
  });
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'Work / Projects / Catch' })).toBeVisible();
});

test('nested primary tags, secondary selection, recoloring and deletion work on touch and desktop', async ({
  page,
  request,
}) => {
  await signUp(page);
  const headers = await auth(page);
  const root = await addTag(request, headers, 'Work', null, 'blue');
  let parent = root;
  for (const name of ['Projects', 'Software', 'Catch', 'Release'])
    parent = await addTag(request, headers, name, parent);
  await addTag(request, headers, 'Ideas');
  await createNote(page, 'Tagged note', 'A note with context');
  const dialog = await openNote(page, 'Tagged note');
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Blue: Work', exact: true }).click();
  // Closing on a parent keeps it, without choosing a leaf.
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await expect(dialog.locator('[data-note-scroll]')).toHaveAttribute('data-note-color', 'blue');
  await expect(dialog.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Blue: Work', exact: true }).click();
  for (const name of ['Projects', 'Software', 'Catch', 'Release'])
    await page.getByRole('button', { name, exact: true }).click();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Work / Projects / Software / Catch / Release' }),
  ).toBeVisible();

  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Secondary tags' });
  await expect(
    picker.getByRole('checkbox', { name: 'Work / Projects / Software / Catch / Release' }),
  ).toBeDisabled();
  await picker.getByRole('checkbox', { name: 'Ideas', exact: true }).check();
  await picker.getByRole('checkbox', { name: 'Work / Projects', exact: true }).check();
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    card(page, 'Tagged note').getByRole('region', { name: 'Tags' }).getByRole('button'),
  ).toHaveCount(3);

  const recolor = await request.patch(`/api/tags/${root}`, { headers, data: { color: 'green' } });
  expect(recolor.status()).toBe(200);
  await expect(card(page, 'Tagged note')).toHaveAttribute('data-note-color', 'green');
  await openNote(page, 'Tagged note');
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await expect(dialog.locator('[data-note-scroll]')).toHaveAttribute('data-note-color', 'red');
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'No color', exact: true }).click();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await expect(dialog.locator('[data-note-scroll]')).toHaveAttribute('data-note-color', 'default');
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Tags without a color', exact: true }).click();
  await page
    .locator('[data-note-toolbar]')
    .getByRole('button', { name: 'Ideas', exact: true })
    .click();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await expect(dialog.locator('[data-note-scroll]')).toHaveAttribute('data-note-color', 'default');
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Ideas', exact: true })).toBeDisabled();
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto('/settings/tags');
  await page.getByRole('button', { name: 'Manage Work', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete Work', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete tag', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage Release', exact: true })).toHaveCount(0);
  await page.goto('/');
  await expect(card(page, 'Tagged note')).toBeVisible();
  await expect(
    card(page, 'Tagged note').getByRole('region', { name: 'Tags' }).getByRole('button'),
  ).toHaveCount(1);
});

test('settings tag tree supports search, branch expansion and direct editing', async ({
  page,
  request,
}, testInfo) => {
  await signUp(page);
  const headers = await auth(page);
  const work = await addTag(request, headers, 'Work', null, 'blue');
  const projects = await addTag(request, headers, 'Projects', work);
  await addTag(request, headers, 'Catch', projects);
  const life = await addTag(request, headers, 'Life', null, 'mint');
  const habits = await addTag(request, headers, 'Habits', life);
  await addTag(request, headers, 'Fitness and weekend adventures', habits);
  await addTag(request, headers, 'Ideas');
  await page.goto('/settings/tags');
  const settings = page.getByRole('region', { name: 'Tags', exact: true });
  await expect(settings.getByRole('button', { name: 'Manage Catch', exact: true })).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`tags-settings-${colorScheme}.png`),
      fullPage: true,
    });
  }
  await settings.getByRole('button', { name: 'Collapse Work' }).click();
  await expect(settings.getByRole('button', { name: 'Manage Projects' })).toHaveCount(0);
  const search = settings.getByRole('textbox', { name: 'Find tags' });
  await search.fill('Catch');
  await expect(settings.getByRole('button', { name: 'Edit Catch', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Edit Life', exact: true })).toHaveCount(0);
  await search.fill('Work');
  await expect(settings.getByRole('button', { name: 'Edit Projects', exact: true })).toBeVisible();
  await search.clear();
  await expect(settings.getByRole('button', { name: 'Edit Projects', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Expand Work' }).click();
  await settings.getByRole('button', { name: 'Edit Projects', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Projects');
  await dialog.getByLabel('Name', { exact: true }).fill('Personal projects');
  await dialog.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Manage Personal projects' })).toBeVisible();
});

test('settings creates roots and children and reserves linked colors', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings/tags');
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Travel');
  await dialog.getByRole('button', { name: 'Teal', exact: true }).click();
  await dialog.getByRole('button', { name: 'Travel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save tag', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Travel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add child to Travel', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Japan');
  await expect(dialog.getByRole('button', { name: 'Teal', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage Japan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Other');
  await dialog.getByRole('button', { name: 'Teal', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already linked');
});

test('tag API rejects cycles, cross-user references and reused colors, and safely replays writes', async ({
  page,
  request,
  browser,
}) => {
  await signUp(page);
  const headers = await auth(page);
  const root = await addTag(request, headers, 'Work', null, 'blue');
  const child = await addTag(request, headers, 'Catch', root);
  expect(
    (
      await request.patch(`/api/tags/${root}`, {
        headers,
        data: { parentId: child, color: null, icon: null },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post('/api/tags', {
        headers,
        data: { id: id(), name: 'Duplicate', parentId: null, color: 'blue', icon: null },
      })
    ).status(),
  ).toBe(409);
  expect(
    await (
      await request.post('/api/tags', {
        headers,
        data: { id: root, name: 'Replay', parentId: null, color: 'blue', icon: null },
      })
    ).json(),
  ).toEqual({ txid: null });
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await signUp(other);
    const otherHeaders = await auth(other);
    expect(
      (
        await request.patch(`/api/tags/${root}`, {
          headers: otherHeaders,
          data: { name: 'Stolen' },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post('/api/tags', {
          headers: otherHeaders,
          data: { id: id(), name: 'Foreign parent', parentId: root, color: null, icon: null },
        })
      ).status(),
    ).toBe(404);
    const noteId = id();
    expect(
      (
        await request.post('/api/notes', {
          headers: otherHeaders,
          data: { id: noteId, content: [] },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.patch(`/api/note-tags/${noteId}`, {
          headers: otherHeaders,
          data: { primaryTagId: root },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(`/api/note-tags/${noteId}`, {
          headers,
          data: { secondaryTagIds: [root] },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await otherContext.close();
  }
  expect((await request.delete(`/api/tags/${root}`, { headers })).status()).toBe(200);
  expect(await (await request.delete(`/api/tags/${root}`, { headers })).json()).toEqual({
    txid: null,
  });
});

test('offline primary and secondary assignments survive reload and sync after reconnecting', async ({
  page,
  request,
  browser,
}) => {
  const email = await signUp(page);
  const headers = await auth(page);
  await addTag(request, headers, 'Work', null, 'blue');
  await addTag(request, headers, 'Ideas');
  await createNote(page, 'Offline tags', 'Keep my assignments');
  let dialog = await openNote(page, 'Offline tags');
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await expect(page.getByRole('button', { name: 'Blue: Work', exact: true })).toBeVisible();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.route('**/api/**', (route) => route.abort());
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Blue: Work', exact: true }).click();
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Ideas', exact: true }).check();
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
  await page.reload();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(dialog.locator('[data-note-scroll]')).toHaveAttribute('data-note-color', 'blue');
  await page.unroute('**/api/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // A fresh device consumes the complete shape log, including changes after its snapshot.
  const device = await browser.newContext();
  try {
    const freshPage = await device.newPage();
    await signIn(freshPage, email);
    const freshNote = card(freshPage, 'Offline tags');
    await expect(freshNote).toHaveAttribute('data-note-color', 'blue', { timeout: 15_000 });
    await expect(freshNote.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
    await expect(freshNote.getByRole('button', { name: 'Ideas', exact: true })).toBeVisible();
  } finally {
    await device.close();
  }
});

test('wide tag cards, copied assignments and color search follow the primary branch', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'The wide pane needs a desktop viewport.');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signUp(page);
  const headers = await auth(page);
  const root = await addTag(request, headers, 'Work', null, 'blue');
  const leaf = await addTag(request, headers, 'Catch', root);
  const secondary = await addTag(request, headers, 'Ideas');
  await createNote(page, 'Wide tags', 'Keep these assignments when copying');
  const noteId = await card(page, 'Wide tags').getAttribute('data-note-card');
  expect(
    (
      await request.patch(`/api/note-tags/${noteId}`, {
        headers,
        data: { primaryTagId: leaf, secondaryTagIds: [secondary] },
      })
    ).status(),
  ).toBe(200);
  await expect(card(page, 'Wide tags')).toHaveAttribute('data-note-color', 'blue');
  const dialog = await openNote(page, 'Wide tags');
  const sideTags = dialog.locator('aside').getByRole('region', { name: 'Tags' });
  await expect(sideTags).toBeVisible();
  await expect(sideTags.getByRole('button')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await card(page, 'Wide tags').hover();
  await page.getByRole('button', { name: 'Select note', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Selected notes' })
    .getByRole('button', { name: 'Make a copy', exact: true })
    .click();
  await expect(card(page, 'Wide tags')).toHaveCount(2);
  for (const copy of await card(page, 'Wide tags').all()) {
    await expect(copy).toHaveAttribute('data-note-color', 'blue');
    await expect(copy.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
  }
  await page.goto('/search');
  await page.getByRole('button', { name: 'Filter notes', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  const results = page.getByRole('region', { name: 'Results' }).getByRole('article');
  await expect(results).toHaveCount(2);
  expect(
    (await request.patch(`/api/tags/${root}`, { headers, data: { color: 'green' } })).status(),
  ).toBe(200);
  await expect(page.getByRole('button', { name: 'Green', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(results).toHaveCount(2);
  await page.getByRole('button', { name: 'Green', exact: true }).click();
  await expect(results).toHaveCount(0);
  await page.getByRole('button', { name: 'Green', exact: true }).click();
  await expect(results).toHaveCount(2);
});

test('secondary descendants replace ancestors, preserve siblings and keep the primary independent', async ({
  page,
  request,
}) => {
  await signUp(page);
  const headers = await auth(page);
  const root = await addTag(request, headers, 'Work', null, 'blue');
  const parent = await addTag(request, headers, 'Projects', root);
  const leaf = await addTag(request, headers, 'Catch', parent);
  const sibling = await addTag(request, headers, 'Website', parent);
  await createNote(page, 'Specific tags');
  const noteId = await card(page, 'Specific tags').getAttribute('data-note-card');
  const dialog = await openNote(page, 'Specific tags');
  await noteToolbar(page).getByRole('button', { name: 'Tags', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Secondary tags' });
  await picker.getByRole('checkbox', { name: 'Work', exact: true }).check();
  await picker.getByRole('checkbox', { name: 'Work / Projects', exact: true }).check();
  await expect(picker.getByRole('checkbox', { name: 'Work', exact: true })).not.toBeChecked();
  await picker.getByRole('checkbox', { name: 'Work / Projects / Catch' }).check();
  await picker.getByRole('checkbox', { name: 'Work / Projects / Website' }).check();
  await expect(
    picker.getByRole('checkbox', { name: 'Work / Projects', exact: true }),
  ).not.toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'Work', exact: true })).toBeDisabled();
  await expect(
    picker.getByRole('checkbox', { name: 'Work / Projects', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
  await picker.getByRole('checkbox', { name: 'Work / Projects / Catch' }).uncheck();
  await expect(picker.getByRole('checkbox', { name: 'Work', exact: true })).toBeDisabled();
  await picker.getByRole('checkbox', { name: 'Work / Projects / Website' }).uncheck();
  await expect(picker.getByRole('checkbox', { name: 'Work', exact: true })).toBeEnabled();
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const { getSyncStatus } = await import('/src/lib/syncStatus.ts');
          return getSyncStatus().pending;
        }),
      { timeout: 15_000 },
    )
    .toBe(0);
  // The same normalization runs server-side, including replayed or previously queued arrays.
  const assignment = { primaryTagId: root, secondaryTagIds: [root, parent, leaf, sibling, leaf] };
  for (let replay = 0; replay < 2; replay++) {
    expect(
      (await request.patch(`/api/note-tags/${noteId}`, { headers, data: assignment })).status(),
    ).toBe(200);
    await expect(picker.getByRole('checkbox', { name: 'Work / Projects / Catch' })).toBeChecked();
    await expect(picker.getByRole('checkbox', { name: 'Work / Projects / Website' })).toBeChecked();
    await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(3);
  }
  await expect(picker.getByRole('checkbox', { name: 'Work', exact: true })).toBeChecked();
  await expect(
    picker.getByRole('checkbox', { name: 'Work / Projects', exact: true }),
  ).not.toBeChecked();
  // Moving a selected sibling under another also removes the now-redundant ancestor.
  expect(
    (await request.patch(`/api/tags/${sibling}`, { headers, data: { parentId: leaf } })).status(),
  ).toBe(200);
  await expect(
    picker.getByRole('checkbox', { name: 'Work / Projects / Catch', exact: true }),
  ).not.toBeChecked();
  await expect(
    picker.getByRole('checkbox', { name: 'Work / Projects / Catch / Website' }),
  ).toBeChecked();
  await expect(dialog.getByRole('region', { name: 'Tags' }).getByRole('button')).toHaveCount(2);
});

test('search combines descendant tags, any and all matching, text, colors and untagged notes', async ({
  page,
  request,
}) => {
  await signUp(page);
  const headers = await auth(page);
  const root = await addTag(request, headers, 'Work', null, 'blue');
  const projects = await addTag(request, headers, 'Projects', root);
  const leaf = await addTag(request, headers, 'Catch', projects);
  const ideas = await addTag(request, headers, 'Ideas');
  const rows = [
    {
      title: 'Release checklist',
      primaryTagId: leaf,
      secondaryTagIds: [ideas],
      isArchived: false,
      color: 'default',
    },
    {
      title: 'Archived roadmap',
      primaryTagId: null,
      secondaryTagIds: [leaf],
      isArchived: true,
      color: 'green',
    },
    {
      title: 'Design sketches',
      primaryTagId: null,
      secondaryTagIds: [ideas],
      isArchived: false,
      color: 'default',
    },
    {
      title: 'Plain blue note',
      primaryTagId: null,
      secondaryTagIds: [],
      isArchived: false,
      color: 'blue',
    },
    {
      title: 'Loose thought',
      primaryTagId: null,
      secondaryTagIds: [],
      isArchived: false,
      color: 'default',
    },
    {
      title: 'Deleted release',
      primaryTagId: leaf,
      secondaryTagIds: [],
      isArchived: false,
      color: 'default',
      deletedAt: new Date().toISOString(),
    },
  ];
  await seedNotes(
    page,
    rows.map((row) => row.title),
  );
  for (const row of rows) {
    const noteId = await card(page, row.title).getAttribute('data-note-card');
    expect(noteId).toBeTruthy();
    expect(
      (
        await request.patch(`/api/notes/${noteId}`, {
          headers,
          data: {
            color: row.color,
            isArchived: row.isArchived,
            deletedAt: row.deletedAt,
          },
        })
      ).status(),
    ).toBe(200);
    if (row.primaryTagId || row.secondaryTagIds.length)
      expect(
        (
          await request.patch(`/api/note-tags/${noteId}`, {
            headers,
            data: { primaryTagId: row.primaryTagId, secondaryTagIds: row.secondaryTagIds },
          })
        ).status(),
      ).toBe(200);
  }
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const browse = page.getByRole('region', { name: 'Browse tags' });
  await expect(browse.getByRole('button', { name: 'Browse Work', exact: true })).toContainText('2');
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  const notes = results.getByRole('article');
  await expect(notes).toHaveCount(2);
  await expect(results).toContainText('Archived roadmap');
  await expect(results).not.toContainText('Deleted release');
  await expect(results).not.toContainText('Plain blue note');
  await expect(page.getByRole('button', { name: 'Remove color filter' })).toHaveCount(0);
  await expect(
    notes
      .filter({ hasText: 'Release checklist' })
      .getByRole('region', { name: 'Tags' })
      .getByRole('button'),
  ).toHaveCount(2);
  const filters = page.getByRole('region', { name: 'Search filters' });
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await filters.getByRole('tab', { name: 'Tags', exact: true }).click();
  await filters.getByRole('textbox', { name: 'Find tags' }).fill('Ideas');
  await filters.getByRole('checkbox', { name: 'Ideas', exact: true }).check();
  await expect(notes).toHaveCount(3);
  await filters.getByRole('button', { name: 'All tags', exact: true }).click();
  await expect(notes).toHaveCount(1);
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page.getByRole('textbox', { name: 'Search notes' }).fill('release');
  await expect(notes).toHaveCount(1);
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await filters.getByRole('tab', { name: 'Colors', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(notes).toHaveCount(1);
  await filters.getByRole('button', { name: 'Green', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page.getByRole('button', { name: 'Remove color filter' }).click();
  await expect(notes).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search notes' }).clear();
  await page.getByRole('button', { name: 'Remove Work filter' }).click();
  await expect(notes).toHaveCount(2);
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await browse.getByRole('button', { name: 'Browse Untagged' }).click();
  await expect(notes).toHaveCount(2);
  await expect(results).toContainText('Loose thought');
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await expect(filters.getByRole('heading', { name: 'Colors' })).toBeVisible();
  await filters.getByRole('button', { name: 'No color', exact: true }).click();
  await expect(notes).toHaveCount(1);
  // Filtering remains local while the API is unavailable.
  await page.route('**/api/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await page.getByRole('button', { name: 'Remove Untagged filter' }).click();
  await expect(notes).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search notes' }).fill('sketches');
  await expect(notes).toHaveCount(1);
});

test('search filter glass stays above the keyboard and closes before leaving search', async ({
  page,
  request,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);
  const headers = await auth(page);
  const work = await addTag(request, headers, 'Work', null, 'blue');
  await addTag(request, headers, 'Projects', work);
  for (let index = 0; index < 10; index++) await addTag(request, headers, `Other ${index}`, work);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search notes' });
  const button = page.getByRole('button', { name: 'Filter notes' });
  await expect(page.getByRole('search').getByRole('button', { name: 'Filter notes' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toHaveCount(0);
  // Sample real frames to catch a panel that snaps in or out instead of expanding.
  for (const opening of [true, false]) {
    const heights = await button.evaluate(async (button) => {
      button.click();
      const heights: number[] = [];
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        heights.push(
          document.getElementById('search-filter-panel')?.parentElement?.getBoundingClientRect()
            .height ?? 0,
        );
      }
      return heights;
    });
    const maximum = Math.max(...heights);
    expect(heights.some((height) => height > maximum * 0.15 && height < maximum * 0.85)).toBe(true);
    if (opening) expect(heights.at(-1)!).toBeGreaterThan(maximum * 0.9);
    else expect(heights.at(-1)!).toBeLessThan(maximum * 0.1);
  }
  await button.click();
  await expect(input).toBeFocused();
  const panel = page.getByRole('region', { name: 'Search filters' });
  await expect(panel.getByRole('heading', { name: 'Colors', exact: true })).toBeVisible();
  await expect(panel).toHaveClass(/glass/);
  await expect(panel.getByRole('button', { name: 'Close filters' })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Filters', exact: true })).toHaveCount(0);
  await expect(
    panel.getByText('Includes primary tags, secondary tags and descendants.'),
  ).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Blue', exact: true }).locator('svg')).toHaveCount(
    1,
  );
  await settledBox(panel.locator('..'));
  await page.screenshot({ path: testInfo.outputPath('search-filter-colors.png') });
  for (const name of ['Tags', 'Colors', 'Tags']) {
    const samples = await panel.getByRole('tab', { name, exact: true }).evaluate(async (button) => {
      button.click();
      const samples: { height: number; x: number; bottom: number }[] = [];
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        const panel = document.getElementById('search-filter-panel');
        const active = panel?.querySelector<HTMLElement>(
          '[role="tabpanel"]:not([aria-hidden="true"])',
        );
        if (panel && active)
          samples.push({
            height: panel.getBoundingClientRect().height,
            x: new DOMMatrix(getComputedStyle(active).transform).m41,
            bottom: panel.querySelector('[role="tablist"]')!.getBoundingClientRect().bottom,
          });
      }
      return samples;
    });
    const minimum = Math.min(...samples.map((sample) => sample.height));
    const maximum = Math.max(...samples.map((sample) => sample.height));
    expect(maximum - minimum).toBeGreaterThan(20);
    expect(samples.some(({ height }) => height > minimum + 5 && height < maximum - 5)).toBe(true);
    expect(samples.some(({ x }) => Math.abs(x) > 2)).toBe(true);
    expect(
      Math.max(...samples.map(({ bottom }) => bottom)) -
        Math.min(...samples.map(({ bottom }) => bottom)),
    ).toBeLessThan(1);
  }
  await settledBox(panel.locator('..'));
  await expect(panel.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(1);
  await expect(panel.locator('[data-slot="scroll-area-thumb"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('search-filters.png') });
  const search = panel.getByRole('textbox', { name: 'Find tags' });
  await search.click();
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  await expect(search).toBeFocused();
  await page.keyboard.type('Projects');
  await panel.getByRole('checkbox', { name: 'Work / Projects' }).check();
  await panel.getByRole('tab', { name: 'Colors', exact: true }).click();
  await panel.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByRole('tab', { name: 'Tags', exact: true }).click();
  await search.click();
  await search.clear();
  await panel.getByRole('button', { name: 'Collapse Work' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Work / Projects' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Expand Work' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Work / Projects' })).toBeChecked();
  await search.click();
  const bounds = await panel.boundingBox();
  const keyboardTop = await page.evaluate(() => innerHeight - 320);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(keyboardTop);
  await page.screenshot({ path: testInfo.outputPath('search-filters-keyboard.png') });
  await search.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole('button', { name: 'Remove Projects filter' })).toBeVisible();
  await button.click();
  await input.click();
  await expect(panel).toHaveCount(0);
  await button.click();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page).not.toHaveURL(/\/search$/);
  await expect(panel).toHaveCount(0);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(panel.getByRole('tab', { name: 'Tags', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await expect(panel.getByRole('tab', { name: 'Tags', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('first and last search filters animate browsing, results and no matches', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);
  const headers = await auth(page);
  const work = await addTag(request, headers, 'Work', null, 'blue');
  await addTag(request, headers, 'Empty');
  await seedNotes(page, ['Tagged task', 'Unrelated task']);
  const noteId = await card(page, 'Tagged task').getAttribute('data-note-card');
  expect(
    (
      await request.patch(`/api/note-tags/${noteId}`, {
        headers,
        data: { primaryTagId: work, secondaryTagIds: [] },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const browse = page.getByRole('region', { name: 'Browse tags' });
  await expect(browse.getByRole('button', { name: 'Browse Work', exact: true })).toContainText('1');

  async function transition(button: Locator, from: string, to: string) {
    const samples = await button.evaluate(
      async (button, { from, to }) => {
        button.click();
        const samples: { opacity: number; y: number; outgoing: boolean; inert: boolean }[] = [];
        for (let frame = 0; frame < 40; frame++) {
          await new Promise(requestAnimationFrame);
          const incoming = document.querySelector<HTMLElement>(
            `[data-search-view="${to}"]:not([aria-hidden="true"])`,
          );
          const outgoing = document.querySelector<HTMLElement>(`[data-search-view="${from}"]`);
          if (incoming) {
            const style = getComputedStyle(incoming);
            samples.push({
              opacity: Number(style.opacity),
              y: new DOMMatrix(style.transform).m42,
              outgoing: !!outgoing,
              inert: !!outgoing?.inert && outgoing.getAttribute('aria-hidden') === 'true',
            });
          }
        }
        return samples;
      },
      { from, to },
    );
    expect(samples.some(({ opacity }) => opacity > 0.1 && opacity < 0.9)).toBe(true);
    expect(samples.some(({ y }) => Math.abs(y) > 1)).toBe(true);
    expect(samples.some(({ outgoing }) => outgoing)).toBe(true);
    expect(samples.filter(({ outgoing }) => outgoing).every(({ inert }) => inert)).toBe(true);
    await expect(page.locator(`[data-search-view="${from}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-search-view="${to}"]`)).toHaveCSS('opacity', '1');
  }

  await transition(
    browse.getByRole('button', { name: 'Browse Work', exact: true }),
    'browse',
    'results',
  );
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('article')).toHaveCount(1);
  await expect(results).toContainText('Tagged task');
  await transition(page.getByRole('button', { name: 'Remove Work filter' }), 'results', 'browse');

  await page.getByRole('button', { name: 'Filter notes' }).click();
  const panel = page.getByRole('region', { name: 'Search filters' });
  const blue = panel.getByRole('button', { name: 'Blue', exact: true });
  await transition(blue, 'browse', 'results');
  await transition(blue, 'results', 'browse');
  await page.getByRole('button', { name: 'Filter notes' }).click();

  await transition(
    browse.getByRole('button', { name: 'Browse Empty', exact: true }),
    'browse',
    'empty',
  );
  await expect(page.getByText('No matching notes', { exact: true })).toBeVisible();
  await transition(page.getByRole('button', { name: 'Remove Empty filter' }), 'empty', 'browse');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await browse.getByRole('button', { name: 'Browse Work', exact: true }).click();
  await expect(results).toBeVisible();
  await expect(page.locator('[data-search-view="browse"]')).toHaveCount(0);
  await expect(page.locator('[data-search-view="results"]')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Remove Work filter' }).click();
  await expect(browse).toBeVisible();
  await expect(page.locator('[data-search-view="results"]')).toHaveCount(0);
});

test('filter badges stay steady through empty results and spring into place after removal', async ({
  page,
  request,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signUp(page);
  const headers = await auth(page);
  const work = await addTag(request, headers, 'Work', null, 'blue');
  const ideas = await addTag(request, headers, 'Ideas', null, 'amber');
  await seedNotes(page, ['Work task', 'Idea task']);
  for (const [title, tagId] of [
    ['Work task', work],
    ['Idea task', ideas],
  ]) {
    const noteId = await card(page, title).getAttribute('data-note-card');
    expect(
      (
        await request.patch(`/api/note-tags/${noteId}`, {
          headers,
          data: { primaryTagId: tagId, secondaryTagIds: [] },
        })
      ).status(),
    ).toBe(200);
  }
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Browse Work', exact: true })).toContainText('1');
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const panel = page.getByRole('region', { name: 'Search filters' });
  await panel.getByRole('tab', { name: 'Tags', exact: true }).click();
  await panel.getByRole('checkbox', { name: 'Work', exact: true }).check();
  // The match control should grow into flow when a second tag is selected.
  const heights = await panel
    .getByRole('checkbox', { name: 'Ideas', exact: true })
    .evaluate(async (checkbox) => {
      checkbox.click();
      const heights: number[] = [];
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        const legend = [...document.querySelectorAll('legend')].find(
          (legend) => legend.textContent === 'Match tags',
        );
        heights.push(legend?.parentElement?.parentElement?.getBoundingClientRect().height ?? 0);
      }
      return heights;
    });
  expect(heights.some((height) => height > 5 && height < 35)).toBe(true);
  expect(heights.at(-1)!).toBeGreaterThan(40);
  const group = page.getByRole('group', { name: 'Active filters' });
  await settledBox(group);
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('article')).toHaveCount(2);
  await group.getByRole('button', { name: 'Remove Work filter' }).hover();
  await page.screenshot({
    path: testInfo.outputPath('compact-match-and-filter-badges.png'),
    animations: 'disabled',
  });
  for (const name of ['All tags', 'Any tag']) {
    const samples = await panel
      .getByRole('button', { name, exact: true })
      .evaluate(async (button) => {
        const group = document.querySelector('fieldset[aria-label="Active filters"]')!;
        const badges = [...group.querySelectorAll<HTMLElement>('.glass-badge')];
        const initial = badges.map((badge) => badge.getBoundingClientRect());
        button.click();
        const samples: { retained: boolean; opacity: number; movement: number }[] = [];
        for (let frame = 0; frame < 40; frame++) {
          await new Promise(requestAnimationFrame);
          for (const [index, badge] of badges.entries()) {
            let opacity = 1;
            for (
              let ancestor: HTMLElement | null = badge;
              ancestor;
              ancestor = ancestor.parentElement
            )
              opacity *= Number(getComputedStyle(ancestor).opacity);
            const box = badge.getBoundingClientRect();
            samples.push({
              retained: badge.isConnected,
              opacity,
              movement: Math.hypot(box.x - initial[index].x, box.y - initial[index].y),
            });
          }
        }
        return samples;
      });
    expect(
      samples.every(
        ({ retained, opacity, movement }) => retained && opacity > 0.99 && movement < 0.5,
      ),
    ).toBe(true);
    if (name === 'All tags')
      await expect(page.getByText('No matching notes', { exact: true })).toBeVisible();
    else await expect(results.getByRole('article')).toHaveCount(2);
  }
  const collapse = await panel
    .getByRole('checkbox', { name: 'Ideas', exact: true })
    .evaluate(async (checkbox) => {
      checkbox.click();
      const heights: number[] = [];
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        const legend = [...document.querySelectorAll('legend')].find(
          (legend) => legend.textContent === 'Match tags',
        );
        heights.push(legend?.parentElement?.parentElement?.getBoundingClientRect().height ?? 0);
      }
      return heights;
    });
  expect(collapse.some((height) => height > 5 && height < 35)).toBe(true);
  expect(collapse.at(-1)!).toBeLessThan(1);
  await panel.getByRole('checkbox', { name: 'Ideas', exact: true }).check();
  await settledBox(group);
  await expect(panel.getByRole('group', { name: 'Match tags' })).toBeVisible();
  await page.getByRole('button', { name: 'Filter notes' }).click();
  const removal = await page
    .getByRole('button', { name: 'Remove Work filter' })
    .evaluate(async (button) => {
      const group = button.closest('fieldset')!;
      const remaining = group
        .querySelector<HTMLButtonElement>('button[aria-label="Remove Ideas filter"]')!
        .closest('.glass-badge')!;
      const before = remaining.getBoundingClientRect();
      const badge = button.closest('.glass-badge')!;
      const contained = button.getBoundingClientRect().right <= badge.getBoundingClientRect().right;
      button.click();
      const positions: number[] = [];
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        const box = remaining.getBoundingClientRect();
        positions.push(Math.hypot(box.x - before.x, box.y - before.y));
      }
      return { contained, positions };
    });
  expect(removal.contained).toBe(true);
  const distance = removal.positions.at(-1)!;
  expect(distance).toBeGreaterThan(40);
  expect(
    removal.positions.some((position) => position > distance * 0.15 && position < distance * 0.85),
  ).toBe(true);
  await expect(group.getByRole('button', { name: 'Remove Work filter' })).toHaveCount(0);
  await expect(group.getByRole('button', { name: 'Remove Ideas filter' })).toBeVisible();
  await expect(results.getByRole('article')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('remaining-filter-badge.png') });
  await page.getByRole('button', { name: 'Filter notes' }).click();
  await expect(panel.getByRole('group', { name: 'Match tags' })).toHaveCount(0);
});
