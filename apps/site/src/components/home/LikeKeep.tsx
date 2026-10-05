import { Archive, Bell, ListChecks, Palette } from 'lucide-react';
import { Section } from './Section';

const cards = [
  {
    color: 'yellow',
    icon: Palette,
    title: 'Colors and pins',
    body: 'Eighteen colors, and a pinned row for the notes you open every day.',
  },
  {
    color: 'orange',
    icon: ListChecks,
    title: 'Checklists',
    body: 'Tick things off on the card without opening the note. Drag items to indent them.',
  },
  {
    color: 'pink',
    icon: Bell,
    title: 'Reminders',
    body: 'Once or on a repeat. They arrive as notifications in the browser and alarms on Android.',
  },
  {
    color: 'violet',
    icon: Archive,
    title: 'Archive and trash',
    body: 'Put notes away without losing them, and restore the ones you deleted by mistake.',
  },
];

export function LikeKeep() {
  return (
    <Section
      eyebrow="Familiar"
      title="If you know Keep, you know Catch."
      lead="A wall of cards, a box to type in, and nothing to file. The parts of Keep worth keeping are here."
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ color, icon: Icon, title, body }) => (
          <li
            key={title}
            data-note-color={color}
            className="reveal lift rounded-3xl bg-note p-6 shadow-sm"
          >
            <Icon className="size-6 text-note-accent" aria-hidden />
            <h3 className="mt-4 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-foreground/80">{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
