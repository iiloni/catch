import { describe, expect, it } from 'vitest';
import { pageTransition, quickNote, tabFor } from './dockState';

describe('tabFor', () => {
  it('files Archive and Trash under the Gallery tab', () => {
    expect(tabFor('/')).toBe('/');
    expect(tabFor('/archive')).toBe('/');
    expect(tabFor('/trash')).toBe('/');
    expect(tabFor('/deck')).toBe('/deck');
    expect(tabFor('/search')).toBe('/search');
  });
});

describe('pageTransition', () => {
  it('slides in tab order', () => {
    expect(pageTransition('/deck', '/')).toEqual(['forward']);
    expect(pageTransition('/', '/deck')).toEqual(['back']);
    expect(pageTransition('/', '/trash')).toEqual(['forward']);
    expect(pageTransition('/archive', '/')).toEqual(['back']);
  });

  it('slides into and out of search in tab order', () => {
    expect(pageTransition('/deck', '/search')).toEqual(['forward']);
    expect(pageTransition('/', '/search')).toEqual(['forward']);
    expect(pageTransition('/search', '/')).toEqual(['back']);
    expect(pageTransition('/search', '/deck')).toEqual(['back']);
  });

  it('slides Settings in from the right, and its pages past each other on narrow screens', () => {
    expect(pageTransition('/', '/settings/general')).toEqual(['forward']);
    expect(pageTransition('/settings/account', '/')).toEqual(['back']);
    window.innerWidth = 400;
    expect(pageTransition('/settings/general', '/settings/account')).toEqual(['forward']);
    expect(pageTransition('/settings/account', '/settings/general')).toEqual(['back']);
    window.innerWidth = 1024;
    expect(pageTransition('/settings/general', '/settings/account')).toBe(false);
  });

  it('leaves note opens, first loads and other pages alone', () => {
    expect(pageTransition('/', '/')).toBe(false);
    expect(pageTransition(undefined, '/')).toBe(false);
    expect(pageTransition('/login', '/')).toBe(false);
  });

  it('keeps still while the quick note is open', () => {
    quickNote.set('open');
    expect(pageTransition('/deck', '/')).toBe(false);
    quickNote.set('closed');
  });
});
