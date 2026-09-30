# 0008: Importing notes

Status: accepted (2026-09-30)

## Context

People moving to Catch bring notes from elsewhere, starting with Google Keep. Settings has a
Data Management page for this, which will later hold backup, restore, export and other
importers. An export can hold thousands of notes and, with images, run to gigabytes. People
import again when a first attempt was cut short, or when they export once more after a
while, so importing the same notes twice must not duplicate them.

## Decisions

**Exports are read on the device.** The importer (`lib/keepImport.ts` for Keep) turns the
files the user chose into notes; the server only ever sees notes. Takeout's `.zip` is read
from its central directory with `Blob.slice` and the browser's `DecompressionStream`
(`lib/zip.ts`), so only the directory and the files an importer asks for are read, never
the whole archive, and there is no zip dependency. Each importer validates its source's
format with Zod and converts it to BlockNote blocks.

**Imported notes go through the outbox.** `importNotes` in `lib/notes.ts` inserts the notes
with `write()` in batches, so they show at once, sync like any other change, and a batch
the server refuses rolls back alone. `pushWrites`
sends a transaction's new notes together to `POST /api/notes/batch`, which inserts them in
one Postgres transaction and returns one txid. Imported notes go after the user's notes, in
the order the importer gives (newest first for Keep, whose export has no order).

**Progress shows on the page, and outlives it.** Reading an export shows its progress in
the importer's row and can be cancelled; nothing is added until the user confirms what was
found, in a dialog. After that the notes are on the device at once, so the progress that
matters is the server's. `startImport` (`lib/imports.ts`) writes the notes with
`importNotes` in batches of 50 (smaller than a request's worth, so progress moves in
visible steps; the outbox sends one write at a time) and keeps the import, one outbox
transaction id per batch, in localStorage. The Import section shows its progress
(`ImportProgress`) and then a summary until dismissed, so a large import can be left and
come back to, even across an app restart. Batches written by the current page count once
their write settles, which is after Electric has streamed them back; batches from an earlier
visit count once the outbox no longer holds them (a refusal there was reported with a toast
at the time, but counts as saved). One import runs at a time. When it ends with nobody on
the page, a toast says so. Link previews are fetched afterwards on the server and are not
part of the progress.

**Ids are derived, not random.** An imported note's id is a UUIDv7 whose time is when the
note was made and whose random bits are a SHA-256 of the user id and a key from the source
(for Keep, its creation time in microseconds). Importing the same export again gives the
same ids, so notes already here are skipped, and an import that stopped halfway can be run
again. The user id is part of the hash so two users importing a shared note do not collide.

**Notes keep their dates.** A create may carry `createdAt`, `updatedAt`, `isArchived` and
`deletedAt`. The server replaces a date later than its own clock with the current time.

**The page waits for the notes to sync.** Telling which notes are already here, and where
the user's notes end, needs the synced collection. The Data Management page keeps the notes
collection subscribed while open (`useSyncedNotes`) and enables importing once it has
synced, which offline it never does.

## Consequences

- The importer leaves out and lists Keep's attachments (images, drawings, recordings),
  labels, and notes in its trash. Catch supports attachments (ADR 0009), but reading and
  matching Takeout's binary files is not implemented yet.
- Keep's rich-text formatting is not imported: notes come in from `textContent`, the plain
  text every export has, rather than the newer `textContentHtml`.
- A note deleted forever after an import comes back if the same export is imported again.
- Split Takeout exports can be chosen together, as can the `.json` files of an unpacked one.
  `.tgz` exports are refused with a hint to export as `.zip`.
