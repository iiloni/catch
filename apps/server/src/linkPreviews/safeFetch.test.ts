import { describe, expect, it } from 'vitest';
import { FetchError, isBlockedAddress, safeFetch } from './safeFetch';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.1.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'not an ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('safeFetch', () => {
  it('refuses private addresses and other schemes before connecting', async () => {
    const options = { maxBytes: 1024, accept: [''] };
    await expect(safeFetch('http://127.0.0.1:1/', options)).rejects.toThrow(FetchError);
    await expect(safeFetch('http://[::1]/', options)).rejects.toThrow(FetchError);
    await expect(safeFetch('http://user:pw@example.com/', options)).rejects.toThrow(FetchError);
    await expect(safeFetch('file:///etc/passwd', options)).rejects.toThrow(FetchError);
  });

  it('refuses hostnames that resolve to private addresses', async () => {
    await expect(
      safeFetch('http://localhost:1/', { maxBytes: 1024, accept: [''] }),
    ).rejects.toThrow(/private address/);
  });
});
