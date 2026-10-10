import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuWarmup } from './GpuWarmup';

describe('GpuWarmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws its samples a moment after the app starts, then removes them', () => {
    const { container } = render(<GpuWarmup />);
    expect(container).toBeEmptyDOMElement();

    act(() => vi.advanceTimersByTime(1200));
    const note = container.firstElementChild;
    expect(note).toHaveClass('opacity-[0.01]', 'pointer-events-none');
    expect(note).toHaveAttribute('aria-hidden', 'true');
    expect(note).toHaveAttribute('inert');
    expect(note?.querySelector('.note-preview-editor')).not.toBeNull();

    act(() => vi.advanceTimersByTime(250));
    expect(container.querySelector('.note-preview-editor')).toBeNull();
    expect(container.querySelector('.glass-thick')).not.toBeNull();

    act(() => vi.advanceTimersByTime(250));
    expect(container).toBeEmptyDOMElement();
  });

  it('gives a test or a screen reader nothing to find', () => {
    const { container } = render(<GpuWarmup />);
    act(() => vi.advanceTimersByTime(1200));
    expect(container.querySelector('[role], [aria-label], button, a')).toBeNull();
    act(() => vi.advanceTimersByTime(250));
    expect(container.querySelector('[role], [aria-label], button, a, [data-dock]')).toBeNull();
  });

  it('draws nothing over a note that is already open', () => {
    const { container } = render(<GpuWarmup skip />);
    act(() => vi.advanceTimersByTime(1500));
    expect(container).toBeEmptyDOMElement();
  });
});
