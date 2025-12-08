#!/bin/sh
set -eu

# Ensure target directory exists
mkdir -p /mnt/up

if [ -z "$(ls -A /mnt/up 2>/dev/null || true)" ]; then
  cp -a /seed/. /mnt/up/
  chown -R 1000:1000 /mnt/up || true
  echo "[uploads-seed] Seed files copied."
else
  echo "[uploads-seed] Target not empty; skipping seed."
fi

exit 0
