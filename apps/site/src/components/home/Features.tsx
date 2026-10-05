import {
  CalendarPlus,
  Images,
  Link2,
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
          <PhoneFrame shot={shot} className="mx-auto w-64 sm:w-72" />
        ) : (
          <WindowFrame shot={shot} />
        )}
      </div>
    </div>
  );
}

const more = [
  {
    icon: Images,
    title: 'Attachments',
    body: 'Images, video, audio and other files inside a note.',
  },
  {
    icon: Link2,
    title: 'Link previews',
    body: "A link in a note shows the page's title and picture.",
  },
  {
    icon: Type,
    title: 'Rich text',
    body: 'Headings, bold, lists and checklists in one editor.',
  },
  {
    icon: Search,
    title: 'Search with filters',
    body: 'Find notes by words, then narrow by tag or color.',
  },
  {
    icon: MousePointerClick,
    title: 'Select several notes',
    body: 'Pin, tag, color, archive or delete many at once.',
  },
  {
    icon: CalendarPlus,
    title: 'Add to Google Calendar',
    body: 'Turn a reminder into a calendar event from its panel.',
  },
  {
    icon: Share2,
    title: 'Share to Catch',
    body: 'On Android, send text, links and files from other apps.',
  },
  {
    icon: SunMoon,
    title: 'Light and dark',
    body: 'Both themes, following your device unless you choose.',
  },
];

export function Features() {
  return (
    <section
      id="features"
      className="mx-auto w-full max-w-6xl scroll-mt-24 space-y-24 px-6 py-16 sm:py-24"
    >
      <Feature title="Offline is the normal case." shot={shots.phoneGallery} phone>
        <p>
          Your notes are kept on the device, so they open at once and stay there without a
          connection. Write on the train; the changes are sent when the signal comes back.
        </p>
        <p>The server is where devices meet, not where you wait.</p>
      </Feature>
      <Feature title="A deck for notes in progress." shot={shots.desktopDeck} flip>
        <p>
          Some notes are things you are doing. Give one a status and it moves to the deck, a board
          with columns you drag notes between.
        </p>
        <p>When it is done, send it back to the gallery or archive it.</p>
      </Feature>
      <Feature title="Tags that nest, and color that means something." shot={shots.phoneNote} phone>
        <p>
          Tags can sit inside other tags, and a tag can carry an icon and a color that its notes
          take on. Search filters by either.
        </p>
      </Feature>

      <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {more.map(({ icon: Icon, title, body }) => (
          <li key={title} className="reveal">
            <Icon className="size-5 text-brand-link" aria-hidden />
            <h3 className="mt-3 font-sans text-base font-semibold">{title}</h3>
            <p className="mt-1 text-[0.95rem] text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
