import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { appContentSecurityPolicy, securityHeaders } from './securityHeaders';

const inline = "document.documentElement.dataset.theme = 'dark';";
const html = `<html><head><script>${inline}</script><script type="module" src="/assets/a.js"></script></head></html>`;
const policy = appContentSecurityPolicy(html);

const app = new Hono()
  .use(securityHeaders({ app: policy, https: true }))
  .get('/api/health', (c) => c.json({ ok: true }))
  .get('/api/file', (c) => c.body('x', 200, { 'content-security-policy': 'sandbox' }))
  .get('*', (c) => c.html(html));

describe('security headers', () => {
  it('allows the page’s own inline scripts by hash and no others', () => {
    const hash = createHash('sha256').update(inline).digest('base64');
    expect(policy).toContain(`script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'`);
    expect(policy.match(/'sha256-/g)).toHaveLength(1);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('gives pages the app policy and API responses a closed one', async () => {
    const page = await app.request('/settings');
    expect(page.headers.get('content-security-policy')).toBe(policy);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('strict-transport-security')).toBe('max-age=31536000');
    const api = await app.request('/api/health');
    expect(api.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('leaves a header a route set itself', async () => {
    const res = await app.request('/api/file');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
  });

  it('keeps public share pages, metadata and files out of search indexes', async () => {
    for (const path of [
      '/s/token',
      '/api/shares/token',
      '/api/shares/token/attachments/id/content',
    ]) {
      expect((await app.request(path)).headers.get('x-robots-tag')).toBe('noindex');
    }
    expect((await app.request('/settings')).headers.has('x-robots-tag')).toBe(false);
  });
});
