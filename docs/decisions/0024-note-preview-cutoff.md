# 0024: Note preview cutoff

Status: accepted (2026-11-01)

## Context

A card shows the first ten blocks of a note. Some notes hold much more than is worth showing
in the gallery or deck, such as a long list of links, and the author is the only one who
knows where the useful part ends.

## Decision

**A marker, not a wrapper.** The slash menu's **Preview cutoff** places a line in the note.
A card shows what is above it, and the full note shows everything. BlockNote has no container
blocks: a block holds its own content and an optional indented child group, and a custom block
cannot change that. A wrapper would be a parent with indented children, entered and left by
indenting, and would push the note's first heading out of the card's title position. A marker
leaves the document flat, so every kind of block, nested or media, works above it unchanged.
The card's text is also the start of the note, so nothing jumps as the card grows into the
editor.

**A prop on `divider`, not a new block type.** The marker is `{ type: 'divider', props:
{ previewEnd: true } }`. `blockToNode` throws on an unknown block type, so a new type would
stop older clients opening any note that used it, and protocol gating does not protect a
note already on the device. An older client loads the marker as a plain divider and never
reads the prop. If that client edits the note the prop is dropped, the line stays and the
card returns to its block limit: a lost setting, not lost content. This is a compatible
addition under ADR 0013: no protocol bump, migration or `schemaVersion` change. `previewEnd`
has no default, so ordinary dividers keep their stored form.

**One rule, on the device.** `cardBlocks` in `packages/shared/src/content.ts` is the only
place that applies it, for cards, their height estimate and Android widget text. Content is
opaque to the server, so vault notes work the same way.

- The first cutoff in reading order wins, at any depth. Choosing it again moves it; a pasted
  second one does nothing.
- A cutoff replaces the ten-block limit, because the author chose the length.
- A cutoff with nothing above it is ignored, so a card is never blank.

## Where it shows

The editor and version history show it as a labelled line, so a moved cutoff is a visible
change. A reader in the app sees it too, since their card follows it. The public share page
and text copies leave it out (`withoutPreviewCutoff`), because neither has a card.

Search still covers the whole note, so a card can match on text it does not show. A link
chosen with **Show as Gallery Preview** (ADR 0006) still replaces the card's face, and the
card's link tab still counts every link in the note.

## Consequences

The preview can only be the start of a note. Content from the middle has to move above the
line. A per-block "show on card" choice would lift that, at the cost of a stored column, a
migration and a protocol bump.
