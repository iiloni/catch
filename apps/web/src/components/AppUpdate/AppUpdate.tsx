import {
  RELEASES_URL,
  REPOSITORY_URL,
  type ReleasesResponse,
  releasesResponseSchema,
} from '@catch/shared';
import {
  CodeXml,
  Download,
  ExternalLink,
  type LucideIcon,
  RefreshCw,
  Server,
  Smartphone,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useSyncStatus } from '@/lib/syncStatus';
import {
  checkForUpdates,
  installServerVersion,
  useAndroidUpdateAvailable,
  useUpdates,
} from '@/lib/updates';

const channelLabels = { stable: 'Stable', preview: 'Preview', dev: 'Development' };

export function AppUpdate() {
  const { incompatibility } = useSyncStatus();
  const { android, app, server, checking, error, installing, installError } = useUpdates();
  const available = useAndroidUpdateAvailable();
  const channel = (android ? app?.channel : undefined) ?? server?.channel ?? 'dev';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 px-4 py-2 text-center">
        <BrandLockup orientation="stacked" iconSize={80} channel={channel} iconDetail="primary" />
        <p className="text-muted-foreground text-sm">Your notes, wherever you are.</p>
      </div>
      <SettingsSection title="Version">
        <SettingsRow
          icon={Server}
          label="Server version"
          description={server ? `${channelLabels[server.channel]} channel` : undefined}
        >
          <span className="text-sm">
            {server?.version ?? (server ? 'Development' : checking ? 'Checking…' : 'Unavailable')}
          </span>
        </SettingsRow>
        {android && (
          <SettingsRow
            icon={Smartphone}
            label="App version"
            description={app ? `${channelLabels[app.channel]} channel` : undefined}
          >
            <span className="text-sm">
              {app?.version ?? (checking ? 'Checking…' : 'Unavailable')}
            </span>
          </SettingsRow>
        )}
        <div className="flex flex-col gap-3 px-4 py-3">
          {incompatibility && (
            <p role="alert" className="text-destructive text-sm">
              {incompatibility === 'client-too-old'
                ? android
                  ? 'This app needs an update to sync with your server. Install the matching app version below or from GitHub releases.'
                  : 'This app needs an update to sync with your server. Reload to load the latest app; if this continues, close and reopen Catch to apply its update.'
                : 'Your server needs an update to sync with this app. Ask your server administrator to update Catch.'}{' '}
              Local notes and queued changes stay on this device until sync resumes.
            </p>
          )}
          {android && server && app && (
            <p className="text-muted-foreground text-sm">
              {available
                ? `Catch ${server.version} is available for your app.`
                : app.channel !== server.channel
                  ? 'This app and server use different release channels. Install the matching app from GitHub releases.'
                  : server.channel === 'dev'
                    ? 'Development builds do not receive release updates.'
                    : app.version === server.version
                      ? 'Your app matches the server version.'
                      : 'No app update is available for this server.'}
            </p>
          )}
          {available && (
            <>
              <Button
                disabled={installing || checking}
                onClick={() => {
                  haptics.selection();
                  void installServerVersion();
                }}
              >
                <Download aria-hidden />
                {installing ? 'Preparing update…' : `Update to ${server?.version}`}
              </Button>
              <p className="text-muted-foreground text-xs">
                Android will ask you to confirm installation. You may need to allow Catch to install
                updates.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {installError && (
            <p role="alert" className="text-destructive text-sm">
              {installError}
            </p>
          )}
          <Button
            variant="ghost"
            className="self-start"
            disabled={checking || installing}
            onClick={() => {
              haptics.selection();
              void checkForUpdates();
            }}
          >
            <RefreshCw aria-hidden />
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title="Project">
        <ProjectLink href={REPOSITORY_URL} label="GitHub repository" icon={CodeXml} />
        <ProjectLink href={RELEASES_URL} label="GitHub releases" icon={Download} />
      </SettingsSection>
      {server && <ChannelReleases channel={server.channel} />}
    </div>
  );
}

function ProjectLink({ href, label, icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-2xl outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/70"
    >
      <SettingsRow icon={icon} label={label}>
        <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
      </SettingsRow>
    </a>
  );
}

function ChannelReleases({ channel }: { channel: ReleasesResponse['channel'] }) {
  const [result, setResult] = useState<ReleasesResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry must fetch again even when the channel has not changed.
  useEffect(() => {
    if (channel === 'dev') return;
    let active = true;
    setResult(null);
    setError(false);
    void api
      .releases()
      .then((input) => {
        const parsed = releasesResponseSchema.parse(input);
        if (active && parsed.channel === channel) setResult(parsed);
        else if (active) setError(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [channel, attempt]);
  return (
    <SettingsSection
      title={`${channelLabels[channel]} releases`}
      description={
        channel === 'dev'
          ? 'Development builds are not published to GitHub releases.'
          : 'Recent releases from your server’s channel. App updates target the server’s version.'
      }
    >
      {channel !== 'dev' &&
        (error ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <p role="alert" className="flex-1 text-muted-foreground text-sm">
              Could not load releases from GitHub.
            </p>
            <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : !result ? (
          <p className="px-4 py-3 text-muted-foreground text-sm">Loading releases…</p>
        ) : result.releases.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            No releases in this channel yet.
          </p>
        ) : (
          result.releases.map((release) => (
            <a
              key={release.version}
              href={`${RELEASES_URL}/tag/v${release.version}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <SettingsRow
                label={release.name}
                description={new Date(release.publishedAt).toLocaleDateString()}
              >
                <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
              </SettingsRow>
            </a>
          ))
        ))}
    </SettingsSection>
  );
}
