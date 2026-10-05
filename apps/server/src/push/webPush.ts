import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';

/**
 * Web Push, as browsers' push services take it: a message encrypted to the subscribing
 * browser's keys (RFC 8291, `aes128gcm`) and a signed token that identifies this server
 * (VAPID, RFC 8292). The push service relays bytes it cannot read.
 */

/** An ECDSA P-256 key pair, base64url: the public point uncompressed, the private scalar. */
export type VapidKeys = { publicKey: string; privateKey: string };

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const CURVE = 'prime256v1';
const RECORD_SIZE = 4096;
/** Push services take about 4 KB; this leaves room for the header and padding. */
export const MAX_PUSH_PAYLOAD = 3000;

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  // A scalar with leading zero bytes comes back short; JWK wants all 32.
  const scalar = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(scalar, 32 - raw.length);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: scalar.toString('base64url'),
  };
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The `Authorization` header that tells a push service which server is sending. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = new Date(),
) {
  const point = Buffer.from(keys.publicKey, 'base64url');
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
    },
  });
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    // Push services refuse tokens that live longer than a day.
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

const hkdf = (salt: Buffer, key: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync('sha256', key, salt, info, length));

/** Encrypts a message for one subscription, as a single `aes128gcm` record. */
export function encryptPush(payload: Buffer, target: Pick<PushTarget, 'p256dh' | 'auth'>) {
  if (payload.length > MAX_PUSH_PAYLOAD) throw new Error('Push message too large');
  const receiver = Buffer.from(target.p256dh, 'base64url');
  const authSecret = Buffer.from(target.auth, 'base64url');
  const sender = createECDH(CURVE);
  const senderPublic = sender.generateKeys();
  const shared = sender.computeSecret(receiver);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiver, senderPublic]);
  const material = hkdf(authSecret, shared, keyInfo, 32);
  const salt = randomBytes(16);
  const contentKey = hkdf(salt, material, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, material, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  // 0x02 ends the last (here, only) record.
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, sealed]);
}

/**
 * The push services browsers use. A subscription's endpoint comes from the client and is a
 * URL this server then posts to, so anywhere else is refused (as `safeFetch` refuses private
 * addresses for link previews).
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
];

export function isPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  return PUSH_HOSTS.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  );
}

/** How long a push service holds a message for a device that is off or out of reach. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Sends one message. Returns `gone` when the push service says the subscription no longer
 * exists (the browser dropped it), and throws when the message could not be handed over.
 */
export async function sendPush(
  target: PushTarget,
  payload: Buffer,
  keys: VapidKeys,
  subject: string,
): Promise<'sent' | 'gone'> {
  if (!isPushEndpoint(target.endpoint)) return 'gone';
  const response = await fetch(target.endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: vapidAuthorization(target.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(TTL_SECONDS),
      // A reminder is for now: wake a dozing phone rather than wait for it.
      Urgency: 'high',
    },
    body: new Uint8Array(encryptPush(payload, target)),
  });
  // Unread, a body holds its connection open.
  await response.body?.cancel().catch(() => {});
  if (response.status === 404 || response.status === 410) return 'gone';
  if (!response.ok) throw new Error(`Push service answered ${response.status}`);
  return 'sent';
}
