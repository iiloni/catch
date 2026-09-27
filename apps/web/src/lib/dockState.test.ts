import { describe, expect, it } from 'vitest';
import { tabFor } from './dockState';

describe('tabFor', () => {
  it('files Archive and Trash under the Gallery tab', () => {
    expect(tabFor('/')).toBe('/');
    expect(tabFor('/archive')).toBe('/');
    expect(tabFor('/trash')).toBe('/');
    expect(tabFor('/deck')).toBe('/deck');
    expect(tabFor('/search')).toBe('/search');
  });
});
