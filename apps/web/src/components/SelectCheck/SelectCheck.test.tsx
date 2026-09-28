import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectCheck } from './SelectCheck';

describe('SelectCheck', () => {
  it('offers to start selecting when nothing is selected', () => {
    const onSelect = vi.fn();
    const onClick = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the card beneath
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the card beneath
      <div onClick={onClick}>
        <SelectCheck selected={undefined} onSelect={onSelect} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select note' }));
    expect(onSelect).toHaveBeenCalledOnce();
    // The card under the check must not open.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('steps aside while notes are being selected', () => {
    render(<SelectCheck selected={false} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Select note' })).toBeNull();
  });
});
