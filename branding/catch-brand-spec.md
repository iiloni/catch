# Catch — Gentle Drop production brand source

## 1. Finalized visual direction

An amber rounded tile holds a cream note card, tipped **16.5° clockwise**. Two charcoal lines make the card legible as a note. Two cream motion strokes sit above and left of the note; a shallow warm shadow suggests a soft landing. The geometry is intentionally flat and calm. No wordmark or UI accent palette is defined by this package.

The concept board supplied the composition, not measurable artwork. Its labeled swatch hex values are not source values. `catch-icon-master.svg` and the matching constants in `catch-brand-tokens.json` are the production source of truth.

## 2. Normalization decisions

| Reference ambiguity | Final decision |
|---|---|
| Card scale and angle change across the board | One 510 × 490 card, center (520, 505), 16.5° clockwise. |
| Rounded-square tile and card corners vary | Tile radius 210; card radius 56. Both are simple circular corner arcs. |
| Lines vary in length and alignment | Same left edge at local x = −145; upper width 300, lower width 278; both 50 high. |
| Marks shift between examples | Two rounded capsules with fixed absolute coordinates and rotation pivots below. |
| Shadow varies from hard orange ellipse to soft gray | One blurred warm brown ellipse only in the large primary icon. No card drop shadow. |
| Gradient and highlight appear inconsistent | One explicit three-stop linear gradient; no specular highlight or texture. |
| Small example retains tiny accents inconsistently | Small and favicon retain the card and two lines, omit marks and shadow to avoid specks. |

## 3. Exact production palette

The following are sRGB colors; alpha is straight/unpremultiplied. `normal` is the only blend mode.

| Semantic token | HEX | RGB | Alpha | Use |
|---|---|---|---:|---|
| amberLight | `#FFE174` | 255, 225, 116 | 1.00 | Gradient start, lower left |
| amberPrimary | `#FFC247` | 255, 194, 71 | 1.00 | Primary amber; gradient 55% |
| amberDeep | `#FFA32B` | 255, 163, 43 | 1.00 | Gradient end, upper right; solid fallback |
| cream | `#FFF9F0` | 255, 249, 240 | 1.00 | Card and motion capsules |
| charcoal | `#292B2D` | 41, 43, 45 | 1.00 | Two card lines; dark mono |
| landingShadow | `#A84E12` | 168, 78, 18 | 0.18 | Primary ellipse only |

Gradient: `linearGradient`, `gradientUnits=userSpaceOnUse`, vector `(0,768) → (1024,256)`, stops `0.00 amberLight`, `0.55 amberPrimary`, `1.00 amberDeep`. The gradient is clipped by the master tile and fills the entire adaptive background layer. There is no separate highlight. The landing ellipse uses `normal` compositing with 18% opacity and Gaussian standard deviation 11 user units; no other shadow or blend effect is canonical. Blue, peach, mint and lavender on the exploration board are not authorized production colors here.

## 4. Exact construction on a 1024 × 1024 canvas

SVG coordinates have origin at upper left; positive SVG rotation is clockwise. Percentages are of the 1024-unit canvas. Rectangles use circular `rx` corners. All dimensions below are SVG user units.

| Element | Measurements | Canvas proportion |
|---|---|---|
| Tile | `(x,y)=(0,0)`, `1024 × 1024`, `rx=210` | radius 20.51% |
| Card | local rect `(-255,-245,510,490)`, `rx=56`; group `translate(520 505) rotate(16.5)` | center (50.78%,49.32%), size (49.80%,47.85%), radius 5.47% |
| Upper line | card-local `(-145,-48,300,50)`, `rx=25` | width 29.30%, height 4.88% |
| Lower line | card-local `(-145,68,278,50)`, `rx=25` | width 27.15%, height 4.88% |
| Line separation | 66 clear units vertically in card-local coordinates; top-edge pitch 116 | 6.45% clear gap |
| Upper motion mark | `(220,256,48,98)`, `rx=24`, rotate `−24°` about `(244,305)` | size (4.69%,9.57%) |
| Left motion mark | `(131,376,116,48)`, `rx=24`, rotate `28°` about `(189,400)` | size (11.33%,4.69%) |
| Landing ellipse | center `(514,820)`, radii `(275,45)`, Gaussian σ `11`, color `landingShadow` at 0.18 | center (50.20%,80.08%), full size (53.71%,8.79%) |

The card and its lines share one transform. The intentionally slight right and upward optical offset compensates for the two upper-left motion marks and low shadow. Keep the SVG element order: tile, shadow, motion marks, card. The minimum recommended clear space beyond the tile is 96 units (9.375% of tile width) when it is placed as a brand graphic; do not add this space inside a raster icon export.

## 5. Variant usage

| SVG | Use | Deterministic difference from canonical master |
|---|---|---|
| `catch-icon-master.svg` | Primary full-color icon at 128 px and above | Entire canonical composition. |
| `catch-icon-small.svg` | 48–127 px | Same tile/gradient; canonical card-and-lines group uniformly scaled 1.08 about (520,505); no motion marks or shadow. |
| `catch-favicon-mark.svg` | 16–47 px, especially browser favicon | Same tile/gradient; canonical card-and-lines group uniformly scaled 1.18 about (520,505); no motion marks or shadow. |
| `catch-mark-mono-dark.svg` | Single-color applications on light backgrounds | Canonical card and marks, charcoal; both note lines are transparent knockouts; tile and shadow omitted. |
| `catch-mark-mono-light.svg` | Single-color applications on dark backgrounds | Same geometry and knockouts in cream; tile and shadow omitted. |
| `catch-adaptive-foreground.svg` | Android adaptive foreground only | Canonical motion/card/lines uniformly scaled 0.76 about (512,512), with transparent canvas; tile and shadow omitted. |
| `catch-adaptive-background.svg` | Android adaptive background only | Full bleed canonical gradient, no rounded corners. |

A colored standalone transparent mark is omitted. Cream alone disappears on light surfaces; a new outline or forced amber backdrop would change the approved icon. Use one of the two monochrome marks according to the surrounding color instead.

## 6. Small-size behavior

Export at exact target pixel dimensions with antialiasing and sRGB color handling. Use the primary at **≥128 px**, the small variant at **48–127 px**, and the favicon version at **16–47 px**. At 16 px the two lines are necessarily about one pixel high; preserve them and inspect the final favicon in its actual browser context. Do not synthesize a third line or sharpen with a dark halo. These thresholds apply to raster dimensions, not CSS scaling of a larger raster. The vectors themselves may be used at arbitrary display sizes.

The simplified variants enlarge only the existing card-and-lines group. Removing the small capsules and soft ellipse prevents them from becoming isolated pixels or a muddy smear. The note remains clockwise tilted with two separate strokes.

Rendered-size inspection (sRGB PNG previews, each exported directly at target dimensions):

| Export size | Assigned source | Inspection result |
|---:|---|---|
| 512, 192, 128 px | Primary | Clear card silhouette, clockwise tilt, distinct lines and paired motion marks; landing shadow remains restrained. |
| 64, 48 px | Small | Card and separate lines remain readable; no detached specks or muddy shadow. |
| 32, 24 px | Favicon | Larger card improves contrast and line separation; tilt remains visible. |
| 16 px | Favicon | Both dark strokes survive as separate antialiased pixel clusters; card is the dominant silhouette. This is the practical lower limit of the supplied artwork. |

## 7. Android adaptive-icon guidance

Android's adaptive icon layers are 108 × 108 dp; the [Android adaptive icon design guide](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive) describes a centered 66 × 66 dp safe area for the foreground mark. Conservatively inscribe the essential mark within a centered circle of radius 312.89 on this 1024-unit canvas. The foreground's 0.76 transform keeps the card, both lines, and both motion capsules inside it. The foreground remains transparent outside those elements. Do not put a rounded tile, full-size icon bitmap, or shadow in that layer. The separate background covers all 1024 units with the canonical gradient; the system supplies the final mask. A themed monochrome layer may be generated from the transparent knockout geometry of `catch-mark-mono-light.svg`, applying the same 0.76 foreground transform and letting Android control its tint.

In a 512 px proof render, the farthest painted foreground pixel was approximately 152.2 px from center versus a 156.4 px safe radius. The later engineering pass must preview circular and rounded-square launcher masks at actual launcher sizes and adjust raster export sampling if necessary. It must not rescale or reposition the vector elements to accommodate an arbitrary mask.

## 8. Decision log

1. Kept the amber tile, cream card, two dark strokes, paired motion capsules, and landing ellipse from the approved composition.
2. Chose one reproducible rotation and note geometry instead of tracing softened raster edges.
3. Chose a single warm gradient and flat cream card; discarded the board's inconsistent lighting and unapproved UI accent swatches.
4. Omitted a card shadow and restricted the landing ellipse to the primary large-size icon.
5. Omitted decorative elements at small sizes; used controlled scale factors on canonical geometry.
6. Omitted the colored standalone mark because its contrast would be background-dependent.
7. Separated adaptive foreground and full-bleed background, and reduced the foreground uniformly for the mask safe area.

## 9. Engineering handoff

**Canonical artwork:** `catch-icon-master.svg`. All geometry, color, gradient, shadow and variant parameters in `catch-brand-tokens.json` are authoritative; the prose spec explains their intent. If a machine needs exact shape commands, read the SVG paths/rectangles. The other SVGs are derived variants with the transformations and omissions in the token file. Do not independently redraw the icon.

The later Codex task should mechanically rasterize the correct SVG at each required PWA, web, favicon and Android legacy size; generate the Android adaptive layers from the supplied foreground/background masters; build a themed mono layer from the supplied knockout geometry if needed; place assets and update project manifests/configuration and colors after inspecting the repository. Preserve the card tilt, relative geometry, two-line arrangement, motion capsule positions, palette, gradient vector and stops, corner radii, optical center, shadow parameters, and variant size thresholds. Do not sample the reference board, substitute its printed hex labels, add accents, invent a wordmark, or reinterpret the composition.
