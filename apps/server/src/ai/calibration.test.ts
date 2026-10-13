import { expect, it, vi } from 'vitest';

vi.mock('../db/client', () => ({ db: {} }));
const { floorFrom } = await import('./calibration');

const noise = [0.15, 0.17, 0.18, 0.2, 0.2, 0.21, 0.22, 0.23, 0.25];

it('sets the floor above unrelated notes and below related ones', () => {
  // Each query finds two or three related notes among a library of unrelated ones.
  const samples = Array.from({ length: 8 }, () => [...noise, 0.45, 0.52, 0.6]);
  const floor = floorFrom(samples)!;
  expect(floor).toBeGreaterThan(0.25);
  expect(floor).toBeLessThan(0.45);
});

it('follows the model: one that scores everything higher gets a higher floor', () => {
  const low = floorFrom(Array.from({ length: 6 }, () => [...noise, 0.5]))!;
  const high = floorFrom(
    Array.from({ length: 6 }, () => [...noise, 0.5].map((score) => score + 0.4)),
  )!;
  expect(high - low).toBeCloseTo(0.4, 5);
});

it('ignores one unusual query, and measures nothing from too little', () => {
  const samples = Array.from({ length: 7 }, () => [...noise, 0.5]);
  const usual = floorFrom(samples)!;
  expect(floorFrom([...samples, noise.map(() => 0.99).concat(0.99)])).toBeCloseTo(usual, 5);
  expect(floorFrom(samples.slice(0, 4))).toBeNull();
  expect(floorFrom(Array.from({ length: 8 }, () => [0.2, 0.3, 0.5]))).toBeNull();
});
