import { Check, Minus, X } from 'lucide-react';
import { type Answer, checkedOn, products, rows, sources } from '@/lib/comparison';
import { cn } from '@/lib/utils';
import { Section } from './Section';

const marks: Record<
  Exclude<Answer, 'text'>,
  { icon: typeof Check; label: string; className: string }
> = {
  yes: { icon: Check, label: 'Yes', className: 'text-[light-dark(#047857,#34d399)]' },
  partial: { icon: Minus, label: 'Partly', className: 'text-[light-dark(#b45309,#fbbf24)]' },
  no: { icon: X, label: 'No', className: 'text-muted-foreground' },
};

const checked = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
  new Date(checkedOn),
);

export function Compare() {
  return (
    <Section
      id="compare"
      eyebrow="Compare"
      title="Where Catch stands."
      lead="Next to the app it is modeled on and two open source alternatives, including the rows where Catch is behind."
    >
      <div className="reveal overflow-x-auto rounded-3xl border border-border bg-card">
        <table className="w-full min-w-[46rem] border-collapse text-left text-[0.95rem]">
          <thead>
            <tr>
              <th scope="col" className="w-[28%] p-4">
                <span className="sr-only">Feature</span>
              </th>
              {products.map((product, index) => (
                <th
                  key={product}
                  scope="col"
                  className={cn(
                    'w-[18%] p-4 font-display text-base font-semibold',
                    index === 0 && 'bg-brand/15',
                  )}
                >
                  {product}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.feature} className="border-t border-border align-top">
                <th scope="row" className="p-4 font-medium">
                  {row.feature}
                </th>
                {row.cells.map((cell, index) => {
                  const mark = cell.answer === 'text' ? null : marks[cell.answer];
                  return (
                    <td key={products[index]} className={cn('p-4', index === 0 && 'bg-brand/15')}>
                      {mark && (
                        <span
                          className={cn('flex items-center gap-1.5 font-medium', mark.className)}
                        >
                          <mark.icon className="size-4 shrink-0" aria-hidden />
                          {mark.label}
                        </span>
                      )}
                      {cell.note && mark === null && <span className="block">{cell.note}</span>}
                      {cell.note && mark && (
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {cell.note}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Checked on {checked} against each product's own pages:{' '}
        {sources.map((source, index) => (
          <span key={source.url}>
            {index > 0 && ', '}
            <a href={source.url} className="underline underline-offset-2 hover:text-foreground">
              {source.product}
            </a>
          </span>
        ))}
        . Products change; tell us if a row is out of date.
      </p>

      <div className="reveal mx-auto mt-12 max-w-3xl rounded-3xl border border-border p-7">
        <h3 className="text-xl font-semibold">When Catch is the wrong choice</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
          <li>You do not have a server, or a friend with one. Catch has no hosted version.</li>
          <li>You use an iPhone and want an app from the App Store.</li>
          <li>
            You need notes nobody but you can read. Catch does not encrypt end to end, so whoever
            runs the server can read what is on it. Notesnook does.
          </li>
          <li>
            You write shared lists with other people. Each Catch account sees only its own notes;
            Keep lets several people edit one.
          </li>
          <li>You rely on Keep's drawings.</li>
        </ul>
      </div>
    </Section>
  );
}
