#!/bin/sh
set -eu

echo "[waf] ⏳ Attente des certificats TLS Vault..."
i=0; max=120
while [ ! -s /etc/nginx/ssl/tls.crt ] || [ ! -s /etc/nginx/ssl/tls.key ]; do
  [ "$i" -ge "$max" ] && { echo "[waf] ❌ Timeout en attendant les certs"; exit 1; }
  i=$((i+1)); sleep 1
done

echo "[waf] ✅ Certificats TLS détectés. Démarrage de Nginx…"
exec nginx -g "daemon off;" -e /tmp/nginx_error.log
