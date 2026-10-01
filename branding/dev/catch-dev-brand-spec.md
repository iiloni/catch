# Catch dev-build icon extension

## 1. Purpose

The light-blue treatment identifies active development/testing builds, including local APKs. It is not an official public release channel or a separate Catch brand. Its scope is launcher/browser build identification; the application UI is unchanged.

## 2. Canonical relationship

`../catch-icon-master.svg` and `../catch-brand-tokens.json` remain the authoritative Gentle Drop geometry and shared colors. Each dev SVG derives from its corresponding stable SVG through explicit paint substitutions. Shape commands, corner radii, transforms, viewBox, optical placement, element order and sizing relationships are preserved exactly.

The approved dev board is a color-direction reference. Its card tilts in the opposite direction from the production stable master and it shows three motion capsules. Those inconsistencies are not carried into the dev sources: the canonical card remains 16.5° clockwise with exactly two motion marks. Printed board values are not production authority.

## 3. Relationship to preview

Stable is amber, preview is purple/indigo, and dev is light blue. Dev derives directly from stable geometry and does not depend on or overwrite preview files. Existing stable and preview source files remain byte-for-byte unchanged. The proof sheet compares the stable, saved preview and new dev treatments; subsequent preview integration changes in another codebase are outside this package.

## 4. Exact dev palette

Colors are sRGB with straight alpha and normal compositing. Apply alpha once.

| Semantic token | HEX | RGB | Alpha | Intended use |
|---|---|---|---:|---|
| devGradientStart | `#9AD6FA` | 154, 214, 250 | 1 | Light blue at the upper-left background |
| devGradientMid | `#69B3F4` | 105, 179, 244 | 1 | Background gradient 55% stop |
| devGradientEnd | `#3C86EC` | 60, 134, 236 | 1 | Deeper blue at the lower-right background |
| devLandingShadow | `#225E92` | 34, 94, 146 | 0.18 | Primary dev landing ellipse only |

Gradient: linear, `userSpaceOnUse`, vector `(0,0) → (1024,1024)`, offsets `0`, `0.55`, `1` in the table's order. This upper-left-to-lower-right direction follows the approved dev board. It intentionally overrides the stable gradient vector, not the tile or mark geometry. There is no highlight, glow, texture or new filter.

The landing shadow receives a cool blue tint to avoid a warm brown cast against blue. Its opacity remains the stable 18%; center `(514,820)`, radii `(275,45)`, Gaussian standard deviation `11` and normal blend mode remain unchanged.

## 5. Inherited geometry and colors

- Canvas and viewBox remain 1024 × 1024.
- Tile radius, note shape, 16.5° clockwise rotation, optical center, both lines, both motion capsules, landing ellipse geometry, blur and opacity are unchanged.
- Note and motion color: stable `colors.cream`, `#FFF9F0`, RGB 255/249/240, alpha 1.
- Line color: stable `colors.charcoal`, `#292B2D`, RGB 41/43/45, alpha 1.
- Clear space, adaptive foreground transform and safe area, small/favicon scales and omissions, and size thresholds are unchanged.

No adjustment to shared cream, charcoal or motion color was necessary. No lettering, badges, borders, extra accents, standalone mark or UI palette is introduced.

## 6. Asset usage

| Dev source | Stable source | Usage |
|---|---|---|
| `catch-icon-dev.svg` | `../catch-icon-master.svg` | Primary full-color dev icon at 128 px and above; also the PWA/web large-icon source |
| `catch-icon-dev-small.svg` | `../catch-icon-small.svg` | 48–127 px; canonical note/lines scaled 1.08, without motion or shadow |
| `catch-favicon-dev.svg` | `../catch-favicon-mark.svg` | 16–47 px; canonical note/lines scaled 1.18, without motion or shadow |
| `catch-adaptive-dev-background.svg` | `../catch-adaptive-background.svg` | Full-bleed blue adaptive background; no rounded tile |
| Reuse `../catch-adaptive-foreground.svg` | Unchanged shared source | Transparent adaptive foreground; no dev duplicate needed |
| Reuse `../catch-mark-mono-dark.svg` and `../catch-mark-mono-light.svg` | Unchanged shared sources | Single-color/themed geometry where needed |

A separate dev PWA SVG would duplicate the primary source, so none is included. Use the correct existing dev variant at each raster export size.

## 7. Small-size validation

The dev primary, small and favicon sources were rendered at 512, 192, 128, 64, 48, 32, 24 and 16 px. The assigned variants were compared with stable amber and saved preview purple at the same sizes.

| Size | Assigned variant | Observed behavior |
|---|---|---|
| 512, 192, 128 px | Primary | Same silhouette, clockwise tilt, two lines and two visible motion marks; shallow blue landing shadow. |
| 64, 48 px | Small | Readable cream card and charcoal lines; omitting motion and shadow prevents specks and smearing. |
| 32, 24, 16 px | Favicon | Light-blue tile remains distinct from amber and purple; two dark antialiased line clusters remain separated. |

Cream-to-background contrast at the start, middle and end stops is approximately 1.50:1, 2.14:1 and 3.45:1. The light-blue treatment intentionally has lower card/background contrast than the purple treatment; actual-size icon inspection confirmed the cream silhouette remains legible. Charcoal-to-cream contrast remains approximately 13.58:1. These are artwork measurements, not UI accessibility targets or a claim of WCAG conformance. Preserve the shared colors and antialiasing rather than adding an outline. Sixteen pixels is the practical minimum supplied size.

## 8. Android adaptive guidance

Pair the dev background with the shared stable foreground byte for byte. Preserve its 0.76 uniform scale about `(512,512)`, transparent canvas, and conservative safe-circle radius 312.89. Both sources retain a 1024-square viewBox for mechanical conversion to the project's layer format. Android supplies the final mask; the background must cover the entire layer. Circular and rounded-square composites were visually inspected.

Themed monochrome icons use shared stable knockout geometry and the existing adaptive transform, with the system supplying tint. Such icons do not communicate build identity through the blue background. No badge or geometry change is authorized to restore that color distinction.

## 9. Engineering handoff

Place this additive extension at `branding/dev/` alongside the existing stable and preview packages. Relative token references resolve from this directory.

`catch-dev-brand-tokens.json` contains only dev-specific paint values and supporting references. `palette` and `iconOverrides` are authoritative dev treatment values; inherited geometry and shared colors remain authoritative in the stable sources. `inheritsFrom` documents explicit inheritance; ordinary JSON readers do not automatically resolve or merge it. `applicationUiOverrides` is empty. Do not merge dev icon overrides into application themes.

From the package root, run `python3 branding/dev/derive-dev-icons.py` to regenerate the four SVGs, or add `--check` to verify without writing. Python 3.10 or later is required. The script resolves dependencies relative to itself, checks stable source SHA-256 fingerprints, and applies only the paint/gradient-vector/label substitutions. Reversing them must recover each stable SVG exactly. If stable files later change, review the derivation before updating source fingerprints; do not maintain an independent dev geometry fork.

The later Codex task should mechanically generate dev PNGs, local APK launcher assets, legacy Android icons, adaptive background resources, and development PWA/browser/favicons as required. Pair adaptive backgrounds with the shared foreground. Use existing build configuration to select these assets only for development/testing builds. Do not assume every debug build maps to a new official release channel.

Codex must not reinterpret or redesign these icons. It must preserve geometry, source colors, gradient vector/stops, shadow properties and size rules; must keep stable/preview sources and build identities intact; and must keep dev blue out of note colors, UI backgrounds, controls, buttons, typography, content cards, navigation, general UI tokens and in-app accents. No codebase integration is included here.

## 10. Production decisions

1. Kept canonical clockwise geometry and two motion marks despite inconsistent dev-board geometry.
2. Chose light-to-deeper blue values from the approved appearance rather than copying its printed labels. The lower-right blue is slightly restrained to keep the treatment calm.
3. Used the board's upper-left-to-lower-right gradient direction and retained stable stop positions.
4. Changed only the shadow tint; retained its stable opacity, shape, blur and position.
5. Reused adaptive foreground and monochrome assets, and omitted redundant web/PWA and standalone SVGs.
6. Supplied a small derivation script to prevent drift while preserving all existing source files.
