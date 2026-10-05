import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimePicker } from './TimePicker';

const cell = (container: HTMLElement, selector: string) =>
  container.querySelector(selector) as HTMLElement;

describe('TimePicker', () => {
  it('chooses the hour, then the minute, on a twelve hour clock', () => {
    const onChange = vi.fn();
    const { container } = render(<TimePicker value="13:05" hour12 onChange={onChange} />);
    expect(screen.getByRole('button', { name: /^Hour/ })).toHaveTextContent('1');
    expect(cell(container, '[data-hour="13"]')).toHaveAttribute('aria-pressed', 'true');
    expect(cell(container, '[data-period="PM"]')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(cell(container, '[data-hour="21"]'));
    expect(onChange).toHaveBeenLastCalledWith('21:05');
    // The face turns to the minutes once the hour is chosen.
    expect(screen.getByRole('group', { name: 'Minutes' })).toBeInTheDocument();
    fireEvent.click(cell(container, '[data-minute="45"]'));
    expect(onChange).toHaveBeenLastCalledWith('13:45');
    fireEvent.click(cell(container, '[data-period="AM"]'));
    expect(onChange).toHaveBeenLastCalledWith('01:05');
    // And back to the hours from the readout.
    fireEvent.click(screen.getByRole('button', { name: /^Hour/ }));
    expect(screen.getByRole('group', { name: 'Hours' })).toBeInTheDocument();
  });

  it('keeps noon and midnight on the right side of the day', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<TimePicker value="00:00" hour12 onChange={onChange} />);
    expect(cell(container, '[data-hour="0"]')).toHaveTextContent('12');
    fireEvent.click(cell(container, '[data-period="PM"]'));
    expect(onChange).toHaveBeenLastCalledWith('12:00');
    rerender(<TimePicker value="12:00" hour12 onChange={onChange} />);
    expect(cell(container, '[data-hour="12"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts the afternoon on an inner ring of a twenty-four hour clock', () => {
    const onChange = vi.fn();
    const { container } = render(<TimePicker value="08:30" hour12={false} onChange={onChange} />);
    expect(container.querySelectorAll('[data-hour]')).toHaveLength(24);
    expect(container.querySelector('[data-period]')).toBeNull();
    expect(cell(container, '[data-hour="0"]')).toHaveTextContent('00');
    fireEvent.click(cell(container, '[data-hour="17"]'));
    expect(onChange).toHaveBeenLastCalledWith('17:30');
  });

  it('follows a drag round the face to any minute', () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:00" hour12 onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Minute/ }));
    const face = screen.getByRole('group', { name: 'Minutes' }).firstElementChild as HTMLElement;
    face.getBoundingClientRect = () => new DOMRect(0, 0, 200, 200);
    // Straight to the right of the center is a quarter past; a little below it, 17.
    fireEvent.pointerDown(face, { button: 0, clientX: 180, clientY: 100 });
    expect(onChange).toHaveBeenLastCalledWith('09:15');
    fireEvent.pointerMove(face, { clientX: 178, clientY: 117 });
    expect(onChange).toHaveBeenLastCalledWith('09:17');
    fireEvent.pointerUp(face);
    fireEvent.pointerMove(face, { clientX: 100, clientY: 180 });
    expect(onChange).toHaveBeenLastCalledWith('09:17');
  });
});
