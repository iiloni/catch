# 0003: Design system and motion

Status: accepted (2026-09-27)

## Context

The first Android build was the desktop layout squeezed onto a phone: text ran under the
status bar, a header held three text tabs, and touch devices had no way to act on a note
without opening it. The redesign is phone-first, with desktop as the wide version of the same
layout.

## Decisions

**Look.** The original Catch hand-and-note mark supplies a yellow-to-orange sunrise (`#ffdc5c`
to `#ff930f`). The icon is redrawn as a simpler vector for small launchers, with one note fold
and fewer hand details. A solid golden middle tone (`--brand`) colors controls and focus while
the gradient marks the icon and compose button. Warm graphite neutrals give both light and dark
themes a quiet canvas. Titles use Bricolage Grotesque, everything else Figtree, both bundled so they work
offline. Note colors are generated in OKLCH with one lightness and chroma per theme, so text
contrast is the same on every color. Menus, sheets and the dock use frosted glass
(`glass`, `glass-thick`, `glass-bar` utilities in `styles.css`).

**Navigation.** A floating dock with three icon-only tabs (Deck, Gallery, Search) and a detached compose
button. Tapping Gallery while on a gallery page shows a separate segmented control
floating above the dock for Gallery, Archive and Trash (`GallerySwitcher`); holding Gallery opens it and
lets the finger slide straight onto a segment. Settings is a sheet behind the gear in the
page header.
Tabs replace history entries, so the back gesture leaves the app instead of cycling tabs.
While a note is open the dock stays put and becomes the note's toolbar (`NoteDock`: color,
pin, deck, archive); the color button grows the dock upward into a palette, and trashing
lives in the editor's top right. The editor therefore is a non-modal dialog, with the page
behind it made `inert`.

**Wide screens.** On tablets and unfolded foldables (at least 672 × 480 px) an open note
opens in a pane beside the page instead of covering it, as in a list-detail layout. The page
stays usable: it keeps its own dock (tabs and compose), the note gets a second dock under its
pane, and tapping another card swaps the pane's note in place (replacing the history entry, so
back still closes the note in one step). A grip in the gutter resizes the split; the page keeps
at least 280 px and a quarter of the screen, the note at least 340 px, and the page's share is
saved so it survives rotation and unfolding. The pane does not use the container transform:
opening it narrows the page, which moves the card it would grow from, so a morph chases a moving
target and two morphs cross when switching notes. Instead the pane slides in from the screen's
edge and back out (`paneReveal`), and a note opened while another is showing fades in over it.
The page takes its new width at once, so its cards reshuffle once under the moving pane, while
fixed UI over the page follows the pane's edge through `--note-pane` (`src/lib/splitView.ts`).
The deck's columns switch on container width rather than the viewport. Landscape phones are too short for two panes and keep the centered
panel.

**Motion.** [Motion](https://motion.dev) drives everything, with spring presets in
`src/lib/motion.ts`. Springs are interruptible, which is most of what makes the dock feel
native; CSS `linear()` springs can mimic the curve but not the interruption.

The card-to-editor transition is a hand-rolled container transform
(`NoteEditorOverlay`, `src/lib/noteTransition.ts`): the editor is translated onto the card and
clipped to its size, then both animate to full screen. Content is never scaled, so text stays
crisp. A capped vertical drag dismisses the editor when the note is scrolled to the matching
edge, with a haptic tick at the release threshold. We chose this over the View
Transitions API, which cannot be interrupted or driven by a finger, and over Motion's
`layoutId`, whose scale-based projection distorts text between a card and a full screen.

**Haptics.** A small local Capacitor plugin (`HapticFeedbackPlugin.java`) calls
`View.performHapticFeedback`, which uses the device's tuned effects and respects the user's
touch-feedback setting. `@capacitor/haptics` plays raw vibration patterns instead (its
"selection" is a 100 ms buzz). Components call named events in `src/lib/haptics.ts`.

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

**Formatting on touch.** BlockNote's selection toolbar is turned off on coarse pointers (on
Android it slides in from the top of the screen). `FormattingBar` takes its place: in the
quick note's footer, and in the dock (in place of the note's actions) while the keyboard is
up in the editor. It formats through
a small `EditorControls` handle, so it does not import BlockNote, and its buttons never take
focus, so the keyboard stays up.

## Consequences

- Pages must not put a transform or filter on an ancestor of their fixed header or the dock.
- The editor shows a static preview while it animates and mounts BlockNote once it settles,
  so e2e tests wait for `[contenteditable]` before typing.
- Safe-area insets come from `--safe-*` tokens, which read the variables injected by
  `KeyboardInsetsPlugin` and fall back to `env()`.
- The page is not resized for the keyboard. UI pinned to the bottom clears it with
  `var(--keyboard)` (`--dock-bottom` and `--dock-space` already do), and the browser no longer
  scrolls focused fields above it on its own.
