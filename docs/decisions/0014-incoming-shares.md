# 0014: Incoming Android shares

Status: accepted (2026-10-01)

## Decisions

Catch receives text, links, images, video, audio and files from other apps. One share creates
one Gallery note; multiple files and captions stay together. Text and file shares open the
note immediately. A single web link without files opens the link capture form (ADR 0006),
fetches page details automatically and waits for an explicit Save. Shared titles and any
surrounding text prefill the title and notes; the original URL, including its fragment, is
preserved. Shares containing several distinct addresses retain the ordinary note flow.
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
Link captures use the original share id on Save, including retries after storage errors.
They stay in the inbox until saving succeeds or the user cancels. Cancellation records an
account-bound dismissed receipt without creating a note; duplicate native delivery and
reload do not resurrect the capture. Receipts already exist when an edited note is reopened,
so repeating a completed share never reapplies metadata over later edits. Pending captures
queue in delivery order; repeated delivery cannot replace an open form's edits.
When closing a manual capture returns to its quick-note editor, queued shares wait until that
editor closes so they do not interrupt the restored draft.
Account-bound staging and receipts are cleared with that account's local data on sign-out.

The Add Rich Link form offers Gallery or a specific Deck column, color or primary tag,
and secondary tags before Save. These choices belong to the current capture, with no color
or tags initially selected. Captures opened from the quick-note popup default to the current
view: Gallery or the Deck's permanent default column. Native Android link shares default to
the remembered Gallery or Deck home page, captured before any share-related navigation.
Bookmarklet and PWA link shares start in Gallery and use the same controls. Ordinary file and
text shares keep their existing intake behavior. The note and its tag assignments are queued
together through the existing write contracts; receipts and retries preserve assignments on
notes already created.

## Compatibility

No REST, shape, persisted note encoding, or outbox format changes. Existing servers receive
ordinary protocol-1 notes and attachments; existing clients read those notes normally.
API protocol and collection schema versions stay unchanged.
The device inbox gains an optional dismissed flag; existing staged records need no migration.
Page metadata remains optional, so an older server or an offline device can still save links.

## Verification

Unit tests cover content conversion, durable payloads, file limits, duplicate delivery,
partial preparation and account isolation. End-to-end tests exercise note creation, login
continuation and reloads. PWA POST handling must be checked against a production build: the
development server still has no service worker. OS share-menu registration and granted file
URIs require Android device testing.
