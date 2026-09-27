/**
 * Note colors in picker order: hues around the wheel, then the earthy and neutral tones.
 * Keys are stored on notes, so rename one only with a data migration; `dark-blue` shows
 * as "Indigo" for that reason.
 */
export const NOTE_COLORS = [
  'default',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'mint',
  'teal',
  'cyan',
  'blue',
  'dark-blue',
  'violet',
  'purple',
  'magenta',
  'pink',
  'brown',
  'gray',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];
