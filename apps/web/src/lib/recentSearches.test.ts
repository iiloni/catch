import { beforeEach, expect, it } from 'vitest';
import {
  legacyRecentSearches,
  recentSearchesSchema,
  recentSearchKey,
  rememberSearch,
} from './recentSearches';

beforeEach(() => localStorage.clear());
it('retains separate AI and text searches, moves duplicates first and caps the history', () => {
  let recent = rememberSearch([], ' cycling ', true);
  recent = rememberSearch(recent, 'cycling', false);
  expect(recent).toEqual([
    { query: 'cycling', ai: false },
    { query: 'cycling', ai: true },
  ]);
  recent = rememberSearch(recent, 'cycling', true);
  expect(recent).toEqual([
    { query: 'cycling', ai: true },
    { query: 'cycling', ai: false },
  ]);
  for (let i = 0; i < 10; i++) recent = rememberSearch(recent, String(i), false);
  expect(recent).toHaveLength(8);
  expect(recent[0]!.query).toBe('9');
});
it('reads old string entries as text-only and preserves new mode records', () => {
  expect(recentSearchesSchema.parse(['old', { query: 'new', ai: true }])).toEqual([
    { query: 'old', ai: false },
    { query: 'new', ai: true },
  ]);
});
it('does not assign unowned legacy history to one of several accounts or replay it as AI', () => {
  localStorage.setItem(
    'catch-recent-searches',
    JSON.stringify(['old', { query: 'unknown owner', ai: true }]),
  );
  expect(legacyRecentSearches('ada', false)).toBeNull();
  expect(legacyRecentSearches('ada', true)).toEqual([
    { query: 'old', ai: false },
    { query: 'unknown owner', ai: false },
  ]);
  localStorage.setItem(recentSearchKey('ada'), JSON.stringify([{ query: 'mine', ai: true }]));
  expect(legacyRecentSearches('ada', true)).toBeNull();
  expect(recentSearchKey('ada')).not.toBe(recentSearchKey('eve'));
});
