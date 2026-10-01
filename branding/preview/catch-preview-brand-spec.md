# Catch preview-channel icon extension

## 1. Purpose

Preview distribution uses the approved Gentle Drop icon with a rich violet-to-indigo background matching the primary icon in the approved “Gentle Drop Preview” board. This corrects the earlier muted treatment. It identifies preview launcher, PWA and browser icons and defines no application UI colors or theme changes.

## 2. Relationship to stable

`../catch-icon-master.svg` and `../catch-brand-tokens.json` remain the canonical geometry and shared foreground color sources. Stable source files and assets are preserved. Preview SVGs are derived by substituting gradient colors and direction, shadow paint and descriptive IDs/labels in the corresponding stable SVGs. Every shape, path, dimension, corner radius, transform, position, viewBox and element order is identical to its stable counterpart.

`catch-preview-brand-tokens.json` is an icon-only overlay. Its `palette` and `iconOverrides` are authoritative preview paint values. Relative paths resolve from this directory. `inheritsFrom` is a documented reference to stable values, not a claim that standard JSON readers automatically resolve or merge these files. Use the supplied derivation script or explicitly apply only the listed icon overrides. Do not merge this overlay into application UI tokens.

## 3. Preview palette

All colors are sRGB, with straight alpha and normal compositing. Alpha is applied once.

| Semantic name | HEX | RGB | Alpha | Use |
|---|---|---|---:|---|
| previewGradientStart | `#8C68FF` | 140, 104, 255 | 1 | Background start, left: bright violet |
| previewGradientMid | `#6044CF` | 96, 68, 207 | 1 | Background 55% stop: saturated violet-indigo |
| previewGradientEnd | `#3B2AA6` | 59, 42, 166 | 1 | Background end, right: deep indigo |
| previewLandingShadow | `#231457` | 35, 20, 87 | 0.32 | Primary preview landing ellipse only |

The preview gradient is linear, `userSpaceOnUse`, left to right: `(0,512) → (1024,512)`; offsets `0`, `0.55`, `1`. Stop positions remain the stable positions; direction is an explicit preview paint override. There is no additional highlight, glow, texture or blend mode.

The board's printed `#7A5CFF` and `#3B2AA6` were evaluated against its primary artwork. Interior samples near the bright upper-left edge, away from antialiasing and foreground, include RGB `(140,106,252)` at image pixel `(105,280)` and `(137,102,252)` at `(130,280)`. These support the brighter `#8C68FF` production start rather than `#7A5CFF`. Right-side background samples include `(67,45,167)` at `(440,440)`, supporting the deep `#3B2AA6` endpoint. The middle stop retains that visible saturation. Coordinates refer to the supplied 1448 × 1086 PNG, “Catch Preview Icon System.png”.

The primary artwork keeps its left side violet at both the top and bottom and its right side indigo. A horizontal vector captures this distribution without the earlier stable vector's upper-left darkening. The board contains lighting variations that are not additional production layers. Its smaller examples, foreground labels, wordmark and shadow label are not geometry or foreground color specifications. The superseded `#6654B0`, `#504389` and `#363166` stops must not be used for this treatment.

The shadow inherits center `(514,820)`, radii `(275,45)` and Gaussian standard deviation `11`; only its tint and opacity change. The indigo tint at 32% opacity keeps the established soft ellipse visible on the brighter field. Alpha is applied once. It remains absent from small, favicon and adaptive artwork.

## 4. Inherited geometry and colors

- Canvas and viewBox: 1024 × 1024.
- Tile radius, card, 16.5° clockwise tilt, optical center, line positions, motion capsules and landing ellipse geometry: exact stable values.
- Cream: stable `colors.cream`, `#FFF9F0`, RGB 255/249/240, alpha 1. Used for the note and motion accents.
- Charcoal: stable `colors.charcoal`, `#292B2D`, RGB 41/43/45, alpha 1. Used for both note lines.
- Small and favicon enlargement factors, omissions, clear space, adaptive transform and safe area: exact stable values.

No foreground color adjustment was necessary. No wordmark, standalone mark, UI palette or new monochrome version is introduced.

## 5. Asset usage

| Preview asset | Stable geometry source | Use |
|---|---|---|
| `catch-icon-preview.svg` | `../catch-icon-master.svg` | Primary preview icon, 128 px and above |
| `catch-icon-preview-small.svg` | `../catch-icon-small.svg` | 48–127 px; same 1.08 card/line scale, no motion or shadow |
| `catch-favicon-preview.svg` | `../catch-favicon-mark.svg` | 16–47 px; same 1.18 card/line scale, no motion or shadow |
| `catch-adaptive-preview-background.svg` | `../catch-adaptive-background.svg` | Full-bleed purple gradient for Android adaptive background |
| Reuse `../catch-adaptive-foreground.svg` | Unchanged stable file | Android adaptive foreground; no preview copy needed |
| Reuse `../catch-mark-mono-dark.svg` and `../catch-mark-mono-light.svg` | Unchanged stable files | Single-color marks and source for themed launcher geometry |

## 6. Small-size checks

Corrected and previous preview primary, small and favicon SVGs were rendered at 512, 192, 128, 64, 48, 32, 24 and 16 px, with the stable size rules used for the assigned exports and the board's primary icon beside them as the appearance reference.

| Sizes | Assigned variant | Observed behavior |
|---|---|---|
| 512, 192, 128 | Primary | Exact Gentle Drop silhouette and tilt; clear two lines and motion accents; soft indigo landing shadow. |
| 64, 48 | Small | Same stable simplifications; no shadow smear or motion specks. |
| 32, 24, 16 | Favicon | Brighter violet and deep indigo remain visible; two antialiased dark line clusters remain separated. |

The corrected, previous preview and approved primary reference were compared beside one another at all eight sizes. The correction is visibly brighter and more saturated in both the SVG renders and generated browser/launcher outputs. Cream-to-background contrast at the three stop colors is approximately 3.62:1, 6.22:1 and 9.70:1. These are color measurements for the artwork, not an application accessibility certification. At 16 px the card and violet tile are the dominant cues; preserve the same antialiasing and sampling approach as stable. Sixteen pixels remains the supplied minimum. Small and favicon variants retain their stable omissions, regardless of detail shown in the board's small examples.

## 7. Android adaptive guidance

Reuse the existing foreground byte for byte and pair it with the preview background. The stable foreground's 0.76 scale about `(512,512)`, transparent canvas and conservative radius-312.89 safe circle are inherited. Both layers retain the 1024 square source viewBox for later conversion to the project's adaptive resources. The background has full bleed and no rounded tile; Android applies its mask. Circular and rounded-square proof composites were inspected using the shared foreground.

For a themed monochrome icon, reuse the stable knockout geometry and stable adaptive transform, and let Android supply the tint. A system-tinted monochrome icon cannot communicate the stable/preview distinction through the purple background. No additional symbol or geometry is authorized to solve that limitation.

## 8. Engineering handoff

The integrated overlay lives in `branding/preview/`, alongside the stable sources in `branding/`. It intentionally depends on those files and contains no duplicate foreground or mono sources.

From the repository root, run `python3 branding/preview/derive-preview-icons.py` to regenerate the four preview SVGs. Run the same command with `--check` to verify them without writing. The script resolves its dependencies relative to its own location. It verifies SHA-256 fingerprints of the referenced stable baseline, checks HEX/RGB pairs and shadow alpha, retains stable stop positions and gradient type, applies only listed gradient/paint/label substitutions, and checks that reversing the substitutions recovers the stable SVGs exactly. If stable sources later change, review the preview derivation before updating the fingerprints; do not silently maintain an independent geometry fork.

Run `./scripts/generate-brand-assets.sh preview` to derive and check the SVGs, then regenerate preview PNGs, PWA icons, favicon assets, Android legacy launcher icons and adaptive background resources. The existing pipeline renders SVGs and resizes with Lanczos; raster files are outputs, never sources. It pairs the adaptive background with the unchanged shared foreground and retains existing resource names and `/preview/` browser paths. Do not run stable regeneration for a preview-only correction. See `../../docs/branding.md` for channel builds and resource selection.

Do not change application note colors, page backgrounds, controls, typography, content cards, theme colors, general UI tokens or in-app accents to these preview colors. Do not introduce badges, letters, a new wordmark or redesigned geometry.

## 9. Production decisions

1. Used the current stable source package as the exact geometry baseline, rather than tracing the preview board.
2. Selected bright violet and deep indigo from the primary artwork; used printed gradient labels as candidates, while preserving the stable cream and charcoal values.
3. Kept the stable three-stop positions and explicitly overrode the gradient vector to match the primary reference's left-to-right appearance.
4. Changed only the large icon's shadow tint and opacity to suit the corrected background, retaining its exact shape, blur and placement.
5. Reused the stable adaptive foreground and mono marks; documented the themed-icon channel-differentiation limitation.
6. Supplied a small derivation script to prevent geometry drift. No raster artwork is used as source.
