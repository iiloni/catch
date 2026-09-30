import { describe, expect, it } from 'vitest';
import { parseRange } from './files';

describe('media ranges', () => {
  it('supports bounded, open and suffix ranges', () => {
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 });
  });
  it('rejects malformed, multiple and out-of-bounds ranges', () => {
    for (const value of [
      'bytes=-',
      'bytes=-0',
      'bytes=3-1',
      'bytes=10-',
      'bytes=0-2,3-5',
      'bytes=NaN-',
      'bytes=99999999999999999-',
    ])
      expect(parseRange(value, 10)).toBeNull();
    expect(parseRange('bytes=0-', 0)).toBeNull();
  });
});
