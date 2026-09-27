import { describe, expect, it } from 'vitest';
import { columnsFor } from './NoteGrid';

describe('columnsFor', () => {
  it('uses two columns on phones and more as space allows', () => {
    expect(columnsFor(260)).toBe(1);
    expect(columnsFor(366)).toBe(2);
    expect(columnsFor(768)).toBe(3);
    expect(columnsFor(1232)).toBe(5);
  });
});
