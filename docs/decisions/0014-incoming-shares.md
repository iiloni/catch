# 0014: Incoming Android shares

Status: accepted (2026-10-01)

## Decisions

Catch receives text, links, images, video, audio and files from other apps. One share creates
one Gallery note and opens it for editing; multiple files and captions stay together.
Outgoing sharing and adding a share to an existing note are separate features.

**Two entry points, one note flow.** The native Android app declares SEND and SEND_MULTIPLE
intent filters. Its local Capacitor plugin handles launch and new intents, copies granted
content URIs off the UI thread into private files, and persists a receipt before notifying
the page. The page acknowledges native staging only after storing the payload in IndexedDB.
No broad storage permission is needed. Only content URIs are accepted for files, with the
existing 100 MiB limit per file and a maximum of 20 files per share.

The installed Android PWA declares a POST multipart `share_target` at `/share`. Its service
worker stores the request body locally before redirecting to `/share?id=<uuidv7>`. The worker
uses Vite PWA's injectManifest strategy, preserving app precaching, update activation and
the link-preview asset cache. This also lets the receiving endpoint work offline. A native
Capacitor WebView does not receive intents through the PWA manifest. iOS PWAs do not support
Web Share Target; native iOS share extensions are outside this change.

**A durable device inbox before login.** `catch-incoming-shares` is a staging database shared
by the worker and page, independent of signed-in collection initialization. Every delivery
has a UUIDv7 note id and stable attachment ids. The receiving route retains that id across
server setup and login's full reload. Before creating data, it binds the share to the current
account; another account cannot resume or replay it. A per-share Web Lock and an in-process
promise prevent concurrent consumption. Repeated intentional shares get different ids.

The route hydrates device collections without waiting for an online Electric snapshot,
then uses the existing note actions and attachment import path. It waits for each write's
durable outbox admission (or successful server completion) before replacing the payload with
a small account-bound receipt. Reloading a receipt opens the same note without overwriting
edits. A failed share retains its payload for retry; a second window without the outbox
cannot acknowledge an offline save and instead asks the user to close the other window and
retry. HTML is treated as literal text; ordinary web URLs become BlockNote links.
Native shares are prepared in the background while the signed-in layout stays mounted,
so replacing an open note flushes its autosave and closing a composer saves its draft.
Account-bound staging and receipts are cleared with that account's local data on sign-out.

## Compatibility

No REST, shape, persisted note encoding, or outbox format changes. Existing servers receive
ordinary protocol-1 notes and attachments; existing clients read those notes normally.
API protocol and collection schema versions stay unchanged.

## Verification

Unit tests cover content conversion, durable payloads, file limits, duplicate delivery,
partial preparation and account isolation. End-to-end tests exercise note creation, login
continuation and reloads. PWA POST handling must be checked against a production build: the
development server still has no service worker. OS share-menu registration and granted file
URIs require Android device testing.
