import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReleaseNotes } from '@/components/ReleaseNotes';
import { releases } from '@/lib/changelogData';

type Props = { params: Promise<{ version: string }> };

// A static export refuses a dynamic route with no pages, which is what a build without
// release history has.
const NO_RELEASES = 'none';

export function generateStaticParams() {
  return releases.length > 0
    ? releases.map(({ version }) => ({ version }))
    : [{ version: NO_RELEASES }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Catch ${(await params).version}` };
}

export default async function ReleasePage({ params }: Props) {
  const { version } = await params;
  const release = releases.find((candidate) => candidate.version === version);
  if (!release) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
      <Link href="/changelog" className="text-sm text-brand-link underline underline-offset-4">
        All versions
      </Link>
      <h1 className="sr-only">Catch {release.version}</h1>
      <div className="mt-6">
        <ReleaseNotes release={release} />
      </div>
    </div>
  );
}
