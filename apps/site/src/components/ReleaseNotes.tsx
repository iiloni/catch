import Link from 'next/link';
import type { TaggedRelease } from '@/lib/changelog';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' });

export function ReleaseNotes({ release, linked }: { release: TaggedRelease; linked?: boolean }) {
  const preview = release.channel === 'preview';
  return (
    <article id={release.version} className="scroll-mt-24 border-t border-border py-10">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-3xl font-bold tracking-tight">
          {linked ? (
            <Link href={`/changelog/${release.version}`} className="hover:underline">
              {release.version}
            </Link>
          ) : (
            release.version
          )}
        </h2>
        <span
          data-note-color={preview ? 'violet' : 'green'}
          className="rounded-full bg-note px-2.5 py-0.5 text-xs font-semibold"
        >
          {preview ? 'Preview' : 'Stable'}
        </span>
        {release.date && (
          <time dateTime={release.date} className="text-sm text-muted-foreground">
            {dateFormat.format(new Date(release.date))}
          </time>
        )}
      </header>

      {release.promotedFrom && (
        <p className="mt-3 text-muted-foreground">
          The same build as {release.promotedFrom}, released as stable.
        </p>
      )}
      {release.protocol.summary && (
        <p className="mt-4 rounded-2xl border border-border bg-card p-4 text-[0.95rem]">
          {release.protocol.summary}
        </p>
      )}

      {release.sections.map((section) => (
        <section key={section.id} className="mt-6">
          <h3 className="font-sans text-sm font-semibold text-muted-foreground">{section.title}</h3>
          <ul className="mt-2 space-y-2">
            {section.entries.map((entry) => (
              <li key={entry.commit} className="leading-relaxed">
                {entry.scope && <span className="font-semibold">{entry.scope}: </span>}
                <a href={entry.url} className="hover:underline">
                  {entry.description}
                </a>
                {entry.breakingNote && (
                  <p className="mt-1 text-[0.95rem] text-muted-foreground">{entry.breakingNote}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-6 flex gap-4 text-sm text-brand-link">
        {release.urls.release && (
          <a href={release.urls.release} className="underline underline-offset-4">
            Downloads
          </a>
        )}
        <a href={release.urls.compare} className="underline underline-offset-4">
          Every change
        </a>
      </p>
    </article>
  );
}
