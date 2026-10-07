import type { Metadata } from 'next';
import { ReleaseNotes } from '@/components/ReleaseNotes';
import { releases } from '@/lib/changelogData';
import { RELEASES_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'What changed in each version of Catch.',
};

export default function ChangelogPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
      <h1 className="text-5xl font-extrabold tracking-tight">Changelog</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        What changed in each version of Catch. Preview versions come out ahead of stable ones.
      </p>
      {releases.length === 0 ? (
        <p className="mt-10 rounded-3xl border border-border p-7">
          This build of the site has no release history. Every version is listed with its changes on
          the{' '}
          <a href={RELEASES_URL} className="text-brand-link underline underline-offset-4">
            releases page
          </a>
          .
        </p>
      ) : (
        <div className="mt-10">
          {releases.map((release) => (
            <ReleaseNotes key={release.version} release={release} linked />
          ))}
        </div>
      )}
    </div>
  );
}
