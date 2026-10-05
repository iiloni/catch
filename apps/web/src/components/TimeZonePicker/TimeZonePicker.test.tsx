import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeZonePicker } from './TimeZonePicker';

const at = new Date('2026-01-15T12:00:00Z');
const zone = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLButtonElement>(`[data-zone="${name}"]`);

describe('TimeZonePicker', () => {
  it('lists zones with their offsets and marks the chosen one', () => {
    const onChange = vi.fn();
    const { container } = render(<TimeZonePicker value="Asia/Tokyo" at={at} onChange={onChange} />);
    expect(zone(container, 'Asia/Tokyo')).toHaveAttribute('aria-pressed', 'true');
    expect(zone(container, 'Asia/Tokyo')).toHaveTextContent('GMT+9');
    expect(zone(container, 'America/New_York')).toHaveTextContent('America/New York');
    expect(zone(container, 'America/New_York')).toHaveTextContent('GMT-5');
    expect(zone(container, 'UTC')).toBeInTheDocument();
    fireEvent.click(zone(container, 'America/New_York') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('America/New_York');
  });

  it('gives a zone the offset it has at that moment', () => {
    const { container } = render(
      <TimeZonePicker
        value="Asia/Tokyo"
        at={new Date('2026-07-15T12:00:00Z')}
        onChange={vi.fn()}
      />,
    );
    expect(zone(container, 'America/New_York')).toHaveTextContent('GMT-4');
  });

  it('narrows the list by name or offset, and Enter takes the first match', () => {
    const onChange = vi.fn();
    const { container } = render(<TimeZonePicker value="Asia/Tokyo" at={at} onChange={onChange} />);
    const search = screen.getByRole('searchbox', { name: 'Search time zones' });
    fireEvent.change(search, { target: { value: 'new york' } });
    expect(container.querySelectorAll('[data-zone]')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('America/New_York');

    fireEvent.change(search, { target: { value: 'gmt+9' } });
    expect(zone(container, 'Asia/Tokyo')).toBeInTheDocument();
    expect(zone(container, 'America/New_York')).toBeNull();

    fireEvent.change(search, { target: { value: 'nowhere at all' } });
    expect(screen.getByText('No time zone matches.')).toBeInTheDocument();
  });

  it('keeps a chosen zone the device does not list', () => {
    const { container } = render(
      <TimeZonePicker value="Mars/Olympus" at={at} onChange={vi.fn()} />,
    );
    expect(zone(container, 'Mars/Olympus')).toHaveAttribute('aria-pressed', 'true');
  });
});
