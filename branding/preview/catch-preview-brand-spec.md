# Catch preview-channel icon extension

## 1. Purpose

Preview distribution uses the approved Gentle Drop icon with a restrained purple/indigo background. This treatment identifies preview launcher, PWA and browser icons. It defines no application UI colors or theme changes.

## 2. Relationship to stable

`../catch-icon-master.svg` and `../catch-brand-tokens.json` remain the canonical geometry and brand sources. Stable source files and the original stable ZIP are preserved. Preview SVGs are derived by substituting paint values and descriptive IDs/labels in the corresponding stable SVGs. Every shape, path, dimension, corner radius, transform, position, viewBox and element order is identical to its stable counterpart.

`catch-preview-brand-tokens.json` is an icon-only overlay. Its `palette` and `iconOverrides` are authoritative preview paint values. Relative paths resolve from this directory. `inheritsFrom` is a documented reference to stable values, not a claim that standard JSON readers automatically resolve or merge these files. Use the supplied derivation script or explicitly apply only the listed icon overrides. Do not merge this overlay into application UI tokens.

## 3. Preview palette

All colors are sRGB, with straight alpha and normal compositing. Alpha is applied once.

| Semantic name | HEX | RGB | Alpha | Use |
|---|---|---|---:|---|
| previewGradientStart | `#6654B0` | 102, 84, 176 | 1 | Background start: muted purple |
| previewGradientMid | `#504389` | 80, 67, 137 | 1 | Background 55% stop |
| previewGradientEnd | `#363166` | 54, 49, 102 | 1 | Background end: dark indigo |
| previewLandingShadow | `#18122E` | 24, 18, 46 | 0.22 | Primary preview landing ellipse only |

The stable gradient vector and stop positions are inherited exactly: `userSpaceOnUse`, `(0,768) → (1024,256)`; offsets `0`, `0.55`, `1`. The three preview colors replace those three stops. There is no additional highlight, glow, texture or blend mode.

The shadow inherits center `(514,820)`, radii `(275,45)` and Gaussian standard deviation `11`; only its tint and opacity change. The cool shadow avoids carrying the stable brown tint onto purple. It remains absent from small, favicon and adaptive artwork.

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

Stable and preview primary, small and favicon SVGs were rendered at 512, 192, 128, 64, 48, 32, 24 and 16 px, with the stable size rules used for the assigned exports.

| Sizes | Assigned variant | Observed behavior |
|---|---|---|
| 512, 192, 128 | Primary | Exact Gentle Drop silhouette and tilt; clear two lines and motion accents; restrained landing shadow. |
| 64, 48 | Small | Same stable simplifications; no shadow smear or motion specks. |
| 32, 24, 16 | Favicon | Purple background remains distinct from amber; two antialiased dark line clusters remain separated. |

The gradient is intentionally darker and less saturated than the generated board's bright violet. Cream-to-background contrast at the three stop colors is approximately 5.80:1, 8.01:1 and 11.22:1. These are color measurements for the artwork, not an application accessibility certification. At 16 px the card and purple tile are the dominant cues; preserve the same antialiasing and sampling approach as stable. Sixteen pixels remains the supplied minimum.

## 7. Android adaptive guidance

Reuse the existing foreground byte for byte and pair it with the preview background. The stable foreground's 0.76 scale about `(512,512)`, transparent canvas and conservative radius-312.89 safe circle are inherited. Both layers retain the 1024 square source viewBox for later conversion to the project's adaptive resources. The background has full bleed and no rounded tile; Android applies its mask. Circular and rounded-square proof composites were inspected using the shared foreground.

For a themed monochrome icon, reuse the stable knockout geometry and stable adaptive transform, and let Android supply the tint. A system-tinted monochrome icon cannot communicate the stable/preview distinction through the purple background. No additional symbol or geometry is authorized to solve that limitation.

## 8. Engineering handoff

Extract this extension alongside the stable package so the directory is `branding/preview/`. Keep the stable files at `branding/`. The extension intentionally depends on those files and contains no duplicate foreground or mono sources.

From the package root, run `python3 branding/preview/derive-preview-icons.py` to regenerate the four preview SVGs. Run the same command with `--check` to verify them without writing. The script resolves its dependencies relative to its own location. It verifies SHA-256 fingerprints of the referenced stable baseline, applies only listed paint/label substitutions, and checks that reversing the substitutions recovers the stable SVGs exactly. If stable sources later change, review the preview derivation before updating the fingerprints; do not silently maintain an independent geometry fork.

The later Codex integration task should mechanically generate preview PNGs, PWA icons, favicon assets, Android legacy launcher icons and adaptive background resources from these masters, pairing the latter with the shared foreground. Use preview-specific paths or channel build selection for distribution assets. Preserve stable icon outputs and configuration where required for the stable channel. Apply the existing size rules; preserve the source palette, gradient vector and stop positions, exact geometry, safe area, shadow geometry and variant omissions.

Codex must not reinterpret or redesign preview artwork. Do not change application note colors, page backgrounds, controls, typography, content cards, theme colors, general UI tokens or in-app accents to these preview colors. No codebase integration is included in this source extension.

## 9. Production decisions

1. Used the current stable source package as the exact geometry baseline, rather than tracing the preview board.
2. Selected muted purple and dark indigo production colors; ignored all printed board hex labels, including its different cream and charcoal labels.
3. Preserved the stable gradient direction and three-stop positions for a deterministic paint-only substitution.
4. Changed only the large icon's shadow tint and opacity to suit the dark background, retaining its exact shape, blur and placement.
5. Reused the stable adaptive foreground and mono marks; documented the themed-icon channel-differentiation limitation.
6. Supplied a small derivation script to prevent geometry drift. No raster artwork is used as source.
