import path from 'node:path';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // Plain files for a static host (ADR 0020); there is no server to run.
  output: 'export',
  // A page is a directory with an index.html, which any static host serves without rewrites.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The repository's AGENTS.md covers the site.
  agentRules: false,
  // `pnpm typecheck` checks types with the workspace's compiler.
  typescript: { ignoreBuildErrors: true },
  // Brand artwork and tokens are read from the repository root.
  turbopack: { root: path.join(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  allowedDevOrigins: (process.env.SITE_DEV_ORIGINS ?? '').split(',').filter(Boolean),
};

export default withMDX(config);
