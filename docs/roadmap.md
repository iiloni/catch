# Roadmap

Carried over from `catch-old`, plus what Keep has that the old app lacked.

## Done (baseline port from `catch-old`)
- [x] BlockNote editor (`@blocknote/shadcn`): a "Take a note…" composer, and an editor dialog with autosave, opened through `?note=<id>`.
- [x] Note colors, pinning, archive, and a trash with undo, restore, delete forever, and empty trash.
- [x] Theme switcher (system / light / dark) via `data-theme` on `<html>`.
- [x] Deck and gallery: notes with a `status` go to the deck, shown as a grid or a board (drag between New / In progress / On hold, or drop on "Send to gallery").
- [x] Gallery sorting by edited or created time.
- [x] Masonry layout that preserves row-first ordering.

## Done (Android-first redesign, see `docs/decisions/0003-design-system-and-motion.md`)
- [x] Edge-to-edge layout that respects the status bar, gesture bar and keyboard.
- [x] Glass dock with Gallery, Deck and Search tabs, a sliding indicator and scrubbing; the Search tab morphs into a search field.
- [x] Quick-note window above the dock; saved notes fly into their new card.
- [x] Full-screen editor that grows out of its card and shrinks back, with pull-down to dismiss.
- [x] Gallery with Pinned and Others, sort options, and Archive and Trash in the title menu; Settings in a sheet behind the avatar.
- [x] Deck as its own screen: a paged board on phones, with a "Send to gallery" target while dragging.
- [x] Keyword search on the client, with a color filter and recent searches.
- [x] 18 note colors on an OKLCH scale; graphite and legal-pad yellow theme.
- [x] System haptics on Android.
- [x] Offline persistence: collections kept in SQLite on the device, and writes queued while offline (see `docs/decisions/0007-offline-persistence.md`).

## Next
- [ ] Hybrid search on the server (see `docs/decisions/0002-search.md`); keyword search runs on the client today.
- [ ] Long-press to select several notes, with actions in the dock.
- [ ] Markdown import and export.
- [x] Google Keep import from a Takeout export, in Settings > Data Management (see `docs/decisions/0008-importing-notes.md`).
- [x] Server backup and restore for admins, in Settings > Admin > Backups, with scheduled and pre-update backups (see `docs/decisions/0012-server-backups.md`).

## Later
- [x] Reminders on notes, with repeats and time zones, sent to browsers and installed web apps by Web Push (see `docs/decisions/0018-reminders.md`).
- [x] Reminders in the Android app: local alarms that ring offline, with Snooze and Done on the notification (ADR 0018).
- [x] An end to end encrypted vault for private notes (see `docs/decisions/0020-vault.md`).
- [ ] Attachments, search and reminders for vault notes.
- [ ] User-defined board columns.
- [ ] Labels.
- [x] Link previews fetched on the server (see `docs/decisions/0006-link-previews.md`).
- [ ] AI summaries of links through a user-configured OpenAI-compatible endpoint (off by default).
- [ ] Attachments stored by content hash, deduplicated per user, on a local volume with optional S3.
- [ ] Android share target: receive text and links from other apps.
- [ ] Reorder notes by dragging within the gallery and within board columns.

## Not planned
- Desktop app (the PWA covers it), iOS, biometrics.
