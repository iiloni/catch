import {
  API_PROTOCOL_HEADER,
  type ProtocolError,
  protocolCompatibility,
  SUPPORTED_API_PROTOCOLS,
} from '@catch/shared';
import { createMiddleware } from 'hono/factory';

/** Byte downloads cannot declare a protocol through image, video or system-browser headers. */
function isExempt(method: string, path: string) {
  if (path.startsWith('/api/auth/')) return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return (
    ['/api/health', '/api/compatibility', '/api/updates', '/api/updates/releases'].includes(path) ||
    /^\/api\/attachments\/[^/]+\/content$/.test(path) ||
    /^\/api\/link-previews\/assets\/[^/]+$/.test(path) ||
    /^\/api\/admin\/backups\/[^/]+\/download$/.test(path)
  );
}

export const requireCompatibleProtocol = createMiddleware(async (c, next) => {
  if (isExempt(c.req.method, c.req.path)) return next();
  const header = c.req.header(API_PROTOCOL_HEADER) ?? '';
  const version = /^[1-9]\d*$/.test(header) ? Number(header) : NaN;
  if (
    !Number.isSafeInteger(version) ||
    protocolCompatibility(version, SUPPORTED_API_PROTOCOLS) !== null
  ) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        code: 'INCOMPATIBLE_PROTOCOL',
        error: 'This app and server use incompatible API protocols. Update the app or server.',
        protocol: SUPPORTED_API_PROTOCOLS,
      } satisfies ProtocolError,
      426,
    );
  }
  await next();
});
