import type { CapacitorConfig } from '@capacitor/cli';
import { buildChannel } from '../../scripts/build-channel.ts';
import { developmentServerUrl } from '../../scripts/dev-server.ts';

const channel = buildChannel(process.env.CATCH_CHANNEL);
const devServer = developmentServerUrl(channel, process.env.CATCH_DEV_SERVER_URL);
const httpDevServer = devServer.startsWith('http:');

const config: CapacitorConfig = {
  appId: 'org.iloni.catchnotes',
  appName: 'Catch',
  webDir: 'dist',
  android: { flavor: channel, allowMixedContent: httpDevServer },
  // The frontend stays bundled; only API requests go to the HTTP worktree server.
  server: { cleartext: httpDevServer },
  plugins: {
    SystemBars: {
      // KeyboardInsetsPlugin.java owns the insets instead: it keeps the WebView full size when
      // the keyboard opens (so the page can animate with it) and injects the safe-area variables.
      insetsHandling: 'disable',
    },
  },
};

export default config;
