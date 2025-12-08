#!/usr/bin/env sh
set -eu

if [ $# -ne 1 ]; then
  echo "Usage: $0 <VAULT_TOKEN>"
  exit 1
fi

VAULT_TOKEN="$1"

CONTAINER="ft_transcendence_vault"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}\$"; then
  echo "Erreur: Le container '${CONTAINER}' n'est pas en cours d'exécution."
  exit 1
fi

docker exec -it \
  -e VAULT_ADDR="http://127.0.0.1:8200" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  "$CONTAINER" sh -lc '
set -e

echo "=== [1] KV: secret/backend/app ==="
vault kv get secret/backend/app || echo "(échec)"

echo
echo "=== [2] PKI: rôle waf-role ==="
vault read pki/roles/waf-role || echo "(échec)"

echo
echo "=== [3] PKI: certificat CA racine ==="
vault read pki/cert/ca || echo "(échec)"

echo
echo "=== [4] Auth: liste des AppRoles ==="
vault list auth/approle/role || echo "(échec)"

echo
echo "=== [5] Auth: AppRole backend ==="
vault read auth/approle/role/backend || echo "(absent)"

echo
echo "=== [6] Auth: AppRole waf ==="
vault read auth/approle/role/waf || echo "(absent)"

echo
echo "=== [7] Policies (liste) ==="
vault list sys/policy || echo "(aucune policy)"

echo
echo "=== [8] Policy backend ==="
vault read sys/policy/backend || echo "(policy backend absente)"

echo
echo "=== [9] Policy waf ==="
vault read sys/policy/waf || echo "(policy waf absente)"

echo
echo "=== Audit terminé ==="
'
