#!/usr/bin/env bash
# HypeTv for LG webOS: packs this folder into an .ipk with LG's own tool (ares-package, from @webos-tools/cli).
#
#   tv/webos/build.sh            → tv/out/com.mihawkdev.hypetv_<version>_all.ipk
#
# ares-package comes from `npm i -g @webos-tools/cli` (or set ARES to its folder). The version is appinfo.json's.
set -euo pipefail
cd "$(dirname "$0")"

ARES_PACKAGE="${ARES:+$ARES/}ares-package"
command -v "$ARES_PACKAGE" >/dev/null || { echo "ares-package not found: npm i -g @webos-tools/cli (or ARES=<folder>)" >&2; exit 1; }

OUT=../out
WORK="$OUT/webos-app"
rm -rf "$WORK" && mkdir -p "$WORK"
# Only what the app needs (not this script).
cp appinfo.json index.html icon.png largeIcon.png splash.png "$WORK/"
"$ARES_PACKAGE" --no-minify --outdir "$OUT" "$WORK"
rm -rf "$WORK"
ls -la "$OUT"/*.ipk
