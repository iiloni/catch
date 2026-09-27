# Roadmap

Carried over from `catch-old`, plus what Keep has that the old app lacked.

## Done (baseline port from `catch-old`)
- [x] BlockNote editor (`@blocknote/shadcn`): a "Take a note…" composer, and an editor dialog with autosave, opened through `?note=<id>`.
- [x] Note colors, pinning, archive, and a trash with undo, restore, delete forever, and empty trash.
- [x] Theme switcher (system / light / dark) via `data-theme` on `<html>`.
- [x] Deck and gallery: notes with a `status` go to the deck, shown as a grid or a board (drag between New / In progress / On hold, or drop on "Send to gallery").
- [x] Gallery sorting by edited or created time.
- [x] Masonry layout that preserves row-first ordering.

## Next
- [ ] Offline persistence for TanStack DB collections and queued offline writes.
- [ ] Keyword search, then hybrid search (see `docs/decisions/0002-search.md`).
- [ ] Markdown import and export.

## Later
- [ ] User-defined board columns.
- [ ] Labels.
- [ ] Link previews fetched on the server, with optional AI summaries through a user-configured OpenAI-compatible endpoint (off by default). Not yet ported from `catch-old`.
- [ ] Attachments stored by content hash, deduplicated per user, on a local volume with optional S3.
- [ ] Android share target: receive text and links from other apps.
- [ ] Reorder notes by dragging within the gallery and within board columns.

## Not planned
- Desktop app (the PWA covers it), iOS, biometrics, haptics.
