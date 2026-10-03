# 0016: Nested tags and color semantics

Status: accepted (2026-10-01)

## Decisions

**Tags are a user-owned tree with no depth limit.** Each tag has a UUIDv7, name and
nullable parent. Only roots have an optional icon and color. A color belongs to at most
one root per user; no color (`default`) is not a linkable color. Descendants inherit their
root's appearance. Iterative traversal avoids call-stack limits and guards partial sync
against cycles. The server serializes hierarchy edits and assignment validation per user
with a transaction advisory lock, validates ownership, and rejects cycles.

**Assignments are separate from note content.** A `note_tags` row keyed by the note's ID
holds one nullable primary and a deduplicated array of secondary tag IDs. The primary is
excluded from the secondary array. PATCH changes only the requested role, preserving
concurrent edits to the other role. Both tables have authenticated, column-allowlisted
Electric shapes and persisted collections, and writes use the existing outbox. Requests
within a queued transaction run in dependency order: new notes/parents precede their
assignments/children. Retries retain the existing idempotent create/delete semantics.

**Secondary assignments retain only the deepest tags in each branch.** Selecting a
descendant replaces assigned secondary ancestors at every depth; siblings remain allowed.
The picker disables ancestors while a secondary descendant is assigned and shows which
selection makes them redundant. Removing the descendants makes the ancestor selectable
again without silently restoring it. Primary tags are independent: a Work primary and a
Projects secondary remain useful together. The shared normalization runs in optimistic
writes and on the server, accepts previously queued arrays, and also prunes redundancy
when a branch is reparented. It never rejects or clears a queued write for this rule.

**Primary color is derived.** A primary tag determines the displayed color through its
root, so changing a root's color or moving a branch recolors every assigned note without
fan-out writes. The note's existing `color` remains its plain-color fallback. Assigning a
primary clears that fallback to `default`. Selecting any unlinked color, including No
color, clears the primary while preserving secondary tags. Linking a color does not
retroactively tag old plain-color notes. Cards, editors and color search use derived colors.
Copies preserve assignments. Icons are a curated, bundled Lucide set that works offline.

**Deletion removes a branch and its assignments, never notes.** The server cleans secondary
arrays and clears affected primaries in the same transaction before deleting tags. Note
removal cascades its assignment row. Clients apply the same changes optimistically, but
send only the hierarchy edit: derived assignment cleanup is performed against current
server state, preserving unrelated assignments made on another device. Roots
cannot borrow another root's linked color; unlink or change that root first.

**Pickers and badges.** Linked swatches show the root icon (a generic tag when unset). A
selection commits immediately, then slides into children, so closing on a parent keeps it.
Switching between colors and tags slides the complete view. Within the tag tree, only the
list slides; the header stays in place while its selected badge resizes and crossfades.
The primary selector's measured height follows the surface spring as tree levels change
size. Secondary tree rows animate their height in flow when branches or search results
change; the panel follows those heights directly instead of running a second resize spring.
Extended dock panels anchor their contents to the bottom, so removing
a selected tag preview frees space above the palette while its height settles.
Closing rows stop accepting input immediately and remain in flow until their exit finishes.
A separate entry opens roots without colors. The note dock has a searchable secondary-tag
tree with checkboxes; selecting a child replaces its secondary ancestors. The tree
uses subtle vertical ancestry guides and rotating expand/collapse chevrons. Hierarchy data
is indexed once per snapshot, and search/collapse visibility is inherited in one tree pass.
Large trees keep measured placeholders for offscreen row contents, loading controls and
full paths near the viewport with a shared observer; there is no nesting-depth cutoff. Badges name
the assigned tag, with a frosted glass base, a fine border, a top highlight and a subtle
shadow above the note card. All badges tint the glass with their root's color and show
its icon beside the assigned tag's name. Hovering, keyboard focus or tapping reveals a
neutral glass tooltip containing the full hierarchy separated by slashes, with a border
in the tag's color.
Secondary-picker icons inherit their root's color, with contrast adjusted for each theme.
The full path remains their accessible label. Tree scroll areas use the shared custom
scrollbar, following the app’s platform-specific visibility rules.
Tags form one wrapping list with the primary first. They precede media and links, moving
to the right column when the note pane is wide enough. Settings > Tags creates, edits,
reparents and deletes branches. It shares the secondary picker’s searchable tree, ancestry
guides, colored icons and branch animations, with inline edit and management controls and
page scrolling instead of a dock-height limit.

**Search treats tags and colors as separate filters.** The landing page browses roots with
note counts and an Untagged option. A detached filter button replaces the compose button
on Search and opens an anchored glass panel with Colors and Tags tabs. A bottom segmented
control switches between them with horizontal slides and a bottom-anchored height spring; its last used tab
is validated and stored locally. Only tab changes add a resize spring, so tree branches
continue to animate in flow. The panel expands upward with the dock's surface spring.
Linked swatches show root icons and toggle that root's tag filter, matching both assignment
roles and descendants regardless of note color. Selecting a linked swatch clears any raw
color filter. Unlinked swatches still filter effective note color.
Tags reuses the dock's searchable tree, ancestry guides and animated branches, with its
search field at the bottom. The panel fits above the keyboard and closes on outside
interaction, Escape or Android back before leaving Search. Active badges stay above results
while the panel is closed. The tree selects tags at any depth; primary and secondary
assignments both match, and parents include every descendant. Multiple tags offer Any/All
matching, then intersect with text and any selected unlinked note color. No color means
the derived default color, independently of Untagged. Active filters can be removed
individually or together; results show their primary and secondary badges. Archived notes
are included and trashed notes excluded. Counts deduplicate each note within a branch.
Filtering and counts run over the synced collections and work offline.

**Backups include the complete relationship.** The generic Postgres dump and restore
already include both new tables (ADR 0012). Tests cover nested tags and assignments restored
with their notes. Old backups migrate to the current schema with empty tag tables.

## Compatibility and upgrade order

This feature requires new shapes and write endpoints without an older-server fallback,
so the client protocol is 2 and the supported server range is 2–2. Protocol-1 clients are
refused before writes or shape forwarding: they cannot safely clear/reassign primaries when
changing a note color. Protocol-2 clients pause against a protocol-1 server. Upgrade the
server, then clients; the existing protocol-aware clients preserve unsent edits while
waiting. Existing note shapes and their collection schemaVersion remain unchanged. Existing
note content and outbox payloads keep their format and replay losslessly after upgrading;
new collections start at schemaVersion 1. Explicit note color PATCH requests atomically clear
any current primary while preserving secondaries, including queued pre-tag color writes.
They remain plain-color choices; an explicit primary assignment is a separate queued write.
This server adapter preserves their intent without changing or resetting device data.
The assignment normalization and search refinements are part of this unpublished
protocol-2 feature; they require no additional protocol or shape-version bump. Existing
queued assignment arrays retain their format and are normalized on replay.
