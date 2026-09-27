# Roadmap

Carried over from `catch-old`, plus what Keep has that the old app lacked.

## Next
- [ ] BlockNote editor (`@blocknote/shadcn`) for creating and editing notes, replacing the one-line quick add.
- [ ] Offline persistence for TanStack DB collections and queued offline writes.
- [ ] Note colors, pinning, archive, and a trash view with undo.
- [ ] Theme switcher (system / light / dark) via `data-theme` on `<html>`.
- [ ] Keyword search, then hybrid search (see `docs/decisions/0002-search.md`).

## Later
- [ ] Board view: notes with a `status` show in columns; clearing `status` sends a note back to the gallery. User-defined columns.
- [ ] Labels.
- [ ] Link previews fetched on the server, with optional AI summaries through a user-configured OpenAI-compatible endpoint (off by default).
- [ ] Attachments stored by content hash, deduplicated per user, on a local volume with optional S3.
- [ ] Android share target: receive text and links from other apps.
- [ ] Gallery sorting by created or updated time.
- [ ] Masonry layout that preserves row-first ordering (CSS columns currently order top to bottom).

## Not planned
- Desktop app (the PWA covers it), iOS, biometrics, haptics.
