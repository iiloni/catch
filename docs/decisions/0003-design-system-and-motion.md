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

## Consequences

- Pages must not put a transform or filter on an ancestor of their fixed header or the dock.
- The editor shows a static preview while it animates and mounts BlockNote once it settles,
  so e2e tests wait for `[contenteditable]` before typing.
- Safe-area insets come from `--safe-*` tokens, which read Capacitor's injected variables and
  fall back to `env()`.
