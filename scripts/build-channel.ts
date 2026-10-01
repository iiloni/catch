import { z } from 'zod';

// Release metadata names stable or preview explicitly. Every other build is dev, which is
// never distributed.
export function buildChannel(input: unknown) {
  return z.enum(['stable', 'preview', 'dev']).default('dev').parse(input);
}
