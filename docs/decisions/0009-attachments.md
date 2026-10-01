# 0009: File attachments and media

Status: accepted (2026-09-30)

## Decisions

**Files belong to notes independently of blocks.** `attachments` is a user-filtered,
SQLite-persisted Electric collection. Each attachment has a client UUIDv7, note, filename,
MIME type, size, media kind and pending/ready status. BlockNote's existing image, video, audio
and file blocks store `attachment:<id>` in their URL prop. Removing a block removes only that
placement; the Media catalog continues to hold the file. Its menu can show an existing inline
block or add a block at the cursor (replacing an empty block or inserting below it), rename,
download, keep offline, or explicitly remove it. Removal from the more menu takes effect
directly and tombstones the metadata and deletes the bytes, so replay cannot resurrect it. Trash
retains attachments; deleting a note forever deletes its files too. Copies get new attachment
ids and independent server files, including attachments with no inline placement.

**Bytes stay out of Electric and the note outbox.** Per-user IndexedDB (`catch-files-<user>`)
holds selected files before their metadata is written through `write()`. IndexedDB is already
used for the outbox on web and Android; its Blob storage holds binaries without adding them
to SQLite or serializing them into queued JSON. A restored attachment insertion uploads its
persisted Blob after the note's creation. Files selected offline preview immediately and
survive an app restart. Network failures retry through the existing outbox. The client keeps
its selected originals; other devices cache image thumbnails and video posters and fetch originals on demand,
with Keep offline for a durable copy. Sign-out clears the user's files with the other stores.

**Server files live on disk.** Originals and 720 px WebP image previews and video posters live in
`ATTACHMENTS_DIR`, backed by a named Docker volume by default. `CATCH_ATTACHMENTS_MOUNT`
can select a bind mount; backups must include it and Postgres. Uploads stream to temporary
files and are renamed only after their exact declared size has arrived. Metadata creation
and upload completion are replay-safe and return txids. The initial limit is 100 MiB per file;
upload retries send the whole file. Sharp produces image previews; FFmpeg produces a video's
first frame, with a timeout, limited threads, and only local media containers permitted.
Both Docker targets include FFmpeg. Previews are written atomically; failures keep the original
usable. Authorized preview requests also generate missing previews for existing attachments,
sharing concurrent requests for the same file. Object storage, resumable/chunked uploads and
playback transcoding are deferred. Keep imports use this same attachment path and add
files only to the catalog (ADR 0008).

**Personal media is private.** Content and thumbnails require bearer authentication or a
signed, attachment-specific access ticket obtained with bearer auth. A ticket lasts an hour
and still checks ownership, availability and removal on each request. These URLs let native
HTML media elements make byte-range requests without account credentials in URLs. They are
resolved at render time, never saved into blocks or synced metadata. Responses are private,
not service-worker cached, carry nosniff and a restrictive CSP, and non-media files download
as octet-stream. Cached files and thumbnails are isolated by signed-in user on the device.

**One attachment flow.** The dock's paperclip is second, between color and Deck, with pin
last. Archive/Unarchive moves beside trash in the note header. The formatting toolbar places
a paperclip immediately after `/`; both grow the same 2×2 panel upward with Photos & videos,
Camera, Record audio, and Files. The quick-note toolbar offers the same flow, creating a
persistent draft only when a file needs a note. Android uses Photo Picker, Storage Access
Framework, camera intents, and an AAC MediaRecorder through a local Capacitor plugin. The
web uses file inputs and MediaDevices/MediaRecorder; live capture requires HTTPS or localhost.
Slash-menu upload and drag/paste upload use the same storage path through `uploadFile`.

**Catalog layout follows editor width.** Media follows the text on narrow editors, and
shares the links column beside editors at least 700 px wide. Images, video and audio also
render inline; gallery previews use image thumbnails and video posters, with compact labels for other files.
The dock's preview overlay also shows a Media card above Links, using the same catalog and
menus. Inline actions are tied to the matching editor and return to that note. Opening the
viewer keeps the catalog beneath it so closing it returns to the attachments. The full
row opens the viewer, with its management menu as a separate control.
Catalog rows share a fixed 64 px thumbnail size with link previews, without a background fill
behind images. Tapping a row opens a full-screen dark media stage without a surrounding
card. The viewer and its backdrop fade in and out linearly over 180 ms, skipping the fade when
reduced motion is requested. The backdrop opens immediately with a loading indicator; the
content's entrance starts once the image is loaded and decoded. Native video/audio controls
appear as soon as their source resolves, so deferred data loading or blocked autoplay cannot
hide the player. Errors reveal the fallback view.
Playback stops when closing begins, and focus returns after the fade.
A small metadata card at the top left offers download and Keep offline.
Control bars use the metadata card's glass surface and the dock's radius tokens. Attachment navigation sits at the top
right beside close on wide screens. Below 640 px, navigation is centered at the top, close
sits at the bottom right and an Info button sits at the bottom left. Metadata starts hidden
in a sheet that slides up to rest above the zoom controls. Dragging the Info button or the
sheet, or swiping up on a fitted image, follows the finger, with threshold and state-change
haptics; releasing settles it open or closed. Swiping down on the fitted image also pushes
the open sheet down. The bottom controls leave room for each other and the device's safe area.
Images support wheel and pinch zoom at the focal point, bounded dragging, double-tap zoom, fit/fill, and
keyboard zoom/reset/pan. Arrows and unzoomed swipes navigate the note's attachments, resetting
the view and stopping playback on each change. Video/audio use native playback controls;
other files show download details. Focus stays in the viewer, and Escape or Android back
closes the viewer first. Right-clicking anywhere in the viewer also closes it and suppresses
the browser context menu.
Media-only imported notes show their first attachment and file count on their gallery card.
