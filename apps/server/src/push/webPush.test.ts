import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encryptPush,
  generateVapidKeys,
  isPushEndpoint,
  sendPush,
  vapidAuthorization,
} from './webPush';

/** Decrypts as a browser would (RFC 8291), with the subscription's private key. */
function decrypt(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + keyLength);
  const sealed = body.subarray(21 + keyLength);
  const hkdf = (hkdfSalt: Buffer, key: Buffer, info: Buffer, length: number) =>
    Buffer.from(hkdfSync('sha256', key, hkdfSalt, info, length));
  const material = hkdf(
    auth,
    receiver.computeSecret(senderPublic),
    Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderPublic]),
    32,
  );
  const decipher = createDecipheriv(
    'aes-128-gcm',
    hkdf(salt, material, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    hkdf(salt, material, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  decipher.setAuthTag(sealed.subarray(-16));
  return Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
}

describe('web push', () => {
  it('encrypts a message only its subscription can read', () => {
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    const auth = Buffer.from('0123456789abcdef');
    const body = encryptPush(Buffer.from('Water the plants'), {
      p256dh: receiver.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    });
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.toString('latin1')).not.toContain('Water the plants');
    // The record ends with the delimiter that marks it as the last.
    expect(decrypt(body, receiver, auth).toString()).toBe('Water the plants\x02');
  });

  it('refuses a message too large for a push service', () => {
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    expect(() =>
      encryptPush(Buffer.alloc(4000), {
        p256dh: receiver.getPublicKey().toString('base64url'),
        auth: Buffer.alloc(16).toString('base64url'),
      }),
    ).toThrow('too large');
  });

  it('signs a token for the push service with the server key', () => {
    const keys = generateVapidKeys();
    expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65);
    expect(Buffer.from(keys.privateKey, 'base64url')).toHaveLength(32);
    const now = new Date('2026-10-05T09:00:00Z');
    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      'https://catch.example',
      now,
    );
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match?.[4]).toBe(keys.publicKey);
    const [, head, claims, signature] = match ?? [];
    expect(JSON.parse(Buffer.from(head ?? '', 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 60 * 60,
      sub: 'https://catch.example',
    });
    const point = Buffer.from(keys.publicKey, 'base64url');
    const publicKey = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      },
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature ?? '', 'base64url'),
      ),
    ).toBe(true);
  });

  it('only posts to browser push services', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-by3p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isPushEndpoint(endpoint)).toBe(true);
    }
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://localhost/push',
      'https://10.0.0.5/push',
      'https://evil.example/fcm.googleapis.com',
      'https://push.apple.com.evil.example/abc',
      'https://user@fcm.googleapis.com/abc',
      'not a url',
    ]) {
      expect(isPushEndpoint(endpoint)).toBe(false);
    }
  });
});

describe('sendPush', () => {
  afterEach(() => vi.unstubAllGlobals());

  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const target = (endpoint: string) => ({
    endpoint,
    p256dh: receiver.getPublicKey().toString('base64url'),
    auth: Buffer.alloc(16, 7).toString('base64url'),
  });
  const send = (endpoint: string) =>
    sendPush(target(endpoint), Buffer.from('{}'), generateVapidKeys(), 'mailto:me@example.com');
  const answer = (status: number) => {
    const fetch = vi.fn().mockResolvedValue(new Response(status === 201 ? null : 'no', { status }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('posts the encrypted message to the push service', async () => {
    const fetch = answer(201);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    expect(await send(endpoint)).toBe('sent');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers).toMatchObject({
      Authorization: expect.stringMatching(/^vapid t=.+, k=.+/),
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'high',
    });
  });

  it('never posts to an address that is not a push service', async () => {
    const fetch = answer(201);
    expect(await send('https://169.254.169.254/latest')).toBe('gone');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a subscription the push service has dropped', async () => {
    for (const status of [404, 410]) {
      answer(status);
      expect(await send('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe('gone');
    }
  });

  it('throws when the push service refuses the message', async () => {
    answer(403);
    await expect(send('https://web.push.apple.com/abc')).rejects.toThrow('403');
  });
});
