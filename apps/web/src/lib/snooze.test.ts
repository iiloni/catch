import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSnoozeChange, SNOOZE_KEY, snoozeMinutes, snoozeUntil, useSnoozeMinutes } from './snooze';

afterEach(() => localStorage.clear());

describe('snooze', () => {
  it('puts a reminder off for half an hour unless set otherwise or holding a bad value', () => {
    expect(snoozeMinutes()).toBe(30);
    expect(snoozeUntil(0)).toEqual(new Date(30 * 60_000));
    localStorage.setItem(SNOOZE_KEY, '45');
    expect(snoozeMinutes()).toBe(30);
    localStorage.setItem(SNOOZE_KEY, 'nonsense');
    expect(snoozeMinutes()).toBe(30);
  });

  it('keeps the chosen length and tells whoever follows it', () => {
    const heard = vi.fn();
    const stop = onSnoozeChange(heard);
    const { result } = renderHook(() => useSnoozeMinutes());
    act(() => result.current[1](60));
    expect(result.current[0]).toBe(60);
    expect(snoozeUntil(0)).toEqual(new Date(60 * 60_000));
    expect(heard).toHaveBeenCalledWith(60);
    stop();
    act(() => result.current[1](15));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
