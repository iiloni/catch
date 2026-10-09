# 0021: Sharing a note with a link

Status: accepted (2026-10-06)

## Context

Every row in Catch belonged to one user and no page could be read signed out. People want
to hand a note to someone else: another person on the same server should get it in their
gallery, and anyone else should at least be able to read it.

## Decisions

**A note is shared by a link, and the link is the permission.** `note_shares` holds at most
one row per note, keyed by the note, with a 256-bit random token. `/s/<token>` shows the
note to anyone, with no account. There is no list of people to share with: a household
server has no directory to pick from and sends no mail, and a link can be sent any way the
owner likes. The device makes the token and the row is written through `write()` and the
outbox (`PUT`/`DELETE /api/note-shares/:noteId`), so a note can be shared offline and its
link copied again later from any of the owner's devices; the link starts working when the
write arrives. The token is stored as it is, not hashed: it has to sync back to the owner,
and a database that leaks holds the notes themselves. A note keeps the first link it was
given, so two devices sharing one note offline converge on one row.

**The share panel chooses a link or a content copy.** Its segmented control offers Catch
link and Note content. Content uses BlockNote's Markdown exporter on the device, including
unsaved editor text. Device-only attachment references become filenames; files themselves
are not sent. This copy grants no live access and creates no share link. The panel explains
that a link includes future updates, while a content copy does not include files or updates.

Android opens the system Sharesheet through a local `OutgoingShares` Capacitor plugin
(`ACTION_SEND`, `text/plain`). Mobile browsers and PWAs use Web Share when available, with
Markdown prepared before the tap so transient user activation is retained. Desktop and
mobile browsers without Web Share copy to the clipboard instead. Dismissing a browser
share sheet is quiet; real failures remain visible in the panel.

**Readers see the note as it is now, and cannot change it.** A reader with an account on
the server can add the note to their gallery, where it keeps following its owner's edits.
Only the owner edits. Giving readers edits would mean every write to a note, its files, tags
and reminder had to stop assuming one owner, and concurrent edits to one note would be last
write wins on the whole document; that is a larger design than this one and is left for when
it is wanted.

**A reader's gallery holds a copy the server keeps current.** `shared_notes` has a row per
reader and note with the note's content, shown color, files and owner's name, beside the
reader's own pin, archive, position and gallery preview choice (ADR 0006), plus the link token used to add it again on Undo.
`refreshSharedNote` rewrites those rows in the transaction of every change a reader would
see: the note's content, color or trash, its
primary tag (which gives it its color, ADR 0016), and its files. A copy rather than a shape
that reaches into `notes`, because every shape is pinned to the signed-in user's rows by
`user_id = $1` and nothing else; a shape of other people's notes would need Electric's
subqueries, which are experimental, or a second kind of filter to get wrong. The cost is the
content stored once per reader, which a household's sharing keeps small, and one indexed
lookup on each note save.

Acceptance and snapshot publication take the owner's note row lock through their
transaction, before any attachment or assignment row locks. Acceptance then revalidates
and holds the exact token's share row until insertion finishes, so a revoked link cannot
join its replacement. Snapshot reads and publication are serialized with owner writes,
including the first reader joining and tag tree color changes. The client waits for the
accepted copy to sync before navigating to its editor.
Its cached React view is initialized from the collection before the first render, so a
ready collection cannot briefly appear empty and close the newly opened note.
Tag tree changes and Deck column deletion share the existing owner-level tag tree lock
before taking row locks, covering their entire note sets, including unshared color notes.

**Shared notes are shown as notes.** The client turns a copy into a `Note` whose `userId` is
its owner's (`sharedNoteAsNote`), so the gallery, archive and search show it with the same
cards, and `isSharedNote` is how anything tells it apart. Its card says whose it is. Opened,
it is read only: no editing, color, tags, reminder, deck or trash, and it cannot be
selected with other notes. The reader can pin it, archive it, move it, choose a link as its card face and remove it from
their notes. Its files are listed with the reader's own attachments and load through the
ordinary attachment routes, which let a reader fetch the files of a note in their gallery.

**Ending is the owner's, and takes the note back.** Stop sharing deletes the link's row,
which cascades to every copy: the link stops working and the note leaves the galleries it
was added to. A new link is a new token. A note in its owner's trash is shared as nothing
(the link answers 404 and copies are emptied and hidden) and comes back if it is restored.
Deleting the note or its owner's account removes everything by cascade.

**The public page carries nothing of the account.** `GET /api/shares/:token` and the files
under it are the only data routes outside `requireUser`. They answer by token alone, are
never cached, ask search engines not to index, and the token is redacted from the server's
request log. The page renders the note with `NotePreview`, not the editor, so a signed-out
visitor starts no sync and loads no editor; links in the note open in a new tab only when
they are `http`, `https` or `mailto`. A share link is only as private as wherever it was
sent, which the share panel says.

## Compatibility

Protocol 4, with the server's range 2–4. The change adds routes, two shapes and two tables,
and alters nothing an older client uses, so protocol 2 and 3 clients keep working against a
new server and simply have no sharing. A protocol 4 client syncs the two new shapes and so
needs a server that has them; an older server refuses it with the usual 426 until it is
updated. Update the server first. No released shape's columns change and no existing
queued write changes format. During
development, adding the token to `shared-notes` moves that collection's `schemaVersion`
to 2; migration 0014 fills existing copies from their share links. This remains part of
the unpublished protocol 4 contract. Accepting a share still allows an empty body; Undo
may supply the reader's pin, archive and position, and replay leaves an existing copy alone.
Sharing Markdown and selecting the outgoing transport change no API, shape, persisted
content or queued write format; protocol and collection versions stay unchanged.

## Consequences

- Two more shapes per client, eight in all. Over HTTP/1.1 that is more than a browser's six
  connections per origin, as ADR 0018 already found; production needs HTTP/2.
- A reader's copy shows the owner's name as it was at the note's last change.
- Tag color, hierarchy and deletion changes refresh reader copies in the same transaction.
- A reader gets previews for the links in a shared note like for their own (ADR 0006).
- The reader's attachment quota is not charged for a shared note's files; they are the
  owner's.
- Android hands an `https` link only to an app whose build names the link's host, and a
  Catch server's host is its owner's to choose, so a share link opens in the phone's
  browser. The page there offers "Open in the Catch app", which passes the link through the
  app's own `catchnotes:` scheme (`lib/appLinks.ts`); the app shows the same page from the
  server it is connected to, signed in. Tapping it without the app installed does nothing.
- Someone on a different Catch server reads the public page like anyone else; their app
  refuses the link, since it reads only from its own server.
- Removing a shared note offers Undo, restoring its pin, archive and position through the
  outbox, including offline. The server adds it again by its original token with the
  owner's current content. If the owner ended that link, Undo is rejected and the
  optimistic copy is rolled back; a new link never revives an old permission.
