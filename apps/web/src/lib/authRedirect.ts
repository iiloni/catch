import { z } from 'zod';

export const authRedirectSearchSchema = z.object({
  // A return destination must stay on this origin, including after browser URL normalization.
  redirect: z
    .string()
    .regex(/^\/(?!\/)[^\s\\]*$/)
    .optional()
    .catch(undefined),
});

/** Carry fragment-only capture data through full auth/setup reloads without logging it. */
export function authReturnTo(destination: string | undefined, fragment: string): string {
  const path = destination ?? '/';
  return destination && !path.includes('#') && fragment.startsWith('#') ? path + fragment : path;
}
