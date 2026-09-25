#!/bin/sh
# vibepet installer — curl -fsSL vibepet.net/install | sh
set -e
[ "$(uname)" = Darwin ] || { echo "vibepet is macOS-only for now."; exit 1; }
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then ARCH=arm64; else ARCH=x64; fi
DEST=/Applications; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "↓ downloading vibepet ($ARCH)…"
curl -fL# "https://vibepet.net/download/$ARCH.zip" -o "$TMP/vibepet.zip"
pkill -x vibepet 2>/dev/null || true
rm -rf "$DEST/vibepet.app"
ditto -xk "$TMP/vibepet.zip" "$DEST"
xattr -dr com.apple.quarantine "$DEST/vibepet.app" 2>/dev/null || true
echo "✓ installed to $DEST/vibepet.app — say hi to Net 👋"
open "$DEST/vibepet.app"
