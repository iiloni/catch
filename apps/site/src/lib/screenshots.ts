import type { Shot } from '@/components/Screenshot';
import desktopDeckDark from '@/screenshots/desktop-deck-dark.webp';
import desktopDeckLight from '@/screenshots/desktop-deck-light.webp';
import desktopGalleryDark from '@/screenshots/desktop-gallery-dark.webp';
import desktopGalleryLight from '@/screenshots/desktop-gallery-light.webp';
import desktopTagsDark from '@/screenshots/desktop-tags-dark.webp';
import desktopTagsLight from '@/screenshots/desktop-tags-light.webp';
import phoneDeckDark from '@/screenshots/phone-deck-dark.webp';
import phoneDeckLight from '@/screenshots/phone-deck-light.webp';
import phoneGalleryDark from '@/screenshots/phone-gallery-dark.webp';
import phoneGalleryLight from '@/screenshots/phone-gallery-light.webp';
import phoneNoteDark from '@/screenshots/phone-note-dark.webp';
import phoneNoteLight from '@/screenshots/phone-note-light.webp';
import phoneReminderDark from '@/screenshots/phone-reminder-dark.webp';
import phoneReminderLight from '@/screenshots/phone-reminder-light.webp';
import phoneSearchDark from '@/screenshots/phone-search-dark.webp';
import phoneSearchLight from '@/screenshots/phone-search-light.webp';

/** Captured by `scripts/screenshots.ts`; rerun it rather than editing the files. */
export const shots = {
  desktopGallery: {
    light: desktopGalleryLight,
    dark: desktopGalleryDark,
    alt: 'The gallery on a desktop: colored note cards, with one note open beside them',
  },
  desktopDeck: {
    light: desktopDeckLight,
    dark: desktopDeckDark,
    alt: 'The deck on a desktop: notes in New, In progress and On hold columns',
  },
  desktopTags: {
    light: desktopTagsLight,
    dark: desktopTagsDark,
    alt: 'Tag settings on a desktop: a tree of tags, each top-level one with an icon and a color',
  },
  phoneReminder: {
    light: phoneReminderLight,
    dark: phoneReminderDark,
    alt: "A note's reminder panel on a phone, with day, time, repeat and time zone choices",
  },
  phoneSearch: {
    light: phoneSearchLight,
    dark: phoneSearchDark,
    alt: 'Search on a phone, with the matching words highlighted in a note',
  },
  phoneGallery: {
    light: phoneGalleryLight,
    dark: phoneGalleryDark,
    alt: 'The gallery on a phone, with pinned notes in two columns',
  },
  phoneNote: {
    light: phoneNoteLight,
    dark: phoneNoteDark,
    alt: 'A note open on a phone, with a checklist, tags and a link preview',
  },
  phoneDeck: {
    light: phoneDeckLight,
    dark: phoneDeckDark,
    alt: 'The deck on a phone, one column at a time',
  },
} satisfies Record<string, Shot>;
