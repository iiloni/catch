# Brand assets

Stable Gentle Drop SVGs and tokens in `branding/` are the canonical geometry sources.
The approved icon-only overlay in `branding/preview/` changes the icon gradient and primary
icon shadow paint. Its corrected gradient runs left to right, `(0,512) → (1024,512)`, with
`#8C68FF`, `#6044CF` and `#3B2AA6` at 0%, 55% and 100%. The primary landing shadow uses
`#231457` at 32% opacity with the stable shape and blur. These values follow the approved
primary artwork's bright violet and deep indigo; the preview spec records the reference
samples and the superseded muted palette. Stable cream `#FFF9F0`, charcoal `#292B2D`,
geometry and all size rules remain authoritative. The overlay never supplies application
UI tokens or theme colors.

## Regeneration

From the repository root, with Python 3 and ImageMagick `magick` with SVG support installed:

```bash
python3 branding/preview/derive-preview-icons.py
python3 branding/preview/derive-preview-icons.py --check
./scripts/generate-brand-assets.sh preview
./scripts/generate-brand-assets.sh stable
# Or regenerate both:
./scripts/generate-brand-assets.sh all
```

For a preview-only correction, run only the preview command so stable outputs stay untouched.
The generator defaults to stable for compatibility. Preview generation first derives the
four SVGs and runs `--check`; both derivation modes (write and check) enforce the fingerprint
guard. CI also runs
the derivation check. Raster exports use the same ImageMagick sampling as stable: render
the 1024-unit SVG, resize with Lanczos, strip metadata and write RGBA PNGs.

| Final size | Stable source | Preview source |
| --- | --- | --- |
| 128 px and above | `catch-icon-master.svg` | `preview/catch-icon-preview.svg` |
| 48–127 px | `catch-icon-small.svg` | `preview/catch-icon-preview-small.svg` |
| 16–47 px | `catch-favicon-mark.svg` | `preview/catch-favicon-preview.svg` |

Browser assets live in `apps/web/public/` for stable and `apps/web/public/preview/` for
preview, with the same filenames in separate paths: three SVG copies, 16 and 32 px PNG
favicons, ICO frames at 16/24/32/48 px, 180 px Apple touch icon, 192 and 512 px PWA icons,
and a 512 px maskable icon. The root `favicon.ico` remains stable.

Android uses its existing density sizes: legacy regular/round launcher icons at
48/72/96/144/192 px and adaptive layers at 108/162/216/324/432 px. Stable resources stay in
`apps/web/android/app/src/main/res/`; preview overlays in `src/preview/res/` contain only
legacy icons and adaptive backgrounds. The inherited adaptive XML resolves the overlay's
background and the shared main foreground and monochrome resources. The foreground is
the unchanged `catch-adaptive-foreground.svg`, retaining transparency, scale 0.76,
position and safe area. Maskable PWA icons composite that same foreground with the
channel's full-bleed background. System tint removes channel colors from themed icons.
Splash images and all application styling remain unchanged.

## Channel selection

The release workflow's existing tag parser selects stable from `vMAJOR.MINOR.PATCH` and
preview from `vMAJOR.MINOR.PATCH-preview`. Its `channel` output becomes the build-only
`CATCH_CHANNEL` for Android web sync and the Docker build argument. Vite selects icon paths
from this explicit value; it defaults to dev, which uses the stable icons, and rejects
unsupported values. PWA
names, URLs, theme/background colors and release behavior are unchanged. Preview browser
links and manifest icons use `/preview/` paths to avoid mixing cached stable icons.

Android launcher resources are selected by Gradle's flavors (dev inherits stable's),
independently of debug/release build type. Capacitor uses `CATCH_CHANNEL` for its default
flavor too. Sync the matching web channel before building an APK:

```bash
./scripts/dev.sh build stable
./scripts/dev.sh build preview

# Host commands for Capacitor and Android (JDK 21 and SDK 36):
CATCH_CHANNEL=stable pnpm --filter @catch/web android:sync
(cd apps/web/android && ./gradlew assembleStableDebug)
CATCH_CHANNEL=preview pnpm --filter @catch/web android:sync
(cd apps/web/android && ./gradlew assemblePreviewDebug)
```

Release signing still requires the values in [Releasing and deployment](releases.md).
Development and ordinary debug builds are the dev channel unless stable or preview is
explicitly selected. A local production image can select preview with `docker build
--build-arg CATCH_CHANNEL=preview --target production .`; the build argument defaults to dev.

## Stable fingerprint review

All seven SVG fingerprints from the supplied extension matched the repository byte for
byte. The stable token JSON was already formatted with inline arrays by Biome. Serializing
the repository's parsed JSON with Python `json.dumps(..., indent=2)` and a trailing newline
reproduced the supplied fingerprint
`25b1578f46c88a700700ab39e35268f72e2d0185aa6b17fcf92a4069057d4fb5` exactly.
This establishes a whitespace-only difference, with identical geometry, paint and tokens.
Only the preview overlay's expected token fingerprint was updated to the repository's
`7ec6bb657154edc350ecb21a3936be7443fe215667b2edc5333cf4ed99e85a04`.
No stable source was changed. Future mismatches require the same deliberate review before
updating fingerprints; never bypass the guard or maintain separate preview geometry.
