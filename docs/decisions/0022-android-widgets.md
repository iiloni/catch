# 0022: Android home-screen widgets

Status: accepted (2026-10-10)

## Context

A home-screen widget lives in the launcher, outside the Capacitor WebView. Catch's
collections and outbox run in that WebView, even though Android persists the
collections in native SQLite (ADR 0007). The launcher must work with the app closed
without becoming a second sync client or modifying TanStack's private storage.

## Decisions

**Three native widgets.** Quick capture opens New note or Search. One note shows a
selected note, with its color and checklist state. Note list shows pinned notes,
Gallery, all notes, a tag (including descendants), or a Deck column, in Catch's position order with
pinned notes first. Lists scroll vertically; single-note previews truncate to fit.
The configuration activity selects an account, content and system/light/dark
appearance for each instance through a custom Catch dialog, with accessible
selection buttons and appearance segments. Android owns placement, resizing and reconfiguration.
Java/XML RemoteViews fit the existing shell without introducing Kotlin or Compose.

**A disposable snapshot, not a second database.** `watchWidgetSnapshot` reads only
ordinary owned collections after local hydration, including when offline, and
`nativeWidgets.ts` passes a versioned projection through `WidgetsPlugin`. The
projection contains bounded text previews and checklist glyphs, effective note
colors, and IDs for filtering and opening. It has no bearer tokens, editable note
JSON, shared copies, attachments or vault plaintext. Native storage is an atomic
file under Android's no-backup directory. It can be recreated from collections.
The widget providers and list service render that file while the WebView is absent.

**Refresh follows the account in use.** Local optimistic edits and streamed changes
publish a coalesced snapshot. An account not open in Catch retains its last snapshot;
there is no background HTTP fetch. Setup explains this and One note shows when
the snapshot was updated. Note list uses the available space for cards and a
floating New note button, with no header or footer bars. Scroll padding lets the
last card move above the button. List configuration stays in the launcher's
Edit/Reconfigure action; older launchers can remove and add it again.
Deleted, trashed and archived notes disappear when
observed. A missing selected note, tag or column directs the user to configuration.

**The account belongs to the widget.** A widget keeps its account ID; switching
accounts never repoints it. Startup reconciles the native account list and changing
servers discards old configurations and previews. Sign-out clears that account's
snapshot and pending launch, including when signing out an inactive account.
Native session generations reject late snapshot writes after sign-out or a reload.
Vault plaintext remains memory-only (ADR 0020), even when unlocked, so no widget can
select or display one. Shared notes are excluded from this release.

**Edits happen in Catch.** Explicit activity PendingIntents are resolved against
current widget configuration. A launch stays pending natively until acknowledged,
so a cold start or account-switch reload does not lose it. An open editor/composer
must close before a widget replaces it. Compose leaves the vault and uses the
existing quick-note editor and outbox. A column widget supplies that column as the
initial destination; other widgets create ordinary Gallery notes without inheriting
pins or tags. Tapping a checklist opens its note; it does not change the checkbox.

## Consequences

- Widgets remain readable offline and after process death, but cannot show changes
  from another device until the account next runs and syncs in Catch.
- Widget layouts use native text and solid surfaces. The web app's glass and motion
  are not portable to RemoteViews. Palette resources mirror the note surface tokens
  in `styles.css` and must change together.
- There is no server endpoint, protocol bump, synced shape change or outbox migration.
- Inline checklist writes would need durable operations resolved against the latest
  block tree. Replaying a cached whole note could overwrite newer content because
  note content is one last-write-wins field (ADR 0007).
- Android tests must exercise RemoteViews and lifecycle behavior separately from the
  web check. Launcher sizing, configuration, cold/warm taps, multiple accounts,
  sign-out, offline use, themes and large fonts also need device verification.
