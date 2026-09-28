# 0003: Design system and motion

Status: accepted (2026-09-27)

## Context

The first Android build was the desktop layout squeezed onto a phone: text ran under the
status bar, a header held three text tabs, and touch devices had no way to act on a note
without opening it. The redesign is phone-first, with desktop as the wide version of the same
layout.

## Decisions

**Look.** Graphite and legal-pad yellow: the pencil and paper a thought is caught with.
Neutrals are cool pencil-lead greys (not near-black, not cream); the icon's yellow is the only
accent. Titles use Bricolage Grotesque, everything else Figtree, both bundled so they work
offline. Note colors are generated in OKLCH with one lightness and chroma per theme, so text
contrast is the same on every color. Menus, sheets and the dock use frosted glass
(`glass`, `glass-thick`, `glass-bar` utilities in `styles.css`).

**Navigation.** A floating dock with three tabs (Gallery, Deck, Search) and a detached compose
button. Archive and Trash live in the Gallery title menu; Settings is a sheet behind the avatar.
Tabs replace history entries, so the back gesture leaves the app instead of cycling tabs.

**Motion.** [Motion](https://motion.dev) drives everything, with spring presets in
`src/lib/motion.ts`. Springs are interruptible, which is most of what makes the dock feel
native; CSS `linear()` springs can mimic the curve but not the interruption.

The card-to-editor transition is a hand-rolled container transform
(`NoteEditorOverlay`, `src/lib/noteTransition.ts`): the editor is translated onto the card and
clipped to its size, then both animate to full screen. Content is never scaled, so text stays
crisp, and the same progress value drives pull-to-dismiss. We chose this over the View
Transitions API, which cannot be interrupted or driven by a finger, and over Motion's
`layoutId`, whose scale-based projection distorts text between a card and a full screen.

**Haptics.** A small local Capacitor plugin (`HapticFeedbackPlugin.java`) calls
`View.performHapticFeedback`, which uses the device's tuned effects and respects the user's
touch-feedback setting. `@capacitor/haptics` plays raw vibration patterns instead (its
"selection" is a 100 ms buzz). Components call named events in `src/lib/haptics.ts`.

**Page transitions.** Moving between pages slides them a short way in the direction of
travel (Gallery, Archive, Trash, Deck, Search, left to right) using the View Transitions API
with transition types, set up once in the router (`pageTransition` in `lib/dockState.ts`).
It animates snapshots, so no transform lands on the page and fixed UI keeps working. The dock
has its own `view-transition-name` and shows live, so its own animations play on top. Opening a
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
quick note's footer, and in the editor's footer while the keyboard is up. It formats through
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
