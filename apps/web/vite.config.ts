import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defaultAllowedOrigins } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import brandTokens from '../../branding/catch-brand-tokens.json' with { type: 'json' };
import { buildChannel } from '../../scripts/build-channel.ts';
import { developmentServerUrl } from '../../scripts/dev-server.ts';

const channel = buildChannel(process.env.CATCH_CHANNEL);
const iconBase = channel === 'stable' ? '' : `/${channel}`;

export default defineConfig({
  define: {
    'import.meta.env.CATCH_DEV_SERVER_URL': JSON.stringify(
      developmentServerUrl(channel, process.env.CATCH_DEV_SERVER_URL),
    ),
  },
  plugins: [
    {
      name: 'channel-icons',
      transformIndexHtml(html) {
        return html.replace(
          /href="\/(favicon\.ico|favicon-mark\.svg|apple-touch-icon\.png)"/g,
          `href="${iconBase}/$1"`,
        );
      },
    },
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Catch',
        short_name: 'Catch',
        description: 'Self-hosted notes that work offline.',
        theme_color: brandTokens.colors.amberPrimary.hex,
        background_color: '#f7f6f2',
        display: 'standalone',
        start_url: '/',
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: ['*/*'] }],
          },
        },
        icons: [
          { src: `${iconBase}/pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${iconBase}/pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${iconBase}/maskable-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
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
    // Vite answers preflights before the API proxy; native auth sends credentials.
    cors: { origin: [defaultAllowedOrigins, 'capacitor://localhost'], credentials: true },
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
