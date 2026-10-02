# 0003: Design system and motion

Status: accepted (2026-09-27)

## Context

The first Android build was the desktop layout squeezed onto a phone: text ran under the
status bar, a header held three text tabs, and touch devices had no way to act on a note
without opening it. The redesign is phone-first, with desktop as the wide version of the same
layout.

## Decisions

**Look.** The approved Gentle Drop mark in `branding/` supplies a three-stop amber gradient
(`#FFE174`, `#FFC247`, `#FFA32B`), a cream card with two charcoal lines, and two motion marks.
The supplied small and favicon variants simplify it at their defined raster sizes, while
the supplied foreground and background SVGs form the Android adaptive icon. The approved
icon/wordmark lockups use complete primary artwork at every displayed size, preserving
both motion marks and the landing shadow; size-based simplification applies to icon-only
fallbacks. The 28 px header icon has a roughly 97 px tight horizontal lockup, above the
revised 96 px minimum recorded in the wordmark tokens. The approved
middle amber (`--brand`) colors controls and focus, and the gradient marks the icon and
compose button. Warm graphite neutrals give both light and dark
themes a quiet canvas. Titles use Bricolage Grotesque, everything else Figtree, both bundled so they work
offline. Note colors are generated in OKLCH with one lightness and chroma per theme, so text
contrast is the same on every color. Menus, sheets and the dock use frosted glass
(`glass`, `glass-thick`, `glass-bar` utilities in `styles.css`).

**Navigation.** A floating dock with three icon-only tabs (Deck, Gallery, Search) and a detached compose
button. Tapping Gallery while on a gallery page shows a separate segmented control
floating above the dock for Gallery, Archive and Trash (`GallerySwitcher`); holding Gallery opens it and
lets the finger slide straight onto a segment.
Settings is a page of its own (`/settings/<page>`) behind the gear in the Gallery's header,
split into User and admin-only Admin sections (ADR 0011), with pages listed in
`SETTINGS_TABS` (`src/lib/settings.ts`), each a route file under
`routes/_app/settings/`. On phones it shows one page at a time: the dock's tabs become a
selector naming the open page and the compose button becomes a back button. Tapping the
selector floats a card of the pages above the dock (`SettingsTabPicker`), and holding it (or
sliding off it) opens the card under the finger, so letting go on a page picks it. From 768 px
the pages are listed in a column beside the open one, the dock steps aside, and the header
holds the back button. Opening Settings pushes a history entry and switching pages replaces
it, so back leaves Settings in one step.
Sheets float above the bottom safe area or keyboard with a small gap and rounded corners on
all sides, so they do not meet the keyboard's rounded top edge.
Tabs replace history entries, so the back gesture leaves the app instead of cycling tabs.
While a note is open the dock stays put and becomes the note's toolbar (`NoteDock`: color,
attachments, move, pin); the color button grows the dock upward into a palette, and archive/unarchive and trash
live in the editor's top right. Tapping the move button grows the dock upward into a destination picker: Deck columns
stack in a wider left column, with one full-height Gallery target on the right. A brand
border and check mark show the current location. The move button also shows its location:
a dashboard for Gallery, or columns with the current column's accent line underneath. Holding the button (or sliding off it)
also opens the picker, and letting go on a destination moves the note there. Desktop
card toolbars open the same picker in a floating glass popover, like the color selector,
so choosing a destination does not resize the card. The editor therefore is a non-modal dialog, with the page
behind it made `inert`.

On phones the note scrolls behind its floating back and trash controls, with the Gallery's
masked edge blurs at the top and above the keyboard at the bottom. The centered glass sync
pill slides down from the top while writes are pending and stays for two seconds after they
finish before sliding away; save failures remain visible. Its measured width follows the
same spring as the header toolbars while its icon and text crossfade. The edited timestamp
follows the note content, centered in the scroll area.
The pill's slide is clipped at the header's safe top edge, so it never draws over Android's
status bar. Motion uses pixel translations within that clip instead of resolving a
percentage/calc transform against changing native insets.

**Header toolbars.** Page controls sit in toolbars in the header's top corners (the
Gallery's sort and settings, the Deck's column editor, Archive and Trash's back button and
Empty trash). A toolbar grows out of its corner when it gets controls, and when its controls
change it animates its width (never scale) to fit the new ones while the old ones fade out.
The dock's pages (Gallery, Deck, Search) share `TabPageHeader`: a large centered title that
moves into the top left corner as a glass pill once the page starts to scroll. It follows
the page for the first 16 px and then leaves for the corner, while it is still below the
header's row: on a phone the centered title is wider than the gap between the corners, so
riding the page up to the row ran it into the controls on the right. Until then
their top right controls are flat buttons on the page, and they gain the same glass as the
title does. Selecting notes always shows the glass.
The stable horizontal Catch lockup sits fixed in the header's top left corner on these
three pages, and fades out as the title becomes a pill in that corner. It does not scroll
with the page, which would carry it under the system status bar.
It reserves room for the right toolbar (including sync status), using icon-only branding
when a narrow page pane cannot fit the minimum lockup width. Selection hides the branding
so the count and selection actions have the corners to themselves.

**Selection.** As in Keep, a long press on a card in the Gallery, Deck, Archive or Trash
selects it (in the Gallery and Deck, the same press picks it up to rearrange it), and while
any note is selected a tap selects or deselects one instead of opening it. With a mouse, a
check at the card's corner appears on hover. A close button with the count takes the top
left, and the selection's actions (`SelectionToolbar`) take the top right toolbar: color,
archive, move to trash and copy, with Send to gallery in the Deck, Unarchive in the Archive,
and Restore and Delete forever in the Trash. Back and Escape end selecting.

In the Deck, dragging a card while notes are selected gathers the whole selection: the other
cards fold out of their columns and fly into a stack under the finger, with the count on it.
Dropping the stack in a column places the notes there together, in board order, and ends
selecting. While any card is held, "Send to gallery" and "Cancel" targets float above the
dock, Cancel nearest it; dropping on Cancel changes nothing and keeps the selection.

**Wide screens.** On tablets and unfolded foldables (at least 672 × 480 px) an open note
opens in a pane beside the page instead of covering it, as in a list-detail layout. The page
stays usable: it keeps its own dock (tabs and compose), the note gets a second dock under its
pane, and the note itself is a large rounded card between its back and trash toolbars at the
top and that dock at the bottom, so it reads as the page's card opened up. Tapping another card swaps the pane's note in place (replacing the history entry, so
back still closes the note in one step). A grip in the gutter resizes the split; the page keeps
at least 280 px and a quarter of the screen, the note at least 340 px, and the page's share is
saved so it survives rotation and unfolding. The pane does not use the container transform:
opening it narrows the page, which moves the card it would grow from, so a morph chases a moving
target and two morphs cross when switching notes. Instead the pane slides in from the screen's
edge and back out (`paneReveal`), and a note opened while another is showing fades in over it.
The page takes its new width at once, so its cards reshuffle once under the moving pane, while
fixed UI over the page follows the pane's edge through `--note-pane` (`src/lib/splitView.ts`).
The Deck does not split: its columns need the whole width, so a note opened there pops up
over the board as a centered panel, as on other wide screens (`canSplit` takes the page).
The Gallery pages and Search split. Landscape phones are too short for two panes and keep the centered
panel.

**Motion.** [Motion](https://motion.dev) drives everything, with spring presets in
`src/lib/motion.ts`. Springs are interruptible, which is most of what makes the dock feel
native; CSS `linear()` springs can mimic the curve but not the interruption.

The card-to-editor transition is a hand-rolled container transform
(`NoteEditorOverlay`, `src/lib/noteTransition.ts`): the editor is translated onto the card and
clipped to its size, then both animate to full screen. The backing surface contains both the
editor and the card, which can be taller than the viewport; the editor keeps its own viewport
while the clip animates. Content is never scaled, so text stays crisp. It runs on the main
thread, where mounting the editor competes with it, so it waits for
the mounted surface to be painted (still looking like the card) and then advances by frames
rather than by the clock (`animateSteady`): a late frame delays it instead of skipping part of
it. Opening and closing a note are navigations that leave the page's scroll alone
(`lib/openNote.ts`); the router's default is to scroll to the top, away from the card.
A note whose card is off screen when it closes (editing re-sorted it, or the grid no
longer renders it) fades out in place, as after archiving, rather than jumping the page to
the card. A capped vertical drag dismisses the editor when the note is scrolled to the matching
edge, with a haptic tick at the release threshold. We chose this over the View
Transitions API, which cannot be interrupted or driven by a finger, and over Motion's
`layoutId`, whose scale-based projection distorts text between a card and a full screen.
The page header fades above the moving card over the card face's part of the morph, so a
returning card settles behind the title pill without changing their order in one frame.
It is hidden while the editor covers the page; beside a split pane it stays visible in its
usual layer. The container keeps opacity 1 throughout: `--header-opacity` fades the glass
layers and their foreground separately (`header-fade`). Fading a blur's ancestor makes a
backdrop root, cutting off the page until opacity reaches 1 and causing the blur to pop on.

**Haptics.** A small local Capacitor plugin (`HapticFeedbackPlugin.java`) calls
`View.performHapticFeedback`, which uses the device's tuned effects and respects the user's
touch-feedback setting. `@capacitor/haptics` plays raw vibration patterns instead (its
"selection" is a 100 ms buzz). Components call named events in `src/lib/haptics.ts`.

**Cold starts.** The document starts on the saved theme's canvas, without an additional
in-app splash or a wait for fonts or sync. Header content and notes fade in with a 10 px
settle as they arrive; grid cards start after their existing measurement step. The dock
only translates, keeping opacity 1 so its glass continues to blur the page. These 420 ms
entries use a gentler ease than the page transitions, keeping more of the fade visible
instead of reaching near-full opacity early. They use `animateSteady`, so startup work
cannot skip ahead through the animation.
Starts are staggered from top to bottom in 20 ms steps, capped at 120 ms: the brand and
header controls start first, followed by the title and content, then the dock. Grid cards
use their existing layout positions, so the stagger adds no per-card DOM measurement.
The short delays advance in the same frame loop, preserving the stagger during busy frames.
Entries run once per element identity in a document, rather than replaying when virtualized
cards or routes remount. They never block input or wait for other content, and reduced motion
shows elements immediately. Fixed headers and the dock have no animated page ancestor.

**Page transitions.** Moving between pages slides them a short way in the direction of
travel (Deck, Gallery, Archive, Trash, Search, left to right) using the View Transitions API
with transition types, set up once in the router (`pageTransition` in `lib/dockState.ts`).
It animates snapshots, so no transform lands on the page and fixed UI keeps working. The dock
gets a `view-transition-name` only while a transition runs and shows live, so its own
animations play on top. A named element is a backdrop root, so a permanent name would stop
the dock's glass from blurring the page behind it. Opening a
note changes only the search params and gets no page transition.

**Keyboard.** Resizing the page for the on-screen keyboard happens in one jump once the
keyboard has finished moving. Instead, `KeyboardInsetsPlugin.java` owns the window insets:
the WebView never sees the keyboard inset (so it keeps its size), each keyboard animation is
reported once with its duration and sampled easing curve, and `src/lib/keyboard.ts` replays
it on the `--keyboard` variable. Chromium browsers get the same with the VirtualKeyboard API.
The plugin also injects the `--safe-area-inset-*` variables, so Capacitor's SystemBars inset
handling is disabled.

**Attachments.** The paperclip grows a 2×2 picker upward from the dock, including from the
formatting row while the keyboard is up (ADR 0010).

**Formatting on touch.** BlockNote's selection toolbar is turned off on coarse pointers (on
Android it slides in from the top of the screen). `FormattingBar` takes its place: in the
quick note's footer, and in the dock (in place of the note's actions) while the keyboard is
up in the editor. It formats through
a small `EditorControls` handle, so it does not import BlockNote, and its buttons never take
focus, so the keyboard stays up.

**Quick-note gestures.** A vertical touch swipe can start anywhere on the quick-note window:
down saves, up expands. Its editor scrolls first when there is content left in that direction;
reaching an edge during that scroll does not turn the same gesture into a swipe. Horizontal
gestures, native form fields, selected text and long presses stay with editing and tools.
Short pulls retain focus, and a recognized swipe suppresses the tool click beneath it.
Mouse dragging remains on the top handle.
Eligible touch pulls are claimed on the first small vertical movement, before Android takes
over native scrolling and makes later moves non-cancelable. The longer release distance still
decides whether a pull saves or expands.
Touch listeners follow the original touched element for the whole gesture: Android caret
changes can replace an editor node, and subsequent events no longer bubble through the window.

**Undo and redo.** The note editor uses BlockNote's history through `EditorControls`.
Its toolbar appears once an edit can be undone, and stays available while there is undo or
redo history. From 640 px it sits beside the back button, including in narrow split panes.
It is positioned outside the header's flow so it never moves the centered sync pill.
Split panes narrower than 480 px show the sync pill's icon with an accessible status label
and a tooltip, leaving room for every header control. On phones the history toolbar floats
at the dock's right edge above either the note actions or formatting bar.
Keyboard scrolling keeps the caret's line above this toolbar too,
with enough bottom padding to reach the note's last line.
The toolbar slides in from the top in the header or the right above the dock with `springs.smooth`,
matching the sync pill, and skips animation when reduced motion is requested. Its final
footprint is reserved for caret scrolling during the slide.

**Lists on touch.** Editor checkboxes have a 24 px box inside a 44 px touch target. Cards use
the same checkbox styling at 16 px; the opening preview matches the editor's row sizes,
text spacing and indentation so mounting the editor does not move the content. Native
inputs retain checkbox semantics and keyboard support, with their appearance styled locally.
Holding a checklist, bullet or numbered item for 350 ms picks it up for reordering within
its sibling group, with its nested children. Moving before the hold expires scrolls as
usual; checkbox taps keep toggling, and links keep opening. A drop marker and edge scrolling
guide the move, which is committed as one undo step on release. The mouse drag handle
remains available.

Block menu handles sit in a compact 40 px gutter on touch screens, with a 32 px button and
a 4 px gap before the block. Their
vertical position follows the rendered first line, including larger headings and touch-sized
lists. The editor's opening preview and link insets share that gutter so mounting it does not
shift the content.

## Consequences

- Pages must not put a transform or filter on an ancestor of their fixed header or the dock.
- The editor shows a static preview while it animates and mounts BlockNote once it settles,
  so e2e tests wait for `[contenteditable]` before typing.
- Safe-area insets come from `--safe-*` tokens, which read the variables injected by
  `KeyboardInsetsPlugin` and fall back to `env()`.
- The page is not resized for the keyboard. UI pinned to the bottom, including sheets,
  clears it with `var(--keyboard)` (`--dock-bottom` and `--dock-space` already do). Sheets
  also limit their height to the space above the keyboard and scroll focused fields into view.
  The browser no longer
  scrolls focused fields above it on its own.
