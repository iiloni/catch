import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/lib/longPress';
import { SETTINGS_TABS, type SettingsPath } from '@/lib/settings';
import { SettingsTabPicker, SettingsTabSelector, settingsTabAt } from './SettingsTabPicker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Lays the card out at x 0..300, y 100..200, with 50px rows. */
function mockLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const index = SETTINGS_TABS.findIndex(
      (tab) => tab.path === (this as HTMLElement).dataset.settingsTab,
    );
    const top = index < 0 ? 100 : 100 + index * 50;
    const bottom = index < 0 ? 200 : top + 50;
    return {
      left: 0,
      right: 300,
      top,
      bottom,
      width: 300,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => {},
    };
  });
}

/** The dock's selector with the picker above it, sharing their state as the dock does. */
function Harness({ onSelect }: { onSelect: (path: SettingsPath) => void }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<SettingsPath | null>(null);
  return (
    <div data-testid="dock">
      <SettingsTabPicker
        open={open}
        current={SETTINGS_TABS[0]}
        hovered={hovered}
        onSelect={onSelect}
      />
      <SettingsTabSelector
        current={SETTINGS_TABS[0]}
        open={open}
        onOpenChange={setOpen}
        onHover={setHovered}
        onSelect={onSelect}
        pickerRoot={() => screen.getByTestId('dock')}
      />
    </div>
  );
}

describe('settingsTabAt', () => {
  it('maps a point over the card to the nearest page', () => {
    const { container } = render(
      <SettingsTabPicker open current={null} hovered={null} onSelect={vi.fn()} />,
    );
    mockLayout();
    expect(settingsTabAt(container, 150, 110)).toBe('/settings/general');
    expect(settingsTabAt(container, 320, 190)).toBe('/settings/tags');
    // Just above the card still reaches the first page.
    expect(settingsTabAt(container, 150, 80)).toBe('/settings/general');
    // Back down on the dock, or off to the side, is no page.
    expect(settingsTabAt(container, 150, 260)).toBeNull();
    expect(settingsTabAt(container, 400, 150)).toBeNull();
  });

  it('finds nothing while the card is closed', () => {
    const { container } = render(
      <SettingsTabPicker open={false} current={null} hovered={null} onSelect={vi.fn()} />,
    );
    expect(settingsTabAt(container, 150, 150)).toBeNull();
  });
});

describe('SettingsTabSelector', () => {
  it('only offers the Admin section to admins', () => {
    const props = { open: true, current: null, hovered: null, onSelect: vi.fn() };
    const { rerender } = render(<SettingsTabPicker {...props} />);
    expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument();
    rerender(<SettingsTabPicker {...props} isAdmin />);
    expect(screen.getByRole('region', { name: 'Admin' })).toContainElement(
      screen.getByRole('button', { name: 'Users' }),
    );
  });
  it('names the open page and opens the picker on a tap', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const selector = screen.getByRole('button', { name: 'Settings page: General' });
    expect(selector).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(selector);
    expect(selector).toHaveAttribute('aria-expanded', 'true');
    const picker = screen.getByRole('navigation', { name: 'Settings pages' });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(onSelect).toHaveBeenCalledWith('/settings/account');
  });

  it('picks the page a held finger is let go on', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const selector = screen.getByRole('button', { name: 'Settings page: General' });

    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 150, clientY: 300 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(selector).toHaveAttribute('aria-expanded', 'true');

    mockLayout();
    fireEvent.pointerMove(selector, { pointerId: 1, clientX: 150, clientY: 170 });
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 150, clientY: 170 });
    expect(onSelect).toHaveBeenCalledWith('/settings/tags');
  });

  it('opens the picker when the finger slides off before the hold', () => {
    render(<Harness onSelect={vi.fn()} />);
    const selector = screen.getByRole('button', { name: 'Settings page: General' });
    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 150, clientY: 300 });
    fireEvent.pointerMove(selector, { pointerId: 1, clientX: 150, clientY: 260 });
    expect(selector).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves the picker open when let go away from it', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const selector = screen.getByRole('button', { name: 'Settings page: General' });
    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 150, clientY: 300 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    mockLayout();
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 150, clientY: 300 });
    // The click that ends the press is swallowed, so it does not fold the picker away.
    fireEvent.click(selector);
    expect(onSelect).not.toHaveBeenCalled();
    expect(selector).toHaveAttribute('aria-expanded', 'true');
  });
});
