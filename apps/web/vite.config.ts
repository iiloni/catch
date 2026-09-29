import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import brandTokens from '../../branding/catch-brand-tokens.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Catch',
        short_name: 'Catch',
        description: 'Self-hosted notes that work offline.',
        theme_color: brandTokens.colors.amberPrimary.hex,
        background_color: '#f7f6f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Preview thumbnails and icons are named by their hash and never change, so they
            // can be served from the cache, which keeps them showing offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/link-previews/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'link-preview-assets',
              expiration: { maxEntries: 1000 },
              // The Android app loads them from another origin, as opaque responses.
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // Its SQLite worker is a file next to it, found through `import.meta.url`; pre-bundling
    // would move the module away from it.
    exclude: ['@tanstack/browser-db-sqlite-persistence'],
  },
  server: {
    // Set by docker-compose.dev.yml so worktree stacks are reachable from the host
    // and over Tailscale.
    host: process.env.CATCH_DEV_HOST,
    allowedHosts: process.env.CATCH_DEV_ALLOWED_HOSTS?.split(','),
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Builds jsdom once per worker instead of once per file, which was most of the run.
    // Each file still gets a fresh module graph and globals.
    pool: 'vmThreads',
    // Worktree stacks often run together; keep test workers within host memory.
    maxWorkers: 2,
  },
});
