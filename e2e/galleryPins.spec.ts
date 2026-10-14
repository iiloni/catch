import { expect, type Page, test } from '@playwright/test';
import { bearerToken, card, seedNotes, settledBox, signUp } from './helpers';

test.use({ video: 'on' });

async function pin(page: Page, title: string, isPinned: boolean) {
  await page.evaluate(
    async ({ title, isPinned }) => {
      const { setNotePinned, getNote } = await import('/src/lib/notes.ts');
      const { noteStore } = await import('/src/lib/noteStore.ts');
      const { isVaultMode } = await import('/src/lib/vault.ts');
      const { sharedNotesCollection } = await import('/src/lib/collections.ts');
      const shared = isVaultMode()
        ? []
        : [...sharedNotesCollection.values()].flatMap((row) => getNote(row.noteId) ?? []);
      const note = [...noteStore.values(isVaultMode()), ...shared].find((note) =>
        JSON.stringify(note.content).includes(title),
      );
      if (!note) throw new Error('Missing note');
      await setNotePinned(note.id, isPinned).isPersisted.promise;
    },
    { title, isPinned },
  );
}

async function states(page: Page) {
  return page.evaluate(async () => {
    const { noteStore } = await import('/src/lib/noteStore.ts');
    const { isVaultMode } = await import('/src/lib/vault.ts');
    const { sharedNotesCollection } = await import('/src/lib/collections.ts');
    const { getNote } = await import('/src/lib/notes.ts');
    const shared = isVaultMode()
      ? []
      : [...sharedNotesCollection.values()].flatMap((row) => getNote(row.noteId) ?? []);
    const { sortNotes } = await import('/src/lib/sortNotes.ts');
    return sortNotes([...noteStore.values(isVaultMode()), ...shared], 'position').map((note) => ({
      title: JSON.stringify(note.content),
      pin: note.isPinned,
      position: note.position,
    }));
  });
}

const cell = (page: Page, title: string) =>
  page
    .locator('[data-note-cell]')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });

async function dragTo(
  page: Page,
  title: string,
  target: { x: number; y: number },
  mobile: boolean,
  cancel = false,
) {
  const box = await settledBox(cell(page, title));
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await page.waitForTimeout(400);
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((target.x - from.x) * step) / 12,
            y: from.y + ((target.y - from.y) * step) / 12,
          },
        ],
      });
    }
    await page.waitForTimeout(100);
    await cdp.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('gallery pin actions keep card elements and unpin ahead of newer notes', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Old', 'Peer']);
  await settledBox(cell(page, 'Old'));
  const original = await cell(page, 'Old').elementHandle();
  await pin(page, 'Old', true);
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  await seedNotes(page, ['Newer', 'Newest']);
  await pin(page, 'Old', false);
  await settledBox(cell(page, 'Old'));
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  expect((await states(page))[0]?.title).toContain('Old');
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeHidden();
  const first = await settledBox(cell(page, 'Old'));
  const next = await settledBox(cell(page, 'Newest'));
  expect(first.y).toBeLessThanOrEqual(next.y);
  expect(first.x).toBeLessThan(next.x);
  await page.reload();
  await expect(card(page, 'Old')).toBeVisible();
  expect((await states(page))[0]?.title).toContain('Old');
});

test('gallery drags change pin groups, cancel safely, and persist the destination order', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await seedNotes(page, ['Old', 'Peer', 'Pinned']);
  await pin(page, 'Pinned', true);
  const pinned = await settledBox(cell(page, 'Pinned'));
  const target = { x: pinned.x + pinned.width / 2, y: pinned.y + pinned.height / 2 };
  const before = await states(page);
  await dragTo(page, 'Old', target, isMobile, true);
  expect(await states(page)).toEqual(before);
  await settledBox(cell(page, 'Old'));
  await dragTo(page, 'Old', target, isMobile);
  await expect
    .poll(async () =>
      (await states(page))
        .filter((note) => note.pin)
        .map((note) => (note.title.includes('Old') ? 'Old' : 'Pinned')),
    )
    .toEqual(['Old', 'Pinned']);
  const peer = await settledBox(cell(page, 'Peer'));
  await dragTo(page, 'Old', { x: peer.x + peer.width / 2, y: peer.y + peer.height / 2 }, isMobile);
  await expect
    .poll(async () =>
      (await states(page))
        .filter((note) => !note.pin)
        .map((note) => (note.title.includes('Old') ? 'Old' : 'Peer')),
    )
    .toEqual(['Old', 'Peer']);
  await page.reload();
  await expect(card(page, 'Old')).toBeVisible();
  expect((await states(page)).filter((note) => !note.pin)[0]?.title).toContain('Old');
});

test('gallery drags can land in empty pinned and unpinned sections', async ({ page, isMobile }) => {
  await signUp(page);
  await seedNotes(page, ['Only']);
  const box = await settledBox(cell(page, 'Only'));
  await dragTo(page, 'Only', { x: box.x + box.width / 2, y: box.y + 8 }, isMobile);
  await expect.poll(async () => (await states(page))[0]?.pin).toBe(true);
  const pinned = await settledBox(cell(page, 'Only'));
  await dragTo(
    page,
    'Only',
    { x: pinned.x + pinned.width / 2, y: pinned.y + pinned.height + 100 },
    isMobile,
  );
  await expect.poll(async () => (await states(page))[0]?.pin).toBe(false);
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeHidden();
});

test.describe('motion', () => {
  test('gallery pin changes animate the moved card and displaced cards', async ({
    page,
  }, testInfo) => {
    await signUp(page);
    await seedNotes(page, ['Moving', 'Neighbour', 'First']);
    await settledBox(cell(page, 'Moving'));
    await settledBox(cell(page, 'First'));
    await page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>('[data-note-cell]')];
      const samples: { positions: { x: number; y: number }[]; connected: boolean }[] = [];
      Object.assign(window, { __pinFrames: samples });
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.cssText = 'position:fixed;visibility:hidden;width:1px;height:1px';
      new ResizeObserver(() => {
        samples.push({
          positions: cells.map((cell) => {
            const box = cell.getBoundingClientRect();
            return { x: box.x, y: box.y };
          }),
          connected: cells.every((cell) => cell.isConnected),
        });
      }).observe(probe);
      const tick = () => {
        probe.style.width = probe.style.width === '1px' ? '2px' : '1px';
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Retain a recording for visual inspection of painted frames in each tested engine.
    await testInfo.attach('browser-version', {
      body: page.context().browser()?.version() ?? 'unknown',
      contentType: 'text/plain',
    });
    await pin(page, 'Moving', true);
    await settledBox(cell(page, 'Moving'));
    await settledBox(cell(page, 'First'));
    await page.screenshot({ path: testInfo.outputPath('pinned.png') });
    await pin(page, 'Moving', false);
    await settledBox(cell(page, 'Moving'));
    await settledBox(cell(page, 'First'));
    await page.screenshot({ path: testInfo.outputPath('unpinned.png') });
    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            __pinFrames: { positions: { x: number; y: number }[]; connected: boolean }[];
          }
        ).__pinFrames,
    );
    expect(samples.every((sample) => sample.connected)).toBe(true);
    for (let index = 0; index < 3; index++) {
      const positions = new Set(
        samples.map(
          (sample) =>
            `${Math.round(sample.positions[index]!.x)},${Math.round(sample.positions[index]!.y)}`,
        ),
      );
      expect(positions.size).toBeGreaterThan(4);
    }
  });
});

test('gallery keyboard drags cross pin groups and Escape leaves the note unchanged', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Keyboard gesture on desktop.');
  await signUp(page);
  await seedNotes(page, ['Plain', 'Pinned']);
  await pin(page, 'Pinned', true);
  await settledBox(cell(page, 'Plain'));
  await cell(page, 'Plain').focus();
  await page.keyboard.press('Space');
  for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  expect((await states(page)).find((note) => note.title.includes('Plain'))?.pin).toBe(false);
  await settledBox(cell(page, 'Plain'));
  await page.keyboard.press('Space');
  for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect
    .poll(async () => (await states(page)).find((note) => note.title.includes('Plain'))?.pin)
    .toBe(true);
});

test('gallery unpinning and dragging work on sealed vault notes', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The same gallery gestures are already covered on touch.');
  await signUp(page);
  await seedNotes(page, ['Ordinary']);
  await page.evaluate(async () => {
    const { createVault, enterVault } = await import('/src/lib/vault.ts');
    const { createNote, setNotePinned } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    await createVault('gallery test password', true);
    enterVault();
    const note = createNote({
      userId: getSignedInUser().id,
      vault: true,
      content: [{ type: 'heading', props: { level: 3 }, content: 'Secret' }],
    });
    await note.transaction.isPersisted.promise;
    await setNotePinned(note.id, true).isPersisted.promise;
    await createNote({
      userId: getSignedInUser().id,
      vault: true,
      content: [{ type: 'heading', props: { level: 3 }, content: 'Vault peer' }],
    }).transaction.isPersisted.promise;
  });
  await expect(card(page, 'Secret')).toBeVisible();
  await pin(page, 'Secret', false);
  expect((await states(page))[0]?.title).toContain('Secret');
  const box = await settledBox(cell(page, 'Secret'));
  await dragTo(page, 'Secret', { x: box.x + box.width / 2, y: box.y + 8 }, false);
  await expect
    .poll(async () => (await states(page)).find((note) => note.title.includes('Secret'))?.pin)
    .toBe(true);
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { vaultStatus } = await import('/src/lib/vault.ts');
        return vaultStatus.get();
      }),
    )
    .toBe('unlocked');
  await page.getByRole('button', { name: 'Open the vault' }).click();
  await expect(card(page, 'Secret')).toBeVisible();
  expect((await states(page)).find((note) => note.title.includes('Secret'))?.pin).toBe(true);
  await expect(card(page, 'Ordinary')).toHaveCount(0);
});

test('gallery unpinning and dragging persist for a reader of a shared note', async ({
  page,
  playwright,
  baseURL,
  extraHTTPHeaders,
  isMobile,
}) => {
  test.skip(isMobile, 'The same gallery gestures are already covered on touch.');
  await signUp(page);
  const owner = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
  try {
    const signup = await owner.post('/api/auth/sign-up/email', {
      headers: { Origin: new URL(baseURL ?? '').origin },
      data: {
        email: `gallery-owner-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Owner',
      },
    });
    const headers = { Authorization: `Bearer ${bearerToken(signup)}` };
    const id = crypto.randomUUID().replace(/^(.{14})./, '$17');
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    expect(
      (
        await owner.post('/api/notes', {
          headers,
          data: { id, content: [{ type: 'heading', props: { level: 3 }, content: 'Shared' }] },
        })
      ).ok(),
    ).toBe(true);
    expect((await owner.put(`/api/note-shares/${id}`, { headers, data: { token } })).ok()).toBe(
      true,
    );
    await page.evaluate(async (token) => {
      const { acceptSharedNote } = await import('/src/lib/sharing.ts');
      await acceptSharedNote(token);
    }, token);
    await pin(page, 'Shared', true);
    await seedNotes(page, ['Newer']);
    await pin(page, 'Shared', false);
    expect((await states(page))[0]?.title).toContain('Shared');
    const box = await settledBox(cell(page, 'Shared'));
    await dragTo(page, 'Shared', { x: box.x + box.width / 2, y: box.y + 8 }, false);
    await expect
      .poll(async () => (await states(page)).find((note) => note.title.includes('Shared'))?.pin)
      .toBe(true);
    await page.reload();
    await expect(card(page, 'Shared')).toBeVisible();
    expect((await states(page)).find((note) => note.title.includes('Shared'))?.pin).toBe(true);
  } finally {
    await owner.dispose();
  }
});
