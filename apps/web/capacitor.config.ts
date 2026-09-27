import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.iloni.catchnotes',
  appName: 'Catch',
  webDir: 'dist',
  plugins: {
    SystemBars: {
      // The app draws edge to edge (index.html sets viewport-fit=cover) and pads itself with
      // the injected --safe-area-inset-* variables, which stay correct on older WebViews.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
