#!/bin/sh
set -eu

# 1) Attendre le rendu Vault Agent (max 30s)
i=0
while [ ! -f /secrets/app.env ] && [ $i -lt 30 ]; do
  echo "[entrypoint] Waiting for /secrets/app.env from Vault Agent..."
  sleep 1; i=$((i+1))
done
[ -f /secrets/app.env ] || { echo "[entrypoint] ERROR: /secrets/app.env not found"; exit 1; }

# 2) Charger les variables d'env depuis Vault
set -a
. /secrets/app.env
set +a

# 3) Vérifier que JWT_SECRET est bien défini (sinon on refuse de démarrer)
if [ -z "${JWT_SECRET:-}" ]; then
  echo "[entrypoint] ERROR: JWT_SECRET is missing from Vault (refusing to start)."
  exit 1
fi

# 4) Chemins critiques
DB_DIR="/app/database"
UP_DIR="/app/uploads"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"

# 5) Si root: corriger permissions puis redescendre en 1000:1000
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] Running as root -> fixing ownership and perms"

  mkdir -p "$DB_DIR" "$UP_DIR"
  chown -R "$APP_UID:$APP_GID" "$DB_DIR" "$UP_DIR"
  chmod 750 "$DB_DIR" "$UP_DIR"

  echo "[entrypoint] Dropping privileges to ${APP_UID}:${APP_GID}"
  exec su-exec "$APP_UID:$APP_GID" /bin/sh "$0" "$@"
fi

# 6) Ici on est non-root (1000:1000). Vérifier écriture.
for d in "$DB_DIR" "$UP_DIR"; do
  if [ ! -w "$d" ]; then
    echo "[entrypoint] ERROR: Directory $d is not writable by $(id -u):$(id -g)."
    ls -lnd "$d" || true
    exit 1
  fi
done

# 7) Init DB (idempotent) puis lancer le serveur
#echo "[+] Initializing database..."
#node scripts/initDatabase.js

echo "[entrypoint] Starting server..."
exec node dist/server.js