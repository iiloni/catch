import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';

/**
 * The policy for the web app's pages. Scripts come from the app's own files; the few inline
 * ones in its HTML are allowed by hash, so an injected one does not run. The app keeps its
 * session token where scripts can read it, which is what this protects.
 */
export function appContentSecurityPolicy(indexHtml: string) {
  const inline = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1] ?? ''))
    .map(
      (match) =>
        `'sha256-${createHash('sha256')
          .update(match[2] ?? '')
          .digest('base64')}'`,
    );
  return [
    "default-src 'self'",
    // The device database is SQLite compiled to WebAssembly.
    `script-src ${["'self'", "'wasm-unsafe-eval'", ...inline].join(' ')}`,
    // The editor and UI libraries add style elements of their own.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // The bundle carries that WebAssembly as a data URL, which it fetches.
    "connect-src 'self' data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** API responses are data: opened as a page, one loads and runs nothing. */
const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * Headers for every response. A route that set one of its own keeps it (attachments are
 * served under a stricter sandbox). `app` is the policy for everything outside `/api`.
 */
export function securityHeaders({ app, https }: { app: string | null; https: boolean }) {
  return createMiddleware(async (c, next) => {
    await next();
    const policy = c.req.path.startsWith('/api/') ? API_POLICY : app;
    const headers: Record<string, string | null> = {
      'content-security-policy': policy,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      'x-robots-tag': /^\/(?:s|api\/shares)\//.test(c.req.path) ? 'noindex' : null,
      // Browsers ignore this over plain HTTP, but a proxy in front may not be the one adding it.
      'strict-transport-security': https ? 'max-age=31536000' : null,
    };
    for (const [name, value] of Object.entries(headers)) {
      if (value && !c.res.headers.has(name)) c.header(name, value);
    }
  });
}
