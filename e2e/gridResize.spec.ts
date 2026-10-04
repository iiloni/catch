import { expect, type Page, test } from '@playwright/test';
import { card, openNote, seedNotes, signUp } from './helpers';

type Sample = {
  /** The card's width and right edge, and the left edge of the page's content. */
  width: number;
  right: number;
  page: number;
  /** How much of the screen the note pane covers. */
  pane: number;
  overflow: number;
  header: number;
};

/**
 * Records what each frame from now on shows of a card and the page around it, so a test can
 * tell a change that was animated from one made in a single step.
 */
async function recordFrames(page: Page, title: string) {
  await page.evaluate((title) => {
    const samples: Sample[] = [];
    Object.assign(window, { __samples: samples });
    const cell = [...document.querySelectorAll<HTMLElement>('[data-note-cell]')].find((cell) =>
      cell.textContent?.includes(title),
    );
    const section = cell?.closest('section');
    const header = document.querySelector<HTMLElement>('[data-page-header]');
    // Sampled from a resize observer, which runs after every animation frame callback: an
    // earlier callback would see a frame that Motion has yet to finish drawing.
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;width:1px;height:1px';
    new ResizeObserver(() => {
      samples.push({
        width: cell?.getBoundingClientRect().width ?? 0,
        right: cell?.getBoundingClientRect().right ?? 0,
        page: section?.getBoundingClientRect().left ?? 0,
        pane: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--note-pane'),
        ),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        header: header?.getBoundingClientRect().width ?? 0,
      });
    }).observe(probe);
    const tick = () => {
      probe.style.width = probe.style.width === '1px' ? '2px' : '1px';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, title);
}

const frames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('cards grow into a single column without widening the page', async ({ page }) => {
    await signUp(page);
    await seedNotes(page, [
      { title: 'Alpha', body: 'First' },
      { title: 'Beta', body: 'Second' },
      { title: 'Gamma', body: 'Third' },
    ]);
    // The second column's card: it moves left as it grows, and must not reach past the screen.
    const second = (await card(page, 'Alpha').boundingBox())?.x ? 'Alpha' : 'Beta';
    await recordFrames(page, second);

    await page.getByRole('button', { name: 'Switch to single column view' }).click();
    await expect.poll(async () => (await frames(page)).at(-1)?.width).toBeGreaterThan(300);

    const samples = await frames(page);
    expect(samples[0]?.width).toBeLessThan(200);
    // However many frames the machine manages, none shows the card at its new width where
    // its old column was: it grows as it moves, so its right edge stays on the screen.
    for (const sample of samples) {
      expect(sample.right).toBeLessThanOrEqual(391);
      expect(sample.overflow).toBeLessThanOrEqual(0);
      expect(sample.header).toBe(390);
    }
    await expect(page.getByRole('button', { name: 'Switch to masonry view' })).toBeInViewport();
  });
});

test.describe('on a wide screen', () => {
  // Wider than the page gets, so it sits between gutters until a note takes part of the screen.
  const SCREEN = 1800;
  const PAGE_MAX = 1280;
  test.use({ viewport: { width: SCREEN, height: 900 } });

  test('the page leaves its gutter along with the pane', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The pane and its gutters are the same on both layouts.');
    await signUp(page);
    await seedNotes(page, [
      { title: 'Alpha', body: 'First' },
      { title: 'Beta', body: 'Second' },
    ]);
    await expect(card(page, 'Alpha')).toBeVisible();
    await recordFrames(page, 'Alpha');

    await openNote(page, 'Alpha');
    await expect.poll(async () => (await frames(page)).at(-1)?.page).toBe(0);
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(async () => (await frames(page)).at(-1)?.pane).toBe(0);

    const samples = await frames(page);
    expect(samples[0]?.page).toBe((SCREEN - PAGE_MAX) / 2);
    // In every frame the page is as far across its gutter as the pane is across the screen,
    // rather than jumping to where it will end up or getting there before the pane does.
    const full = Math.max(...samples.map((sample) => sample.pane));
    for (const sample of samples) {
      const gutter = ((SCREEN - PAGE_MAX) / 2) * (1 - sample.pane / full);
      expect(Math.abs(sample.page - gutter)).toBeLessThan(1);
    }
    // The pane starts its slide once the page is drawn at its new width and advances by
    // frames, so even a busy machine shows it setting off rather than nearly there.
    const started = samples.find((sample) => sample.pane > 0)?.pane ?? 0;
    expect(started).toBeLessThan(full * 0.4);
  });
});
