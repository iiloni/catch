import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SnoozePicker } from './SnoozePicker';

describe('SnoozePicker', () => {
  it('marks the current length and picks another', () => {
    const onChange = vi.fn();
    render(<SnoozePicker value={30} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '30 min' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '1 hr' }));
    expect(onChange).toHaveBeenCalledWith(60);
  });
});
