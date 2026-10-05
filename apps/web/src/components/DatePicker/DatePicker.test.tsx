import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

const day = (container: HTMLElement, date: string) =>
  container.querySelector<HTMLButtonElement>(`[data-date="${date}"]`);

describe('DatePicker', () => {
  it('opens on the chosen date’s month and chooses a day with one tap', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DatePicker value="2026-10-20" today="2026-10-05" onChange={onChange} />,
    );
    expect(day(container, '2026-10-20')).toHaveAttribute('aria-pressed', 'true');
    expect(day(container, '2026-10-05')).toHaveAttribute('aria-current', 'date');
    expect(container.querySelectorAll('[data-date]')).toHaveLength(31);
    // October 2026 starts on a Thursday.
    expect(day(container, '2026-10-01')).toHaveStyle({ gridColumnStart: '5' });
    fireEvent.click(day(container, '2026-10-23') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('2026-10-23');
  });

  it('turns to the months beside it, across a year', () => {
    const { container } = render(
      <DatePicker value="2026-12-10" today="2026-10-05" onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(day(container, '2027-01-31')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(day(container, '2026-11-30')).not.toBeNull();
    expect(day(container, '2026-11-31')).toBeNull();
  });

  it('does not offer days before the first one allowed', () => {
    const { container } = render(
      <DatePicker value="2026-10-20" min="2026-10-05" today="2026-10-05" onChange={vi.fn()} />,
    );
    expect(day(container, '2026-10-04')).toBeDisabled();
    expect(day(container, '2026-10-05')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });
});
