import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySnoozeMinutes,
  onSnoozeChange,
  SNOOZE_KEY,
  setSnoozeMinutes,
  snoozeMinutes,
  snoozeUntil,
  useSnoozeMinutes,
} from './snooze';

afterEach(() => {
  setSnoozeMinutes(30);
  localStorage.clear();
});

describe('snooze', () => {
  it('puts a reminder off for half an hour until set otherwise', () => {
    expect(snoozeMinutes()).toBe(30);
    expect(snoozeUntil(0)).toEqual(new Date(30 * 60_000));
  });

  it('keeps the chosen length and tells whoever follows it where it came from', () => {
    const heard = vi.fn();
    const stop = onSnoozeChange(heard);
    const { result } = renderHook(() => useSnoozeMinutes());
    act(() => result.current[1](60));
    expect(result.current[0]).toBe(60);
    expect(snoozeUntil(0)).toEqual(new Date(60 * 60_000));
    expect(localStorage.getItem(SNOOZE_KEY)).toBe('60');
    expect(heard).toHaveBeenLastCalledWith(60, 'device');

    // The server's length is taken without being a change to send back.
    act(() => applySnoozeMinutes(15));
    expect(result.current[0]).toBe(15);
    expect(heard).toHaveBeenLastCalledWith(15, 'server');
    act(() => applySnoozeMinutes(15));
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    act(() => result.current[1](60));
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
