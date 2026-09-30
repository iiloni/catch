import { z } from 'zod';

export const authRedirectSearchSchema = z.object({
  // A return destination must stay on this origin, including after browser URL normalization.
  redirect: z
    .string()
    .regex(/^\/(?!\/)[^\s\\]*$/)
    .optional()
    .catch(undefined),
});
