import { z } from 'zod';

export const recentSearchesSchema = z
  .array(
    z.union([
      z.string().transform((query) => ({ query, ai: false })),
      z.object({ query: z.string(), ai: z.boolean() }),
    ]),
  )
  .max(8);
export type RecentSearch = z.infer<typeof recentSearchesSchema>[number];
export const recentSearchKey = (userId: string) => `catch-recent-searches:${userId}`;

export function rememberSearch(recent: RecentSearch[], query: string, ai: boolean): RecentSearch[] {
  query = query.trim();
  return query
    ? [{ query, ai }, ...recent.filter((item) => item.query !== query || item.ai !== ai)].slice(
        0,
        8,
      )
    : recent;
}

/** Old unscoped searches have no account or mode; never replay them as AI queries. */
export function legacyRecentSearches(userId: string, soleAccount: boolean): RecentSearch[] | null {
  if (!soleAccount || localStorage.getItem(recentSearchKey(userId)) !== null) return null;
  try {
    const parsed = recentSearchesSchema.safeParse(
      JSON.parse(localStorage.getItem('catch-recent-searches') ?? 'null'),
    );
    return parsed.success ? parsed.data.map((item) => ({ query: item.query, ai: false })) : null;
  } catch {
    return null;
  }
}
