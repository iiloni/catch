import type { CapacitorConfig } from '@capacitor/cli';
import { buildChannel } from '../../scripts/build-channel.ts';

const config: CapacitorConfig = {
  appId: 'org.iloni.catchnotes',
  appName: 'Catch',
  webDir: 'dist',
  android: { flavor: buildChannel(process.env.CATCH_CHANNEL) },
  plugins: {
    SystemBars: {
      // KeyboardInsetsPlugin.java owns the insets instead: it keeps the WebView full size when
      // the keyboard opens (so the page can animate with it) and injects the safe-area variables.
      insetsHandling: 'disable',
    },
  },
};

export default config;
