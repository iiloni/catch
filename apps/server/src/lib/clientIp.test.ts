import { describe, expect, it } from 'vitest';
import { clientIp, isProxyRange, proxyList } from './clientIp';

describe('clientIp', () => {
  const none = proxyList([]);
  const proxies = proxyList(['172.16.0.0/12', '10.0.0.5', 'fd00::/8']);

  it('ignores X-Forwarded-For from a connection that is not a trusted proxy', () => {
    expect(clientIp('203.0.113.7', '198.51.100.1', none)).toBe('203.0.113.7');
    expect(clientIp('203.0.113.7', '198.51.100.1', proxies)).toBe('203.0.113.7');
    expect(clientIp('::ffff:203.0.113.7', undefined, none)).toBe('203.0.113.7');
  });

  it('takes the nearest untrusted hop behind trusted proxies', () => {
    expect(clientIp('172.18.0.1', '198.51.100.1', proxies)).toBe('198.51.100.1');
    // The leftmost entry is whatever the client sent.
    expect(clientIp('::ffff:172.18.0.1', '1.2.3.4, 198.51.100.1, 10.0.0.5', proxies)).toBe(
      '198.51.100.1',
    );
    expect(clientIp('fd00::2', '2001:db8::9', proxies)).toBe('2001:db8::9');
  });

  it('finds no address when the chain has none to trust', () => {
    expect(clientIp(undefined, '198.51.100.1', proxies)).toBeNull();
    expect(clientIp('172.18.0.1', undefined, proxies)).toBeNull();
    expect(clientIp('172.18.0.1', '10.0.0.5', proxies)).toBeNull();
    expect(clientIp('172.18.0.1', 'not-an-address', proxies)).toBeNull();
  });

  it('accepts addresses and CIDR ranges as proxies', () => {
    for (const entry of ['10.0.0.5', '172.16.0.0/12', '::1', 'fd00::/8']) {
      expect(isProxyRange(entry), entry).toBe(true);
    }
    for (const entry of ['proxy.local', '10.0.0.0/33', '10.0.0.0/', '::1/129', '10.0.0.0/8/8']) {
      expect(isProxyRange(entry), entry).toBe(false);
    }
  });
});
