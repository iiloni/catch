#!/usr/bin/env bash
set -euo pipefail

# Render the checked-in Catch mark into the formats required by browsers and Android.
command -v magick >/dev/null || { echo 'ImageMagick (magick) is required.' >&2; exit 1; }

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_svg="$repo_dir/apps/web/public/icon.svg"
public_dir="$repo_dir/apps/web/public"
res_dir="$repo_dir/apps/web/android/app/src/main/res"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

magick -background none -density 192 "$source_svg" -resize 1024x1024 "PNG32:$temp_dir/icon.png"
sed '/<rect width="512" height="512"/d' "$source_svg" > "$temp_dir/foreground.svg"
magick -background none -density 192 "$temp_dir/foreground.svg" -resize 1024x1024 \
  "PNG32:$temp_dir/foreground.png"
sed 's/<rect width="512" height="512" rx="112" fill="#f6c343"\//<circle cx="256" cy="256" r="256" fill="#f6c343"\//' \
  "$source_svg" > "$temp_dir/round.svg"
magick -background none -density 192 "$temp_dir/round.svg" -resize 1024x1024 "PNG32:$temp_dir/round.png"

for size in 16 32 48; do
  magick "$temp_dir/icon.png" -resize "${size}x${size}" "PNG32:$temp_dir/favicon-$size.png"
done
magick "$temp_dir/favicon-16.png" "$temp_dir/favicon-32.png" "$temp_dir/favicon-48.png" \
  "$public_dir/favicon.ico"
cp "$public_dir/favicon.ico" "$repo_dir/favicon.ico"

for density in mdpi:48:96:108 hdpi:72:144:162 xhdpi:96:192:216 xxhdpi:144:288:324 xxxhdpi:192:384:432; do
  IFS=: read -r name launcher_size splash_size foreground_size <<< "$density"
  mipmap_dir="$res_dir/mipmap-$name"
  magick "$temp_dir/icon.png" -resize "${launcher_size}x${launcher_size}" \
    "PNG32:$mipmap_dir/ic_launcher.png"
  magick "$temp_dir/round.png" -resize "${launcher_size}x${launcher_size}" \
    "PNG32:$mipmap_dir/ic_launcher_round.png"
  magick "$temp_dir/foreground.png" -resize "${foreground_size}x${foreground_size}" \
    "PNG32:$mipmap_dir/ic_launcher_foreground.png"

  for splash_path in "$res_dir/drawable-port-$name/splash.png" \
    "$res_dir/drawable-land-$name/splash.png"; do
    read -r width height < <(magick identify -format '%w %h\n' "$splash_path")
    magick -size "${width}x${height}" xc:'#eef0f2' \
      \( "$temp_dir/icon.png" -resize "${splash_size}x${splash_size}" \) \
      -gravity center -composite "PNG32:$splash_path"
  done
done

magick -size 480x320 xc:'#eef0f2' \
  \( "$temp_dir/icon.png" -resize 96x96 \) \
  -gravity center -composite "PNG32:$res_dir/drawable/splash.png"
