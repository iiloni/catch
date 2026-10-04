import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClockPicker } from './ClockPicker';

describe('ClockPicker', () => {
  it('marks the current clock and picks another', () => {
    const onChange = vi.fn();
    render(<ClockPicker value="auto" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Automatic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Automatic' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '24 hour' }));
    expect(onChange).toHaveBeenCalledWith('24');
  });
});
