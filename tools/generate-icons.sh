#!/usr/bin/env bash
# Regenerates app icons / splash / favicon from the master logo.
# Source of truth: assets/images/playbox.jpg (1024×1024)
# Run from repo root: ./tools/generate-icons.sh
set -euo pipefail

SRC="assets/images/playbox.jpg"
OUT="assets/images/"
BG="#211F29"   # matches the logo's dark canvas; also splash + adaptiveIcon backgroundColor

# Wide-rectangle crop that grabs ONLY the basketball + motion lines and stops
# above the "PLAYBOX" wordmark, then we pad back to a square. The basketball
# fills more of the frame this way (user wanted it bigger).
# Format: WIDTHxHEIGHT+X_OFFSET+Y_OFFSET on the 1024×1024 source.
CROP="660x420+182+190"
EXTENT="660x660"
TMP="$(mktemp -t playbox-crop.XXXXXX).png"
trap 'rm -f "$TMP"' EXIT

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi
command -v magick >/dev/null || { echo "ImageMagick (magick) not on PATH" >&2; exit 1; }

# Step 1: crop out the wordmark and pad back to a centered square so the
# basketball lands dead-center on every downstream icon.
magick "$SRC" -crop "$CROP" +repage \
  -gravity center -background "$BG" -extent "$EXTENT" \
  "$TMP"

# iOS icon — must be 1024×1024, opaque, no alpha channel (App Store rejects alpha).
magick "$TMP" -resize 1024x1024 -background "$BG" -alpha remove -alpha off \
  -strip "${OUT}icon.png"

# Android adaptive foreground — full-bleed; basketball sits inside the
# inner ~66% safe zone, so the system mask (circle/squircle) won't clip it.
# Pair with adaptiveIcon.backgroundColor = $BG so the seam is invisible.
magick "$TMP" -resize 1024x1024 -background "$BG" -alpha remove -alpha off \
  -strip "${OUT}adaptive-icon.png"

# Splash logo — same 1024×1024; expo splash uses backgroundColor=$BG.
magick "$TMP" -resize 1024x1024 -background "$BG" -alpha remove -alpha off \
  -strip "${OUT}splash-icon.png"

# Web favicon — 196×196 is what most browsers prefer for high-DPI tabs.
magick "$TMP" -resize 196x196 -strip "${OUT}favicon.png"

echo "regenerated: icon.png adaptive-icon.png splash-icon.png favicon.png"
