#!/bin/bash
# Privacy check of the ultra evidence dir: text strings vs. real transcripts, screenshots via local OCR.
# Prints only counts and paths. Writes <out>/privacy-text.json and <out>/privacy-png.json.
#   docs/ultra/tools/privacy/run.sh <out dir> [evidence dir]
# The OCR text is kept in a temp file that is deleted on exit; nothing of it is printed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?out dir}"; EV="${2:-$HOME/projects/vibepet/docs/ultra}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
node --max-old-space-size=8192 "$HERE/scan.js" --target "$EV" --json "$OUT/privacy-text.json" | grep -v '^ '
find "$EV" -name '*.png' > "$TMP/pngs.txt"
swift "$HERE/ocr.swift" "$TMP/pngs.txt" "$TMP/ocr.jsonl" 2>/dev/null | tail -1
node --max-old-space-size=8192 "$HERE/ocrcheck.js" "$TMP/ocr.jsonl" --json "$OUT/privacy-png.json"
