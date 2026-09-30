#!/usr/bin/env bash
set -euo pipefail

# Rasterize each output from the approved SVG variant for its final pixel size.
command -v magick >/dev/null || { echo 'ImageMagick (magick) with SVG support is required.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3 is required.' >&2; exit 1; }

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand_dir="$repo_dir/branding"
public_dir="$repo_dir/apps/web/public"
res_dir="$repo_dir/apps/web/android/app/src/main/res"
channel="${1:-stable}"
case "$channel" in
  all)
    "$0" stable
    "$0" preview
    exit 0
    ;;
  stable)
    primary_source="$brand_dir/catch-icon-master.svg"
    small_source="$brand_dir/catch-icon-small.svg"
    favicon_source="$brand_dir/catch-favicon-mark.svg"
    background_source="$brand_dir/catch-adaptive-background.svg"
    ;;
  preview)
    python3 "$brand_dir/preview/derive-preview-icons.py"
    python3 "$brand_dir/preview/derive-preview-icons.py" --check
    primary_source="$brand_dir/preview/catch-icon-preview.svg"
    small_source="$brand_dir/preview/catch-icon-preview-small.svg"
    favicon_source="$brand_dir/preview/catch-favicon-preview.svg"
    background_source="$brand_dir/preview/catch-adaptive-preview-background.svg"
    public_dir="$public_dir/preview"
    res_dir="$repo_dir/apps/web/android/app/src/preview/res"
    ;;
  *) echo 'Usage: generate-brand-assets.sh [stable|preview|all]' >&2; exit 1 ;;
esac
mkdir -p "$public_dir"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

source_for_size() {
  local size="$1"
  if (( size >= 128 )); then
    printf '%s' "$primary_source"
  elif (( size >= 48 )); then
    printf '%s' "$small_source"
  else
    printf '%s' "$favicon_source"
  fi
}

render() {
  local source="$1" size="$2" output="$3"
  # The SVG's 1024-unit canvas supplies antialiasing at every export size.
  magick -background none "$source" -filter Lanczos -resize "${size}x${size}" \
    -strip "PNG32:$output"
}

render_icon() {
  local size="$1" output="$2"
  render "$(source_for_size "$size")" "$size" "$output"
}

render_round() {
  local size="$1" output="$2"
  magick -background none "$(source_for_size "$size")" \
    \( -size 1024x1024 xc:none -fill white -draw 'circle 512,512 512,0' \) \
    -compose DstIn -composite -filter Lanczos -resize "${size}x${size}" \
    -strip "PNG32:$output"
}

# These public vectors are copies, so the masters remain in one source location.
cp "$primary_source" "$public_dir/icon.svg"
cp "$small_source" "$public_dir/icon-small.svg"
cp "$favicon_source" "$public_dir/favicon-mark.svg"

for size in 16 24 32 48; do
  render_icon "$size" "$temp_dir/favicon-$size.png"
done
magick "$temp_dir/favicon-16.png" "$temp_dir/favicon-24.png" \
  "$temp_dir/favicon-32.png" "$temp_dir/favicon-48.png" \
  "$public_dir/favicon.ico"
if [[ "$channel" == stable ]]; then
  cp "$public_dir/favicon.ico" "$repo_dir/favicon.ico"
fi
cp "$temp_dir/favicon-16.png" "$public_dir/favicon-16x16.png"
cp "$temp_dir/favicon-32.png" "$public_dir/favicon-32x32.png"

for size in 180 192 512; do
  case "$size" in
    180) output="$public_dir/apple-touch-icon.png" ;;
    *) output="$public_dir/pwa-${size}x${size}.png" ;;
  esac
  render_icon "$size" "$output"
done

render "$background_source" 512 "$temp_dir/maskable-background.png"
render "$brand_dir/catch-adaptive-foreground.svg" 512 "$temp_dir/maskable-foreground.png"
magick "$temp_dir/maskable-background.png" "$temp_dir/maskable-foreground.png" \
  -compose Over -composite -strip "PNG32:$public_dir/maskable-512x512.png"

# Android tints the monochrome drawable by alpha. Retain the supplied transparent
# line knockouts and apply the adaptive foreground's scale from the token file.
python3 - "$brand_dir/catch-mark-mono-light.svg" "$brand_dir/catch-brand-tokens.json" \
  "$temp_dir/monochrome.svg" <<'PY'
import json
import sys
import xml.etree.ElementTree as ET

source, tokens_path, output = sys.argv[1:]
with open(tokens_path, encoding="utf-8") as token_file:
    tokens = json.load(token_file)
cx, cy = tokens["adaptive"]["sourceToForeground"]["center"]
scale = tokens["adaptive"]["sourceToForeground"]["uniformScale"]
ET.register_namespace("", "http://www.w3.org/2000/svg")
tree = ET.parse(source)
root = tree.getroot()
group = ET.Element("{http://www.w3.org/2000/svg}g", {
    "transform": f"translate({cx} {cy}) scale({scale}) translate({-cx} {-cy})"
})
for child in list(root):
    if child.tag.rsplit("}", 1)[-1] != "defs":
        root.remove(child)
        group.append(child)
root.append(group)
tree.write(output, encoding="unicode", xml_declaration=True)
PY

for density in mdpi:48:96:108 hdpi:72:144:162 xhdpi:96:192:216 xxhdpi:144:288:324 xxxhdpi:192:384:432; do
  IFS=: read -r name launcher_size splash_size layer_size <<< "$density"
  mipmap_dir="$res_dir/mipmap-$name"
  mkdir -p "$mipmap_dir"
  render_icon "$launcher_size" "$mipmap_dir/ic_launcher.png"
  render_round "$launcher_size" "$mipmap_dir/ic_launcher_round.png"
  render "$background_source" "$layer_size" "$mipmap_dir/ic_launcher_background.png"

  # Flavor overlays change only channel paint. Android resolves the adaptive XML,
  # foreground and themed geometry from main for both flavors.
  [[ "$channel" == stable ]] || continue
  render "$brand_dir/catch-adaptive-foreground.svg" "$layer_size" \
    "$mipmap_dir/ic_launcher_foreground.png"
  render "$temp_dir/monochrome.svg" "$layer_size" \
    "$mipmap_dir/ic_launcher_monochrome.png"

  render_icon "$splash_size" "$temp_dir/splash-icon.png"

  for splash_path in "$res_dir/drawable-port-$name/splash.png" \
    "$res_dir/drawable-land-$name/splash.png"; do
    read -r width height < <(magick identify -format '%w %h\n' "$splash_path")
    magick -size "${width}x${height}" xc:'#f7f6f2' \
      "$temp_dir/splash-icon.png" \
      -gravity center -composite -strip "PNG32:$splash_path"
  done
done

[[ "$channel" == stable ]] || exit 0
render_icon 96 "$temp_dir/splash-icon.png"
magick -size 480x320 xc:'#f7f6f2' "$temp_dir/splash-icon.png" \
  -gravity center -composite -strip "PNG32:$res_dir/drawable/splash.png"
