import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { listRatio, listWidthLimits } from '@/lib/splitView';
import { SplitHandle } from './SplitHandle';

const VIEWPORT = 1000;

beforeEach(() => {
  listRatio.set(0.4);
  localStorage.clear();
});

describe('SplitHandle', () => {
  it('reports the page share within its limits', () => {
    render(<SplitHandle listWidth={400} viewportWidth={VIEWPORT} />);
    const handle = screen.getByRole('separator', { name: 'Resize note' });
    expect(handle).toHaveAttribute('aria-valuenow', '40');
    expect(handle).toHaveAttribute('aria-valuemin', '28');
    expect(handle).toHaveAttribute('aria-valuemax', '64');
  });

  it('moves with the arrow keys and saves the split', () => {
    render(<SplitHandle listWidth={400} viewportWidth={VIEWPORT} />);
    const handle = screen.getByRole('separator', { name: 'Resize note' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(listRatio.get()).toBeCloseTo(0.432);
    expect(localStorage.getItem('catch-split')).toBe(String(listRatio.get()));
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(listRatio.get()).toBeCloseTo(0.528);
  });

  it('stops at the limits', () => {
    const { min, max } = listWidthLimits(VIEWPORT);
    render(<SplitHandle listWidth={400} viewportWidth={VIEWPORT} />);
    const handle = screen.getByRole('separator', { name: 'Resize note' });
    fireEvent.keyDown(handle, { key: 'End' });
    expect(listRatio.get()).toBe(max / VIEWPORT);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(listRatio.get()).toBe(min / VIEWPORT);
  });
});
