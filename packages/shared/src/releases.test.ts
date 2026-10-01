import { describe, expect, it } from 'vitest';
import { androidUpdateAvailable, compareReleaseVersions, parseReleaseVersion } from './releases';

describe('Android release selection', () => {
  it.each([
    ['1.9.0', '1.10.0', true],
    ['1.10.0', '1.9.0', false],
    ['1.0.0', '2.0.0', true],
    ['2.0.0', '2.0.0', false],
    ['1.2.3-preview', '1.2.4-preview', true],
    ['1.2.3-preview', '1.2.4', false],
    ['1.2.3', '1.2.4-preview', false],
    ['0.0.0-dev', '1.0.0', false],
  ])('selects %s → %s only forwards within a channel', (installed, target, expected) => {
    expect(
      androidUpdateAvailable(
        { version: installed, channel: parseReleaseVersion(installed)?.channel ?? 'dev' },
        { version: target, channel: parseReleaseVersion(target)?.channel ?? 'dev' },
      ),
    ).toBe(expected);
  });

  it('rejects missing, malformed and inconsistent metadata', () => {
    const server = { version: '1.2.3', channel: 'stable' } as const;
    expect(androidUpdateAvailable(null, server)).toBe(false);
    expect(androidUpdateAvailable({ version: null, channel: 'stable' }, server)).toBe(false);
    expect(androidUpdateAvailable({ version: '1.2.2-preview', channel: 'stable' }, server)).toBe(
      false,
    );
    for (const version of ['v1.2.3', '01.2.3', '1.2.3-beta', '1.2.3\n', '../1.2.3']) {
      expect(parseReleaseVersion(version)).toBeNull();
    }
  });

  it('compares core versions numerically and stable after preview', () => {
    expect(compareReleaseVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareReleaseVersions('1.2.3', '1.2.3-preview')).toBe(1);
  });
});
