import { expect, test } from '@playwright/test';
import { card, seedNotes, signUp } from './helpers';

const SAFE_TOP = 32;

test('the title and brand stay clear of the controls and status bar while the page scrolls', async ({
  page,
  isMobile,
}) => {
  // On a narrow phone the centered title is wider than the gap between the header's corners.
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  await signUp(page);
  await page.evaluate((inset) => {
    document.documentElement.style.setProperty('--safe-area-inset-top', `${inset}px`);
  }, SAFE_TOP);
  await seedNotes(
    page,
    Array.from({ length: 24 }, (_, index) => ({
      title: `Note ${index + 1}`,
      body: 'Something to scroll past',
    })),
  );
  await expect(card(page, 'Note 24')).toBeVisible();
  const brand = page.getByRole('banner').getByRole('img', { name: 'Catch' });
  await expect(brand).toBeVisible();

  // Every frame of a scroll down the page and back, with time for the title to settle after
  // each: the collapse is a spring, so where it rests says nothing about the way there.
  const frames = await page.evaluate(() => {
    type Box = { top: number; right: number; bottom: number; left: number };
    const box = (element: Element): Box => {
      const { top, right, bottom, left } = element.getBoundingClientRect();
      return { top, right, bottom, left };
    };
    return new Promise<{ title: Box; brand: Box; controls: Box[] }[]>((resolve) => {
      const frames: { title: Box; brand: Box; controls: Box[] }[] = [];
      const header = document.querySelector('header');
      const title = header?.querySelector('h1');
      const brand = header?.querySelector('img[alt="Catch"]');
      if (!header || !title || !brand) throw new Error('Missing header, title or brand');
      const settle = 40;
      const path = [
        ...Array.from({ length: 60 }, (_, step) => step * 3),
        ...Array.from({ length: settle }, () => 180),
        ...Array.from({ length: 60 }, (_, step) => 180 - (step + 1) * 3),
        ...Array.from({ length: settle }, () => 0),
      ];
      let step = 0;
      function sample() {
        frames.push({
          title: box(title as Element),
          brand: box(brand as Element),
          controls: [
            ...(header as Element).querySelectorAll('button:not([aria-label="Scroll to top"])'),
          ].map(box),
        });
        const next = path[step++];
        if (next === undefined) return resolve(frames);
        window.scrollTo(0, next);
        requestAnimationFrame(sample);
      }
      sample();
    });
  });

  expect(frames.length).toBeGreaterThan(100);
  const first = frames[0];
  if (!first) throw new Error('No frames');
  expect(first.controls.length).toBeGreaterThan(0);
  for (const { title, brand, controls } of frames) {
    expect(title.top).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(brand.top).toBeGreaterThanOrEqual(SAFE_TOP);
    for (const control of controls) {
      const apart =
        title.right <= control.left ||
        title.left >= control.right ||
        title.bottom <= control.top ||
        title.top >= control.bottom;
      expect(apart, JSON.stringify({ title, control })).toBe(true);
    }
  }

  // Scrolled, the title has the brand's corner to itself.
  await page.evaluate(() => window.scrollTo(0, 180));
  await expect(brand).toBeHidden();
  await page.getByRole('button', { name: 'Scroll to top' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(brand).toBeVisible();
});
