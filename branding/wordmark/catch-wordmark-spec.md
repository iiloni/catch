# Catch shared wordmark and lockups

## Source of truth

`catch-wordmark-dark.svg` contains the canonical outlined lettering. `catch-wordmark-light.svg` changes only the ink color. `catch-wordmark-tokens.json` defines exact layout, clear space, color and size rules. The existing stable, preview and dev icon SVGs remain authoritative for their own geometry and palettes. This additive extension does not change those sources.

One wordmark is shared by stable, preview and development builds. The visible text is always **Catch**, with a capital C and lowercase atch. Dev remains a development/testing treatment rather than an official public release channel. Only the icon varies by build.

## Lettering

The chosen typeface is **Manrope ExtraBold, weight 800**, using the bundled original variable font version 4.505. Its bold, open shapes pair with the friendly Gentle Drop icon. The lettering is a new production choice; the raster concept boards did not define an exact font.

The wordmark is converted to five filled SVG paths. No font installation, web-font download, `<text>` element, synthetic bolding or raster source is needed to display it. Do not replace it with live text in an approximately similar font.

The font uses 2000 units per em. Native kerning is retained, with additional tracking of **−18 font units per letter pair**, equivalent to −0.009 em. For this word, the t→c native adjustment is −60 font units; the other native pair adjustments are zero. No glyph contours were edited. Exact glyph positions and bounds are recorded in `source/catch-wordmark-provenance.json`.

The combined font-space ink bounds are `(60, −30, 5732, 1470)`. Removing side bearings and normalizing visible ink height yields a wordmark viewBox of **3872.0853 × 1024**. The font-to-SVG transform is recorded in provenance; the SVG itself is the frozen authority for curves and positioning. Upstream font changes must not silently alter this lettering.

The original font and its unmodified SIL Open Font License are included in `source/`. They are design-source provenance, not a requirement to change the application's typography. Retain their notices if distributing that font file.

## Colors and backgrounds

| Ink variant | Color | Usage |
|---|---|---|
| dark | `#292B2D`, RGB 41/43/45, opacity 1 | Wordmark on light surfaces |
| light | `#FFF9F0`, RGB 255/249/240, opacity 1 | Wordmark on dark surfaces |

These are the existing shared charcoal and cream. The icon remains full-color in either ink variant. Do not tint the lettering purple or blue by build, and do not change general UI colors. SVG backgrounds are transparent. The proof sheet's cream and charcoal surfaces are examples, not new theme values.

## Exact horizontal construction

All lockup measurements below use an icon tile size **I = 1024**. Scaling the whole lockup preserves every ratio.

| Measurement | Value |
|---|---|
| Tight canvas | approximately `3548.799980469 × 1024` |
| Icon box | `(0,0,1024,1024)` |
| Gap from tile right edge to lettering ink | `256` = 0.25 I |
| Wordmark ink box | `(1280,204,2268.799980469,600)` |
| Wordmark scale from its canonical SVG | `0.5859375` |
| Vertical alignment | Lettering is lifted 8 units above geometric ink centering |
| Wordmark baseline | y = `792` |

The icon is left of the lettering. Match these visible bounds rather than a font's advance box. Do not add a background pill or independently resize the letters.

## Exact stacked construction

| Measurement | Value |
|---|---|
| Tight canvas | approximately `1536 × 1622.205927333` |
| Icon box | `(256,0,1024,1024)` |
| Gap from tile bottom to lettering ink | `192` = 0.1875 I |
| Wordmark ink box | `(0,1216,1536,406.205927333)` |
| Wordmark scale | `1536 / 3872.0853`, approximately `0.396685476` |
| Horizontal alignment | Both ink-box centers are x = `768` |

The icon is centered above the lettering. No rotation is applied to the wordmark. The icon's internal note rotation is inherited from its current source.

Full-precision machine values are in the token file; printed measurements are rounded for readability.

## Clear space and display size

Reserve at least **192/I = 18.75% of the displayed icon width** outside all four tight artwork bounds. This is surrounding layout space, not blank padding already included in the SVG. Preserve aspect ratio and never crop or stretch the lettering or icon independently.

- Horizontal minimum: **112 CSS px** wide for the tight lockup. A 40–48 px icon is a useful header size, producing a lockup about 139–166 px wide.
- Stacked minimum: **96 CSS px** wide for the tight lockup. Use a larger stacked version on roomy branding surfaces.
- Standalone lettering minimum: **18 CSS px** visible ink height.
- Below these minima, use an existing icon-only asset rather than compressing the lockup.

Select icon detail by the **displayed icon size**, not the total lockup width or the resolution of a retina export:

| Displayed icon size | Icon tier / SVG filename suffix |
|---|---|
| 128 px and above | primary / no suffix |
| 48–127 px | small / `-small` |
| 16–47 px | micro / `-micro` |

Only the icon detail varies with tier. The lettering, proportions, gap and alignment remain identical. For a 2× raster used at a 40 px displayed icon size, compose the micro tier first, then rasterize that composition at twice the display dimensions. Do not choose tier from the larger backing bitmap size.

## Assets and build selection

The package contains 36 reference composites: three build variants × two orientations × two lettering inks × three icon tiers. They are mechanically assembled examples, not new icon sources.

File pattern: `catch-lockup-{horizontal|stacked}-{stable|preview|dev}-{dark|light}[-small|-micro].svg`.

**Important preview continuity:** the reference composites use the saved icon packages available here. Preview icon colors were subsequently corrected in your codebase. Regenerate the lockups from that repository's current preview SVGs before integration. Do not copy a saved reference tile back over the corrected preview artwork. This extension defines no channel icon color overrides.

The default source paths are in `catch-wordmark-tokens.json`. If repository locations differ, provide a JSON file in the same shape as `wordmark-icon-inputs.example.json`, with paths resolved relative to that JSON file.

From the package root:

```bash
python3 branding/wordmark/compose-catch-lockups.py
python3 branding/wordmark/compose-catch-lockups.py --check
```

With explicitly resolved repository sources:

```bash
python3 branding/wordmark/compose-catch-lockups.py --icons-json path/to/current-icon-inputs.json --output-dir path/to/generated-lockups
```

The generator needs Python 3 standard-library modules only. It reads current pure-vector 1024-square icon SVGs, copies their artwork, namespaces IDs and references, and applies the lockup positioning. It reads the frozen wordmark paths and sets the chosen lettering ink. It never alters input SVGs or rewrites icon palettes. Its build manifest records the input hashes and output filenames. `--check` verifies both composites and the manifest without writing.

## Integration guidance

Use horizontal lockups on existing wide brand surfaces such as headers, sign-in headers and navigation branding. Use stacked lockups on existing roomy brand surfaces such as onboarding or app-controlled splash/about areas when the surrounding layout supports them. Do not invent new screens merely to place a logo.

Keep launcher icons, adaptive layers, PWA icons and favicons icon-only. Do not put these wide or tall lockups into system launcher or Android system splash-icon slots. Use SVGs where supported or mechanically rasterize at required density for native surfaces; do not discard SVG gradients or shadow filters to force an inaccurate vector conversion.

Select stable/preview/dev using the existing build identity, and dark/light ink using the existing surface theme. Preserve the current channel IDs, routing, typography and application palette. Keep all visible wordmarks identical across builds. A logo-only accessibility label can be “Catch”, or include the build identity when appropriate; avoid duplicate announcements when adjacent accessible text already names the product.

## Validation completed

- Inspected dark and light lettering with both orientations for all three saved icon treatments.
- Inspected horizontal icon heights 32, 40, 48, 64 and 128 px, using the correct icon tier.
- Inspected stacked tight widths 96, 128, 160, 192 and 256 px.
- Inspected standalone wordmark ink heights 18, 24, 32 and 64 px.
- Verified pure-vector output and deterministic generation, including a separate test using corrected preview input colors.
- Verified existing stable, preview and dev source files remain unchanged.

No codebase integration or application build was performed in this package task.
