export const NOTE_COLORS = [
  'default',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'dark-blue',
  'purple',
  'pink',
  'brown',
  'gray',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];
