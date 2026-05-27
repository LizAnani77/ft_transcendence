#!/bin/sh
set -eux

mkdir -p /secrets_waf /secrets_backend /app/database /app/uploads
chown -R 1000:1000 /secrets_waf /secrets_backend /app/database /app/uploads
chmod 700 /secrets_waf /secrets_backend
chmod 750 /app/database /app/uploads
echo "[volumes-init] Etat final:"
ls -lnd /secrets_waf /secrets_backend /app/database /app/uploads || true
