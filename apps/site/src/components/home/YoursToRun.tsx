import { DatabaseBackup, RefreshCw, Users } from 'lucide-react';
import { Section } from './Section';

const points = [
  {
    icon: Users,
    title: 'Invite your people',
    body: 'The admin invites by link. Everyone sees only their own notes.',
  },
  {
    icon: DatabaseBackup,
    title: 'Backups built in',
    body: 'Back up and restore the whole server from Settings, by hand or every day.',
  },
  {
    icon: RefreshCw,
    title: 'Updates you choose',
    body: 'Follow stable releases, try previews, or stay on one version.',
  },
];

export function YoursToRun() {
  return (
    <Section title="Yours to run." lead="One Docker Compose file, on a home server or a small VPS.">
      <ul className="grid gap-4 md:grid-cols-3">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="reveal lift glass rounded-3xl p-7">
            <Icon className="size-6 text-brand-link" aria-hidden />
            <h3 className="mt-4 text-xl font-semibold">{title}</h3>
            <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
