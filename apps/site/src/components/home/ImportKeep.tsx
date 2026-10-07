import { Section } from './Section';

const steps = [
  {
    title: 'Export from Google',
    body: 'Google Takeout sends your Keep data as a zip.',
  },
  {
    title: 'Choose the file in Catch',
    body: 'Settings > Data Management. The zip is read on your device, never uploaded.',
  },
  {
    title: 'Check and confirm',
    body: 'Review what Catch found. Importing again skips what you already have.',
  },
];

export function ImportKeep() {
  return (
    <Section title="Bring your Keep notes.">
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            data-note-color={(['yellow', 'green', 'blue'] as const)[index]}
            className="reveal rounded-3xl bg-note p-7"
          >
            <span className="font-display text-4xl font-bold text-note-accent">{index + 1}</span>
            <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
            <p className="mt-2 leading-relaxed text-foreground/80">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
