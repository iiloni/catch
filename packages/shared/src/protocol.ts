import { z } from 'zod';

/** Change only for incompatible API/sync contracts; see docs/decisions/0013-api-compatibility.md. */
export const API_PROTOCOL_VERSION = 5;
export const API_PROTOCOL_HEADER = 'X-Catch-Protocol';

export const protocolRangeSchema = z
  .object({ min: z.number().int().positive(), max: z.number().int().positive() })
  .refine(({ min, max }) => min <= max, 'Invalid protocol range');
export type ProtocolRange = z.infer<typeof protocolRangeSchema>;

// Protocols 3 and 4 added reminders (ADR 0018) and shared notes (ADR 0021), and changed
// nothing a protocol 2 client uses. Protocol 5 adds explicit card preview choices;
// older requests retain their format and leave those choices alone.
export const SUPPORTED_API_PROTOCOLS: ProtocolRange = { min: 2, max: API_PROTOCOL_VERSION };

export type CompatibilityIssue = 'client-too-old' | 'server-too-old';
export function protocolCompatibility(
  version: number,
  range: ProtocolRange,
): CompatibilityIssue | null {
  if (version < range.min) return 'client-too-old';
  if (version > range.max) return 'server-too-old';
  return null;
}

export const protocolErrorSchema = z.object({
  code: z.literal('INCOMPATIBLE_PROTOCOL'),
  error: z.string(),
  protocol: protocolRangeSchema,
});
export type ProtocolError = z.infer<typeof protocolErrorSchema>;
