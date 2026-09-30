import { z } from 'zod';

// Release metadata supplies this explicitly; development and debug stay stable by default.
export function buildChannel(input: unknown) {
  return z.enum(['stable', 'preview']).default('stable').parse(input);
}
