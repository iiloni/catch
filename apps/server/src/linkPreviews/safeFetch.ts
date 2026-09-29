import { type LookupAddress, lookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/**
 * Fetching pages for link previews on behalf of users. Anyone who can write a note can
 * make the server request a URL, so every request (and every redirect) must resolve to a
 * public address, and bodies and time are capped. The address is checked in the socket's
 * own DNS lookup, so a hostname cannot resolve to a public address for the check and a
 * private one for the connection.
 */

export class FetchError extends Error {}

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // NAT64 and 6to4 embed IPv4 addresses, which could be private ones.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** Whether an IP address is one the server must not fetch from: private, local or reserved. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4');
  // IPv4-mapped addresses written in hex (::ffff:7f00:1).
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hexMapped?.[1] && hexMapped[2]) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return blocked.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, 'ipv4');
  }
  return blocked.check(address, 'ipv6');
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** `dns.lookup` that only answers with public addresses. */
function publicLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const allowed = addresses.filter((entry) => !isBlockedAddress(entry.address));
    if (allowed.length === 0) {
      return callback(new FetchError(`${hostname} resolves to a private address`), []);
    }
    if (options.all) return callback(null, allowed);
    const [first] = allowed;
    return callback(null, first?.address ?? '', first?.family);
  });
}

export type FetchedResponse = {
  /** The URL after redirects. */
  url: string;
  contentType: string;
  body: Buffer;
};

type Options = {
  /** Largest body to read, after decompression. Longer bodies are cut off. */
  maxBytes: number;
  /** MIME type prefixes to accept, such as `text/html` or `image/`. */
  accept: readonly string[];
  /** Time for the whole request, redirects included. */
  timeoutMs?: number;
  /** Stop at `maxBytes` instead of failing: a page's head is enough for a preview. */
  truncate?: boolean;
};

const MAX_REDIRECTS = 5;
const USER_AGENT =
  'Mozilla/5.0 (compatible; CatchLinkPreview/1.0; +https://github.com/iiloni/catch)';

function assertFetchable(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError(`Unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password) throw new FetchError('URLs with credentials are not fetched');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // IP literals skip the DNS lookup, so check them here.
  if (isIP(host) && isBlockedAddress(host)) throw new FetchError(`${host} is a private address`);
}

function request(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      {
        signal,
        lookup: publicLookup as never,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*;q=0.9,*/*;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en;q=0.9, *;q=0.5',
        },
      },
      resolve,
    );
    req.on('error', reject);
  });
}

function decoded(response: IncomingMessage) {
  switch (response.headers['content-encoding']?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

async function readBody(response: IncomingMessage, maxBytes: number, truncate: boolean) {
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = decoded(response);
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      chunks.push(buffer);
      size += buffer.length;
      if (size >= maxBytes) {
        if (!truncate) throw new FetchError('Response too large');
        break;
      }
    }
  } finally {
    response.destroy();
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

/** GETs a public URL, following redirects, within the given limits. */
export async function safeFetch(input: string, options: Options): Promise<FetchedResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let url = new URL(input);
  for (let redirects = 0; ; redirects += 1) {
    assertFetchable(url);
    const response = await request(url, signal);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.resume();
      if (redirects >= MAX_REDIRECTS) throw new FetchError('Too many redirects');
      url = new URL(location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new FetchError(`HTTP ${status}`);
    }
    const contentType = (response.headers['content-type'] ?? '').toLowerCase();
    const mime = contentType.split(';')[0]?.trim() ?? '';
    if (!options.accept.some((prefix) => mime.startsWith(prefix))) {
      response.resume();
      throw new FetchError(`Unexpected content type ${mime || 'none'}`);
    }
    const length = Number(response.headers['content-length']);
    if (!options.truncate && length > options.maxBytes) {
      response.resume();
      throw new FetchError('Response too large');
    }
    const body = await readBody(response, options.maxBytes, options.truncate ?? false);
    return { url: url.href, contentType, body };
  }
}
