# 0006: Link previews

Status: accepted (2026-09-28)

## Context

Notes often hold links, and many notes (especially ones shared from other apps) are nothing
but a link. A bare URL says little about where it goes. Previews should look rich (image,
title, the site's color) without breaking the gallery's calm, work in split view and on
phones, and never cost the user their privacy or the server its safety.

## Decisions

**Links, not blocks.** Previews are derived from the links in a note's BlockNote content
(`extractLinks` in `packages/shared`: link marks and bare URLs, in reading order, keyed by URL
without its fragment). They are never stored in the note, so they do not reach `searchText`,
Markdown export or the editor. A note's `hidden_links` column lists previews the user removed;
removing one leaves the link in the text and, like rearranging, is not an edit.

**Fetched by the server.** Saving a note adds a `pending` row to `link_previews` (per user,
keyed by URL) for each new link, in the note's transaction. An in-process queue then fetches
the page and fills the row, and Electric syncs it like any other table. Rows left pending by a
restart are queued again at startup; failed rows are retried when their note is saved, at most
daily, or from a card's Refresh. `LINK_PREVIEWS=false` turns fetching off, leaving plain cards.
Fetching guards against SSRF: every request and redirect must resolve to a public address,
checked in the socket's own DNS lookup so a rebinding hostname cannot swap addresses; bodies,
time and redirects are capped; credentials in URLs are refused. Pages are scanned (not parsed
into a DOM) for Open Graph and Twitter tags, the title, icons and `theme-color`.

**Images are copies.** Thumbnails (WebP, fit in 720 px) and icons (64 px PNG) are downloaded
and resized with sharp, and stored in `link_preview_assets` named by the SHA-256 of their
bytes. The client loads them from the Catch server, never from the site, so opening a note
does not tell a third party. They are public web content, so they are served without auth
(the Android app authenticates with a header that `<img>` cannot send) and cached as immutable.

**Color is only a hue.** A preview's color is the OKLCH hue of the site's `theme-color`, or else
the dominant hue of its icon; grays give none. The client applies one lightness and chroma per
theme (`[data-link-tint]` in `styles.css`), as it does for note colors, so contrast holds and a
loud brand reads like a quiet one. Site colors appear on preview cards only: the gallery's
underlays use the note's own color a step darker, so the user's colors stay in charge.

**Where previews show.**
- *Cards (Gallery, Deck, Archive, Trash, Search).* A tab tucked under the card names the first
  link, with `+N` for the rest (`LinkUnderlay`). It moves with the card when it is dragged or
  swiped; while notes are selected, tapping it selects. A note that is only one link shows the
  link's preview as its face instead, keeping the note's color if the user chose one.
- *Overlay.* Tapping an underlay opens every link as a list (`LinkPreviewOverlay`) that slides
  up from behind the dock it belongs to (the page's, or the open note's) and rests just above
  it, in reach of the thumb, on every screen size. It slides back down to close, and stacks
  under the editor, so "Open note" grows the note over it as it leaves. Growing it out of the
  underlay instead read as an empty box that filled in late. Back, Escape, a tap outside and
  any navigation close it.
- *Open note.* The layout follows the editor's width, not the viewport or whether it is split:
  from 700 px (in practice, a wide pane) the links get a column beside the note's card; narrower,
  they follow the note's text. While those cards are off screen, a tray tucked behind the dock
  names the first link and opens the overlay (`NoteLinkTray`). It steps aside while typing,
  while the dock has grown into its palette or columns, and while the overlay is open.
- Each card opens its link on tap. Its menu copies, shares, refreshes, shows the link in the
  note, or removes the preview. Before the server has a preview (offline, or while it fetches),
  a card shows the link's address. Settings → General can turn previews off on a device.

## Consequences

- Previews are best effort and eventually consistent: a card may show only its URL for a moment.
- Assets are never deleted yet. They are small, but a cleanup of unreferenced ones will be
  needed eventually.
- Clients hold a third live shape (`link-previews`).
- AI summaries fit the same row (a nullable `summary` column filled by the queue) and card (a
  disclosure under the title), without changing where previews show.
