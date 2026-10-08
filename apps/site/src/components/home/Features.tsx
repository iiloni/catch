import {
  CalendarPlus,
  Images,
  Link2,
  LockKeyhole,
  MousePointerClick,
  Search,
  Share2,
  SunMoon,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PhoneFrame, type Shot, WindowFrame } from '@/components/Screenshot';
import { shots } from '@/lib/screenshots';
import { cn } from '@/lib/utils';

function Feature({
  title,
  children,
  shot,
  phone,
  flip,
}: {
  title: string;
  children: ReactNode;
  shot: Shot;
  phone?: boolean;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn('reveal', flip && 'lg:order-2')}>
        <h3 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h3>
        <div className="mt-4 space-y-4 text-pretty text-lg text-muted-foreground">{children}</div>
      </div>
      <div className="reveal">
        {phone ? (
          <PhoneFrame shot={shot} className="mx-auto w-60 sm:w-72" />
        ) : (
          <WindowFrame shot={shot} />
        )}
      </div>
    </div>
  );
}

const more = [
  { icon: Images, title: 'Attachments' },
  { icon: Link2, title: 'Link previews' },
  { icon: Type, title: 'Rich text' },
  { icon: Search, title: 'Search by tag or color' },
  { icon: MousePointerClick, title: 'Select several notes' },
  { icon: CalendarPlus, title: 'Add to Google Calendar' },
  { icon: Share2, title: 'Share to Catch on Android' },
  { icon: SunMoon, title: 'Light and dark' },
];

export function Features() {
  return (
    <section
      id="features"
      className="mx-auto w-full max-w-6xl scroll-mt-24 space-y-24 px-6 py-16 sm:py-24"
    >
      <Feature title="Works offline." shot={shots.phoneGallery} phone>
        <p>Notes live on the device and sync when the signal comes back.</p>
      </Feature>
      <Feature title="Notes on deck." shot={shots.desktopDeck} flip>
        <p>A home for the notes that need your attention.</p>
      </Feature>
      <Feature title="Tags that nest." shot={shots.desktopTags}>
        <p>Tags sit inside tags, and a top-level tag gives its notes a color.</p>
      </Feature>
      <Feature title="Reminders that repeat." shot={shots.phoneReminder} phone flip>
        <p>Every weekday, or the second Tuesday of the month.</p>
      </Feature>

      <div id="preview-features" className="scroll-mt-24 space-y-6">
        <div className="reveal flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">New in v0.6.0-preview.</h3>
          <a
            href="/docs/running-a-server/updates#try-preview-separately"
            className="font-semibold text-brand-link underline underline-offset-4"
          >
            Try the preview release
          </a>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div data-note-color="violet" className="reveal rounded-3xl bg-note p-7 sm:p-9">
            <LockKeyhole className="mb-6 size-7" aria-hidden />
            <h4 className="text-balance text-3xl font-bold tracking-tight">
              A vault for private notes.
            </h4>
            <p className="mt-4 text-pretty text-lg">
              Notes and files encrypted on your devices, with a separate password. The server and
              its backups hold only ciphertext. Ordinary notes stay outside the vault.
            </p>
            <a
              href="/docs/using-catch/vault"
              className="mt-6 inline-block font-semibold underline underline-offset-4"
            >
              Set up your vault
            </a>
          </div>
          <div data-note-color="green" className="reveal rounded-3xl bg-note p-7 sm:p-9">
            <Share2 className="mb-6 size-7" aria-hidden />
            <h4 className="text-balance text-3xl font-bold tracking-tight">
              A note you can pass along.
            </h4>
            <p className="mt-4 text-pretty text-lg">
              Send a read-only link with files and future updates, or a Markdown copy of the text.
              Anyone with the link can read it. You choose when to stop sharing.
            </p>
            <a
              href="/docs/using-catch/links-and-sharing#share-a-catch-note"
              className="mt-6 inline-block font-semibold underline underline-offset-4"
            >
              Learn about sharing
            </a>
          </div>
        </div>
      </div>

      <ul className="flex flex-wrap justify-center gap-3">
        {more.map(({ icon: Icon, title }) => (
          <li
            key={title}
            className="reveal flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[0.95rem] font-medium"
          >
            <Icon className="size-4 text-brand-link" aria-hidden />
            {title}
          </li>
        ))}
      </ul>
    </section>
  );
}
