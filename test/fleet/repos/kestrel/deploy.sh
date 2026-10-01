#!/bin/sh
# kestrel deploy. Fixture: only --dry-run exists, and it only echoes.
if [ "$1" = "--dry-run" ]; then
  echo "[dry-run] would build kestrel $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "[dry-run] would upload to staging.kestrel.invalid"
  echo "[dry-run] nothing changed"
  exit 0
fi
echo "deploy.sh: only --dry-run is supported here" >&2
exit 2
