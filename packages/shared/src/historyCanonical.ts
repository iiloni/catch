/** Identities ignore property insertion order, preserving arrays, strings and unknown fields. */
export function canonicalHistory(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(item).sort())
      sorted[key] = (item as Record<string, unknown>)[key];
    return sorted;
  });
}
