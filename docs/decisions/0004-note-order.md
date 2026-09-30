# 0004: Note order and rearranging the gallery

Status: accepted (2026-09-28)

## Context

Keep lets you drag notes into any order, and the order follows you across devices. Catch
sorted the gallery by date only. A manual order has to survive offline edits on several
devices, where renumbering every note after a move would conflict constantly.

## Decisions

**Storage.** Each note has a `position`: a fractional index (the `fractional-indexing`
package, base 62). Moving a note gives it a key between its new neighbours, so a move is a
one-row update that works offline like any other write. New notes get a key before every
other note, so they appear first. The server fills one in when a client leaves it out.
Positions compare by code unit (`comparePositions`), never by locale or a Postgres
collation, which fold case. Two devices can hand out the same key; ties break by newest
`createdAt`, and a note moved between equal keys lands just after them. Moving a note does
not change `updatedAt`, so "Last edited" still means edited.

**Sorting.** The gallery's sort menu has Custom (by position, the default), Last edited
and Date created. Dragging works only in Custom, where what you see is the stored order.
Pinned and other notes are separate grids, so a note can't be dragged between them; pinning
does that.

**Grid.** `NoteGrid` lays cards out itself: each goes to the top of the shortest column (as
in Keep), absolutely positioned from measured heights, and springs to new slots through
Motion values. dnd-kit supplies only the sensors (long press on touch, 8 px on a mouse, the
keyboard) and window auto-scroll; there are no droppables. While a card is held, the grid
reserves the slot nearest to the card's centre (`dropIndex` in `lib/masonry.ts`), with a
little hysteresis so it does not flicker between two slots. The held card rides above the
header and dock and drops back once it lands.

The grid renders only the cards within a screen of the viewport, so an import of thousands
of notes stays fast. The rest are laid out from their last measured height (kept per note and
column width), or a guess from their content, and measured before they scroll into view.
Only cards on or near the screen spring to new slots; the rest jump.

**Deck.** Each column shows notes by position, including pinned notes. The board's existing
drag gesture also chooses an insertion slot within the destination column. Moving across
columns updates status and position together; reordering within one column updates position
only. The same fractional keys work independently in each column because only that column's
neighbours bound a move.

## Consequences

- The Gallery's custom order uses `sortNotes(notes, 'position')`; the Deck sorts by position
  without putting pinned notes first, so every card can be rearranged in its column.
- Keys grow by about one character per six moves into the same gap. `notePositionSchema`
  caps them at 1024 characters, far beyond real use.
- Cards are absolutely positioned, so nothing in the grid can rely on normal flow; its height
  comes from the layout.
