import { expect, test } from '@playwright/test';
import { card, seedNotes, settledBox, signUp } from './helpers';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a tall note keeps its underlay attached through a swipe in ${colorScheme} mode`, async ({
    page,
    isMobile,
    browserName,
  }, testInfo) => {
    test.skip(!isMobile && browserName !== 'firefox', 'Touch and Firefox rendering coverage.');
    await page.setViewportSize({ width: 420, height: 1400 });
    await page.emulateMedia({ colorScheme });
    await page.clock.install();
    await signUp(page);
    await seedNotes(page, [
      {
        title: 'Tall bookmark',
        body: `${'A long note keeps its preview attached while moving. '.repeat(14)} https://example.com`,
      },
    ]);
    const note = card(page, 'Tall bookmark');
    const surface = page.locator('[data-swipe-archive]').filter({ has: note });
    const underlay = surface.locator('[data-link-underlay]');
    await expect(underlay).toBeVisible();
    const before = await settledBox(note);
    expect(before.height).toBeGreaterThan(500);
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const x = before.x + before.width / 2;
    const y = before.y + 50;
    const cdp = isMobile ? await page.context().newCDPSession(page) : null;

    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
    } else {
      await note.getByRole('button', { name: 'Open note' }).dispatchEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
    }
    for (const dx of [40, -40]) {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + dx, y }],
        });
      } else {
        await surface.evaluate(
          (element, point) => {
            // Firefox has no native touch input. Exercise the same pointer handlers.
            const capture = element.setPointerCapture;
            element.setPointerCapture = () => {};
            element.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                clientX: point.x,
                clientY: point.y,
              }),
            );
            element.setPointerCapture = capture;
          },
          { x: x + dx, y },
        );
      }
      await page.clock.runFor(240);
      const face = await note.boundingBox();
      const tab = await underlay.boundingBox();
      if (!face || !tab) throw new Error('Missing swiped note or preview');
      // The tab must still tuck under the face, even on a note tall enough for its
      // old, independent press scale to expose the entire overlap.
      expect(tab.y).toBeLessThan(face.y + face.height - 8);
      expect(face.width).toBeLessThan(before.width - 2);
      expect(tab.x + tab.width / 2).toBeCloseTo(face.x + face.width / 2, 0);
      await testInfo.attach(`held-swipe-${dx}`, {
        body: await page.screenshot({ path: testInfo.outputPath(`held-swipe-${dx}.png`) }),
        contentType: 'image/png',
      });
    }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    else {
      await surface.dispatchEvent('pointercancel', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
      });
    }
    await page.clock.runFor(1000);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(note).toBeVisible();
    expect((await note.boundingBox())?.x).toBeCloseTo(before.x, 0);
  });

  test(`a dragged note keeps the underlay's inset outline in ${colorScheme} mode`, async ({
    page,
    isMobile,
  }, testInfo) => {
    await page.setViewportSize({ width: 420, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await signUp(page);
    await seedNotes(page, [
      { title: 'Drag bookmark', body: 'A preview tucked underneath. https://example.com' },
    ]);
    const note = card(page, 'Drag bookmark');
    const cell = page.locator('[data-note-cell]').filter({ has: note });
    const underlay = cell.locator('[data-link-underlay]');
    await expect(underlay).toBeVisible();
    const before = await settledBox(note);
    const from = { x: before.x + before.width / 2, y: before.y + 30 };
    const to = { x: from.x + 60, y: from.y + 100 };
    const cdp = isMobile ? await page.context().newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      await page.waitForTimeout(400);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
    }
    await expect
      .poll(async () => (await note.boundingBox())?.x ?? 0)
      .toBeGreaterThan(before.x + 40);
    const face = await settledBox(note);
    const tab = await underlay.boundingBox();
    if (!tab) throw new Error('Missing dragged preview');
    expect(tab.y).toBeLessThan(face.y + face.height - 8);
    expect(tab.x).toBeGreaterThan(face.x + 6);
    // A shadow on the containing rectangle fills out the strip's transparent sides.
    await expect(cell).toHaveCSS('box-shadow', 'none');
    await testInfo.attach('lifted-underlay', {
      body: await page.screenshot({ path: testInfo.outputPath('lifted-underlay.png') }),
      contentType: 'image/png',
    });
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(note).toBeVisible();
    await settledBox(note);
  });
}
