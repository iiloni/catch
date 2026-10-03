import { BlockList, isIP } from 'node:net';

/**
 * The header Better Auth reads the client's address from, for its sign-in rate limit. The
 * server sets it itself from the connection: a header the client sends (X-Forwarded-For)
 * would let each request pick its own rate-limit bucket.
 */
export const CLIENT_IP_HEADER = 'x-catch-client-ip';

function parseRange(entry: string): { address: string; prefix: number; family: 4 | 6 } | null {
  const [address = '', bits, extra] = entry.split('/');
  const family = isIP(address);
  if ((family !== 4 && family !== 6) || extra !== undefined) return null;
  const width = family === 4 ? 32 : 128;
  if (bits === undefined) return { address, prefix: width, family };
  if (!/^\d{1,3}$/.test(bits) || Number(bits) > width) return null;
  return { address, prefix: Number(bits), family };
}

export const isProxyRange = (entry: string) => parseRange(entry) !== null;

export function proxyList(entries: readonly string[]) {
  const proxies = new BlockList();
  for (const entry of entries) {
    const range = parseRange(entry);
    if (range) proxies.addSubnet(range.address, range.prefix, range.family === 4 ? 'ipv4' : 'ipv6');
  }
  return proxies;
}

/** An address as `BlockList` takes it. Node reports IPv4 peers on a dual-stack socket as IPv6. */
function parseAddress(value: string): { address: string; family: 'ipv4' | 'ipv6' } | null {
  const address = value.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const family = isIP(address);
  if (family === 4) return { address, family: 'ipv4' };
  return family === 6 ? { address, family: 'ipv6' } : null;
}

/**
 * The address a request came from: the connection's peer, or when that is one of the
 * trusted proxies, the nearest hop in X-Forwarded-For that is not. Null when there is no
 * address to trust.
 */
export function clientIp(
  peer: string | undefined,
  forwardedFor: string | undefined,
  proxies: BlockList,
): string | null {
  const direct = peer ? parseAddress(peer) : null;
  if (!direct) return null;
  if (!proxies.check(direct.address, direct.family)) return direct.address;
  const hops = (forwardedFor ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  for (const hop of hops.reverse()) {
    const parsed = parseAddress(hop);
    if (!parsed) return null;
    if (!proxies.check(parsed.address, parsed.family)) return parsed.address;
  }
  return null;
}
