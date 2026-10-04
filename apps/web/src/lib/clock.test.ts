import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOCK_KEY, formatDateTime, formatTime, useHour12 } from './clock';

const at = new Date(2026, 9, 5, 13, 5);

afterEach(() => localStorage.clear());

describe('clock', () => {
  it('writes times on the chosen clock', () => {
    localStorage.setItem(CLOCK_KEY, JSON.stringify('24'));
    expect(formatTime(at)).toBe('13:05');
    expect(formatDateTime(at)).toContain('13:05');
    expect(renderHook(() => useHour12()).result.current).toBe(false);

    localStorage.setItem(CLOCK_KEY, JSON.stringify('12'));
    expect(formatTime(at)).toMatch(/^1:05\s?PM$/i);
    expect(renderHook(() => useHour12()).result.current).toBe(true);
  });

  it("follows the language's clock when left on automatic or holding a bad value", () => {
    const fromLanguage = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(at);
    expect(formatTime(at)).toBe(fromLanguage);
    localStorage.setItem(CLOCK_KEY, 'nonsense');
    expect(formatTime(at)).toBe(fromLanguage);
  });
});
