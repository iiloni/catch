/**
 * The comparison on the home page. Every cell about another product comes from that
 * product's own pages (`sources`); recheck them and move `checkedOn` when editing a row.
 */
export const checkedOn = '2026-10-05';

export const products = ['Catch', 'Google Keep', 'Memos', 'Notesnook'] as const;

/** `text` is a cell that is not a yes or no, such as a price. */
export type Answer = 'yes' | 'no' | 'partial' | 'text';
export type Cell = { answer: Answer; note?: string };
const text = (note: string): Cell => ({ answer: 'text', note });
export type Row = { feature: string; cells: readonly [Cell, Cell, Cell, Cell] };

const yes = (note?: string): Cell => ({ answer: 'yes', note });
const no = (note?: string): Cell => ({ answer: 'no', note });
const partial = (note: string): Cell => ({ answer: 'partial', note });

export const rows: readonly Row[] = [
  {
    feature: 'Runs on your own server',
    cells: [yes(), no(), yes(), partial('The sync server can be self-hosted; alpha, unsupported')],
  },
  {
    feature: 'Hosted service you can sign up for',
    cells: [no('You need a server'), yes(), no(), yes()],
  },
  {
    feature: 'Open source',
    cells: [yes('MIT'), no(), yes('MIT'), yes('GPLv3')],
  },
  {
    feature: 'End-to-end encryption',
    cells: [no('The server can read your notes'), no(), no(), yes()],
  },
  {
    feature: 'Works offline',
    cells: [yes(), yes(), no('Community apps add it'), yes()],
  },
  {
    feature: 'Android app',
    cells: [yes('From GitHub, not Google Play'), yes(), partial('Community apps'), yes()],
  },
  {
    feature: 'iPhone app',
    cells: [no(), yes(), partial('Community apps'), yes()],
  },
  {
    feature: 'Note colors',
    cells: [yes(), yes(), no(), yes('7 on the free plan')],
  },
  {
    feature: 'Checklists',
    cells: [yes(), yes(), yes('Markdown task lists'), yes()],
  },
  {
    feature: 'Reminders',
    cells: [
      yes('One-off and repeating'),
      yes(),
      no(),
      partial('10 on the free plan; repeating ones are paid'),
    ],
  },
  {
    feature: 'Share a note with someone',
    cells: [no(), yes('And edit it together'), yes('Read-only links'), partial('Read-only links')],
  },
  {
    feature: 'Board for notes in progress',
    cells: [yes(), no(), no(), no()],
  },
  {
    feature: 'Import from Google Keep',
    cells: [yes(), yes('It is Keep'), no(), yes()],
  },
  {
    feature: 'Price',
    cells: [
      text('Free; you pay for the server'),
      text('Free'),
      text('Free; you pay for the server'),
      text('Free plan; paid plans from $1.99 a month'),
    ],
  },
];

export const sources = [
  { product: 'Google Keep', url: 'https://support.google.com/keep' },
  { product: 'Memos', url: 'https://usememos.com/features' },
  { product: 'Notesnook', url: 'https://notesnook.com/pricing' },
  {
    product: 'Notesnook sync server',
    url: 'https://github.com/streetwriters/notesnook-sync-server',
  },
] as const;
