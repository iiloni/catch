import { expect, test } from '@playwright/test';
import { card, seedNotes, settledBox, signUp } from './helpers';

for (const withLinks of [false, true]) {
  test(`a tall note lands without clipping its card${withLinks ? ' with link previews' : ''}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 400, height: 600 });
    await signUp(page);
    const title = 'A tall card';
    const body = 'A long paragraph wraps into many lines in the gallery. '.repeat(35);
    await seedNotes(page, [{ title, body: body + (withLinks ? 'https://example.com' : '') }]);
    const note = card(page, title);
    await expect(note).toBeVisible();
    if (withLinks) await expect(page.getByRole('button', { name: /^Link: / })).toBeVisible();

    // Exercise both a card below the header and one whose top is above the viewport.
    for (const scrolled of [false, true]) {
      await page.evaluate(
        (scrolled) => window.scrollTo(0, scrolled ? document.documentElement.scrollHeight : 0),
        scrolled,
      );
      const button = note.getByRole('button', { name: 'Open note' });
      const bounds = await settledBox(button);
      expect(bounds.height).toBeGreaterThan(600);
      expect(bounds.y < 0).toBe(scrolled);
      if (scrolled) expect(bounds.y + bounds.height).toBeLessThan(600);
      // Locator clicks can scroll a viewport-tall card and put the chosen point under
      // the fixed header. Click its settled, visible surface without changing the scroll.
      await page.mouse.click(bounds.x + 30, Math.max(bounds.y + 30, 150));
      const dialog = page.getByRole('dialog', { name: 'Edit note' });
      await expect(dialog.getByRole('textbox')).toBeVisible();
      const scroll = dialog.locator('[data-note-scroll]');
      expect((await scroll.boundingBox())?.height).toBe(600);
      if (scrolled)
        await scroll.evaluate((element) => {
          element.scrollTop = 300;
        });

      // Sample the actual drawn surface until it is removed. A fixed editor-sized surface
      // used to cut tall cards short, leaving a hole until the real card reappeared.
      const landing = dialog.evaluate(
        (surface) =>
          new Promise<{
            top: number;
            bottom: number;
            cardTop: number;
            cardBottom: number;
          }>((resolve, reject) => {
            let last:
              | { top: number; bottom: number; cardTop: number; cardBottom: number }
              | undefined;
            let frame = 0;
            const timeout = setTimeout(() => {
              cancelAnimationFrame(frame);
              reject(new Error('The editor did not finish closing'));
            }, 10_000);
            function capture() {
              if (!surface.isConnected) {
                clearTimeout(timeout);
                if (last) resolve(last);
                else reject(new Error('No card landing frames captured'));
                return;
              }
              const ghost = surface.querySelector('[aria-hidden="true"].absolute');
              const target = document.querySelector('[data-note-card]');
              if (ghost && target && Number(getComputedStyle(ghost).opacity) > 0.95) {
                const box = surface.getBoundingClientRect();
                const cardBox = target.getBoundingClientRect();
                const inset = getComputedStyle(surface).clipPath.match(/^inset\(([^r]+) round/);
                if (!inset) throw new Error('Missing container clip');
                const [top, , bottom] = inset[1].trim().split(/\s+/).map(Number.parseFloat);
                last = {
                  top: box.top + top,
                  bottom: box.bottom - bottom,
                  cardTop: cardBox.top,
                  cardBottom: cardBox.bottom,
                };
              }
              frame = requestAnimationFrame(capture);
            }
            capture();
          }),
      );
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      const landed = await landing;
      expect(Math.abs(landed.top - landed.cardTop)).toBeLessThan(4);
      expect(Math.abs(landed.bottom - landed.cardBottom)).toBeLessThan(4);
      await expect(note).toBeVisible();
    }
  });
}

test('a closing note follows its card when the page scrolls under it', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  await signUp(page);
  const title = 'Followed home';
  const body = 'A paragraph that gives each card some height in the gallery. '.repeat(4);
  await seedNotes(page, [
    ...Array.from({ length: 12 }, (_, index) => ({ title: `Filler ${index}`, body })),
    { title, body },
  ]);
  const note = card(page, title);
  // Read before opening: the page behind an open note is inert.
  const id = await note.getAttribute('data-note-card');
  await note.getByRole('button', { name: 'Open note' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit note' });
  await expect(dialog.getByRole('textbox')).toBeVisible();

  // Scroll once the editor has started shrinking, then compare the last frame drawn before
  // it is removed with where the card is by then.
  const landing = dialog.evaluate(
    (surface, id) =>
      new Promise<{ top: number; cardTop: number; scrolled: number }>((resolve, reject) => {
        let last: { top: number; cardTop: number } | undefined;
        let scrolled = false;
        let frames = 0;
        const timeout = setTimeout(
          () => reject(new Error('The editor did not finish closing')),
          10_000,
        );
        function capture() {
          if (!surface.isConnected) {
            clearTimeout(timeout);
            if (last) resolve({ ...last, scrolled: window.scrollY });
            else reject(new Error('No card landing frames captured'));
            return;
          }
          const target = document.querySelector(`[data-note-card="${id}"]`);
          // The card's face is drawn on the surface only while it morphs, and the surface
          // lets touches through once it is closing.
          const closing = (surface as HTMLElement).style.pointerEvents === 'none';
          if (closing && surface.querySelector(':scope > [aria-hidden="true"]') && target) {
            // A few frames in: the card is measured on the first frame of the close.
            frames += 1;
            if (!scrolled && frames > 6) {
              scrolled = true;
              window.scrollBy({ top: 120, behavior: 'instant' });
            }
            last = {
              top: surface.getBoundingClientRect().top,
              cardTop: target.getBoundingClientRect().top,
            };
          }
          requestAnimationFrame(capture);
        }
        capture();
      }),
    id,
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const landed = await landing;
  expect(landed.scrolled).toBe(120);
  expect(Math.abs(landed.top - landed.cardTop)).toBeLessThan(4);
  await expect(note).toBeVisible();
});
