import type { Shot } from '@/components/Screenshot';
import desktopDeckDark from '@/screenshots/desktop-deck-dark.webp';
import desktopDeckLight from '@/screenshots/desktop-deck-light.webp';
import desktopGalleryDark from '@/screenshots/desktop-gallery-dark.webp';
import desktopGalleryLight from '@/screenshots/desktop-gallery-light.webp';
import desktopTagsDark from '@/screenshots/desktop-tags-dark.webp';
import desktopTagsLight from '@/screenshots/desktop-tags-light.webp';
import androidKeyboardDark from '@/screenshots/docs-android-keyboard-dark.webp';
import androidKeyboardLight from '@/screenshots/docs-android-keyboard-light.webp';
import androidSetupDark from '@/screenshots/docs-android-setup-dark.webp';
import androidSetupLight from '@/screenshots/docs-android-setup-light.webp';
import androidShareDark from '@/screenshots/docs-android-share-dark.webp';
import androidShareLight from '@/screenshots/docs-android-share-light.webp';
import attachmentsDark from '@/screenshots/docs-attachments-dark.webp';
import attachmentsLight from '@/screenshots/docs-attachments-light.webp';
import desktopBackupsDark from '@/screenshots/docs-backups-dark.webp';
import desktopBackupsLight from '@/screenshots/docs-backups-light.webp';
import importDark from '@/screenshots/docs-import-dark.webp';
import importLight from '@/screenshots/docs-import-light.webp';
import linkCaptureDark from '@/screenshots/docs-link-capture-dark.webp';
import linkCaptureLight from '@/screenshots/docs-link-capture-light.webp';
import moveNoteDark from '@/screenshots/docs-move-note-dark.webp';
import moveNoteLight from '@/screenshots/docs-move-note-light.webp';
import offlineQueueDark from '@/screenshots/docs-offline-queue-dark.webp';
import offlineQueueLight from '@/screenshots/docs-offline-queue-light.webp';
import offlineSaveDark from '@/screenshots/docs-offline-save-dark.webp';
import offlineSaveLight from '@/screenshots/docs-offline-save-light.webp';
import primaryTagsDark from '@/screenshots/docs-primary-tags-dark.webp';
import primaryTagsLight from '@/screenshots/docs-primary-tags-light.webp';
import quickNoteDark from '@/screenshots/docs-quick-note-dark.webp';
import quickNoteLight from '@/screenshots/docs-quick-note-light.webp';
import desktopRestoreDark from '@/screenshots/docs-restore-dark.webp';
import desktopRestoreLight from '@/screenshots/docs-restore-light.webp';
import secondaryTagsDark from '@/screenshots/docs-secondary-tags-dark.webp';
import secondaryTagsLight from '@/screenshots/docs-secondary-tags-light.webp';
import settingsDark from '@/screenshots/docs-settings-dark.webp';
import settingsLight from '@/screenshots/docs-settings-light.webp';
import signInDark from '@/screenshots/docs-sign-in-dark.webp';
import signInLight from '@/screenshots/docs-sign-in-light.webp';
import desktopUsersDark from '@/screenshots/docs-users-dark.webp';
import desktopUsersLight from '@/screenshots/docs-users-light.webp';
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
import phoneSharingDark from '@/screenshots/phone-sharing-dark.webp';
import phoneSharingLight from '@/screenshots/phone-sharing-light.webp';
import phoneVaultDark from '@/screenshots/phone-vault-dark.webp';
import phoneVaultLight from '@/screenshots/phone-vault-light.webp';

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
  phoneVault: {
    light: phoneVaultLight,
    dark: phoneVaultDark,
    alt: 'Vault setup on a phone, with a separate password and the option to remember this device',
  },
  phoneSharing: {
    light: phoneSharingLight,
    dark: phoneSharingDark,
    alt: 'A note’s sharing panel on a phone, offering a Catch link or a Markdown content copy',
  },
} satisfies Record<string, Shot>;

/** Guide assets share the capture pipeline, without changing the marketing gallery. */
export const docShots = {
  androidSetup: {
    light: androidSetupLight,
    dark: androidSetupDark,
    alt: 'Catch’s Connect to your server screen on Android with Server URL and Connect',
  },
  androidKeyboard: {
    light: androidKeyboardLight,
    dark: androidKeyboardDark,
    alt: 'A checklist open in Catch with the formatting toolbar above the Android keyboard',
  },
  androidShare: {
    light: androidShareLight,
    dark: androidShareDark,
    alt: 'Android’s Share menu with Catch Dev and Catch Preview among the available apps',
  },
  signIn: {
    light: signInLight,
    dark: signInDark,
    alt: 'Catch’s sign-in form on a phone with Email, Password, Sign in and the sign-up link',
  },
  gallery: shots.phoneGallery,
  note: shots.phoneNote,
  reminder: shots.phoneReminder,
  search: shots.phoneSearch,
  deck: shots.phoneDeck,
  desktopDeck: shots.desktopDeck,
  desktopTags: shots.desktopTags,
  quickNote: {
    light: quickNoteLight,
    dark: quickNoteDark,
    alt: 'A new note on a phone with formatting controls and the Gallery destination',
  },
  primaryTags: {
    light: primaryTagsLight,
    dark: primaryTagsDark,
    alt: 'The background color picker on a phone, including colors linked to root tags',
  },
  secondaryTags: {
    light: secondaryTagsLight,
    dark: secondaryTagsDark,
    alt: 'The secondary tag picker on a phone with nested tags and assigned checkboxes',
  },
  attachments: {
    light: attachmentsLight,
    dark: attachmentsDark,
    alt: 'The attachment picker on a phone with Photos & videos, Camera, Record audio and Files',
  },
  moveNote: {
    light: moveNoteLight,
    dark: moveNoteDark,
    alt: 'The Move note picker on a phone with Gallery and Deck column destinations',
  },
  import: {
    light: importLight,
    dark: importDark,
    alt: 'Data Management on a phone with the Google Keep import control',
  },
  settings: {
    light: settingsLight,
    dark: settingsDark,
    alt: 'General settings on a phone with appearance, time format, link previews and link capture',
  },
  linkCapture: {
    light: linkCaptureLight,
    dark: linkCaptureDark,
    alt: 'The Add Rich Link form on a phone with a web address and fetched page details',
  },
  offlineSave: {
    light: offlineSaveLight,
    dark: offlineSaveDark,
    alt: 'An edited note on a disconnected phone showing Saved on this device',
  },
  offlineQueue: {
    light: offlineQueueLight,
    dark: offlineQueueDark,
    alt: 'The Offline cloud control showing locally saved changes waiting to sync',
  },
  desktopUsers: {
    light: desktopUsersLight,
    dark: desktopUsersDark,
    alt: 'Admin Users on a desktop with a user search, role control and the Invites section',
  },
  desktopBackups: {
    light: desktopBackupsLight,
    dark: desktopBackupsDark,
    alt: 'Admin Backups on a desktop with completed backups and the daily schedule controls',
  },
  desktopRestore: {
    light: desktopRestoreLight,
    dark: desktopRestoreDark,
    alt: 'The Restore this backup confirmation describing effects on all accounts and devices',
  },
} satisfies Record<string, Shot>;
