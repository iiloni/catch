# 0005: Custom Deck columns

Status: accepted (2026-09-28)

## Context

The Deck's three hardcoded statuses cannot be renamed, reordered or extended. Columns must
follow a signed-in user across devices while the client can make changes offline.

## Decisions

Columns live in a synced `board_columns` table, filtered by `user_id` in the Electric shape.
The original three columns are seeded for existing accounts by a migration and for new
accounts after signup. Each column has a stable ID, name, accent color and fractional
position. Notes keep their existing status string, so renaming or reordering a column does
not rewrite notes. `new` is the permanent default ID; its name, color and position may
change, but it cannot be deleted. New Deck notes always use it.

Deleting another column requires confirmation. The server moves all of that user's notes
with the deleted status to `new` and deletes the column in one transaction, including
archived and trashed notes. The client temporarily displays unknown statuses in the default
column while a deletion syncs. Collapsed column IDs are a local device preference and do
not sync. On narrow screens, column tabs scroll horizontally rather than compressing.

## Consequences

- New tables require the same user-filtered shape, explicit columns and txid write routes as
  notes.
- A Deck with many columns scrolls horizontally on wide screens as well as phones.
- Collapsing hides cards in that column until it is expanded, while keeping its name and
  note count visible.
