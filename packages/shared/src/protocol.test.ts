import { describe, expect, it } from 'vitest';
import {
  API_PROTOCOL_VERSION,
  protocolCompatibility,
  protocolRangeSchema,
  SUPPORTED_API_PROTOCOLS,
} from './protocol';

describe('API protocol compatibility', () => {
  it('accepts the current client and validates the advertised range', () => {
    expect(protocolRangeSchema.parse(SUPPORTED_API_PROTOCOLS)).toEqual(SUPPORTED_API_PROTOCOLS);
    expect(protocolCompatibility(API_PROTOCOL_VERSION, SUPPORTED_API_PROTOCOLS)).toBeNull();
  });
  it('accepts both ends of a supported range and identifies which side needs updating', () => {
    const range = { min: 2, max: 4 };
    expect(protocolCompatibility(2, range)).toBeNull();
    expect(protocolCompatibility(4, range)).toBeNull();
    expect(protocolCompatibility(1, range)).toBe('client-too-old');
    expect(protocolCompatibility(5, range)).toBe('server-too-old');
  });
  it.each([
    { min: 0, max: 1 },
    { min: 2, max: 1 },
    { min: 1, max: 1.5 },
  ])('rejects invalid ranges %j', (range) => {
    expect(protocolRangeSchema.safeParse(range).success).toBe(false);
  });
});
