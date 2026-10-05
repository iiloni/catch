import { Section } from './Section';

const steps = [
  {
    title: 'Export from Google',
    body: 'Ask Google Takeout for your Keep data. It sends you a zip file.',
  },
  {
    title: 'Choose the file in Catch',
    body: 'Open Settings > Data Management and pick the zip. It is read on your device; the archive itself is never uploaded.',
  },
  {
    title: 'Check and confirm',
    body: 'Catch shows what it found before adding anything. Importing the same export again skips the notes you already have.',
  },
];

export function ImportKeep() {
  return (
    <Section
      eyebrow="Moving in"
      title="Bring your Keep notes."
      lead="You do not start from an empty page."
    >
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
