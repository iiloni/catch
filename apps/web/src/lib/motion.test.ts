import { motionValue } from 'motion/react';
import { describe, expect, it } from 'vitest';
import { animateSteady, EASE_EMPHASIZED } from './motion';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function block(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until);
}

describe('animateSteady', () => {
  it('runs the value to its target', async () => {
    const value = motionValue(0);
    await animateSteady(value, 1, { duration: 0.05, ease: EASE_EMPHASIZED });
    expect(value.get()).toBe(1);
  });

  it('carries on from where it was after a frame is held up', async () => {
    const value = motionValue(0);
    void animateSteady(value, 1, { duration: 1, ease: EASE_EMPHASIZED });
    await nextFrame();
    // By the clock the curve is nearly over after this; by frames it has barely begun.
    block(600);
    await nextFrame();
    expect(value.get()).toBeGreaterThan(0);
    expect(value.get()).toBeLessThan(0.5);
    await animateSteady(value, 0, { duration: 0, ease: EASE_EMPHASIZED });
  });

  it('gives the value up to the animation that follows', async () => {
    const value = motionValue(0);
    let finished = false;
    void animateSteady(value, 1, { duration: 0.2, ease: EASE_EMPHASIZED }).then(() => {
      finished = true;
    });
    await nextFrame();
    await animateSteady(value, 0, { duration: 0.05, ease: EASE_EMPHASIZED });
    expect(value.get()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(value.get()).toBe(0);
    expect(finished).toBe(false);
  });
});
