#!/usr/bin/env sh
set -eu
umask 077

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
ENV_FILE="${ENV_FILE:-/vault/.env}"

ok()  { printf '%s\n' "$*" 1>&2; }

# Vérifie la présence et sécurité des secrets critiques
check_critical_secrets() {
    missing=""

    # Variables système / Vault
    [ -z "${VAULT_ADDR:-}" ]        && missing="$missing VAULT_ADDR"
    [ -z "${ENV_FILE:-}" ]          && missing="$missing ENV_FILE"

    # Secrets critiques backend
    [ -z "${DB_PATH:-}" ]           && missing="$missing DB_PATH"
    [ -z "${JWT_SECRET:-}" ]        && missing="$missing JWT_SECRET"

    # JWT & 2FA
    [ -z "${JWT_EXPIRES:-}" ]       && missing="$missing JWT_EXPIRES"
    [ -z "${TOTP_ISSUER:-}" ]       && missing="$missing TOTP_ISSUER"
    [ -z "${TWOFA_MAX_ATTEMPTS:-}" ] && missing="$missing TWOFA_MAX_ATTEMPTS"
    [ -z "${TWOFA_WINDOW_MS:-}" ]   && missing="$missing TWOFA_WINDOW_MS"
    [ -z "${TWOFA_LOCK_MS:-}" ]     && missing="$missing TWOFA_LOCK_MS"

    # OAuth42
    [ -z "${OAUTH42_CLIENT_ID:-}" ]     && missing="$missing OAUTH42_CLIENT_ID"
    [ -z "${OAUTH42_CLIENT_SECRET:-}" ] && missing="$missing OAUTH42_CLIENT_SECRET"
    [ -z "${OAUTH42_REDIRECT_URI:-}" ]  && missing="$missing OAUTH42_REDIRECT_URI"
    [ -z "${OAUTH42_AUTH_URL:-}" ]      && missing="$missing OAUTH42_AUTH_URL"
    [ -z "${OAUTH42_TOKEN_URL:-}" ]     && missing="$missing OAUTH42_TOKEN_URL"
    [ -z "${OAUTH42_API_BASE:-}" ]      && missing="$missing OAUTH42_API_BASE"

    # Vault keys
    [ -n "${VAULT_UNSEAL_KEY:-}" ] || [ -n "${VAULT_ROOT_TOKEN:-}" ] || {
        ok "==> INFO: Vault sera initialisé automatiquement (pas de clé détectée)"
    }

    if [ -n "$missing" ]; then
        ok "==> ERREUR: Variables manquantes:$missing"
        exit 1
    fi

    if [ "${#JWT_SECRET}" -lt 32 ]; then
        ok "==> ERREUR SÉCURITÉ: JWT_SECRET trop court (${#JWT_SECRET} chars)"
        ok "==> Le minimum recommandé est 32 caractères (ex: openssl rand -hex 32)"
        exit 1
    fi

    case "$JWT_SECRET" in
        change_me|your_secret|jwt_secret|secret|password|123*)
            ok "==> ERREUR SÉCURITÉ: JWT_SECRET valeur par défaut/insecure"
            ok "==> Utilisez une valeur aléatoire: openssl rand -hex 32"
            exit 1
            ;;
    esac
}

# Remplace la clé si elle existe, sinon l'ajoute (idempotent)
replace_or_append() {
  key="$1"; val="$2"
  envdir="$(dirname "$ENV_FILE")"
  tmp="$(mktemp "$envdir/.env.tmp.XXXXXX")" || exit 1

  if [ -f "$ENV_FILE" ]; then
    grep -v "^$key=" "$ENV_FILE" > "$tmp" || true
  fi

  printf '%s=%s\n' "$key" "$val" >> "$tmp"

  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# 0) Charger les variables d'environnement si le .env existe
if [ -f "$ENV_FILE" ]; then
    ok "==> Chargement du .env: $ENV_FILE"
    set -a
    . "$ENV_FILE"
    set +a
else
    ok "==> ATTENTION: $ENV_FILE non trouvé"
    ok "==> Ce fichier est requis pour le bootstrap Vault"
    exit 1
fi

ok "==> Vérification des secrets critiques..."
check_critical_secrets

# 1) Attendre Vault
ok "==> Attente de Vault (${VAULT_ADDR})..."
i=0
until curl -sS "${VAULT_ADDR}/v1/sys/health" >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 120 ] && { echo "Vault ne répond pas"; exit 1; }
  sleep 1
done

# 2) Init Vault (seulement si pas déjà initialisé)
if ! vault status -format=json 2>/dev/null | jq -e '.initialized==true' >/dev/null; then
  ok "==> Initialisation de Vault..."
  INIT_JSON=$(vault operator init -key-shares=1 -key-threshold=1 -format=json)
  
  # Extraire et sauvegarder dans .env
  UNSEAL_KEY=$(echo "$INIT_JSON" | jq -r '.unseal_keys_b64[0]')
  ROOT_TOKEN=$(echo "$INIT_JSON" | jq -r '.root_token')
  
  ok "==> Sauvegarde des secrets dans .env (idempotent)..."
  replace_or_append VAULT_UNSEAL_KEY "$UNSEAL_KEY"
  replace_or_append VAULT_ROOT_TOKEN "$ROOT_TOKEN"
  chmod 600 "$ENV_FILE"
else
  ok "==> Vault déjà initialisé, utilisation du .env..."
  UNSEAL_KEY="${VAULT_UNSEAL_KEY}"
  ROOT_TOKEN="${VAULT_ROOT_TOKEN}"
fi

# Vérifier la présence des clés critiques
[ -z "${UNSEAL_KEY:-}" ] && { ok "Missing VAULT_UNSEAL_KEY"; exit 1; }
[ -z "${ROOT_TOKEN:-}" ] && { ok "Missing VAULT_ROOT_TOKEN"; exit 1; }

# 3) Unseal avec la clé du .env
ok "==> Unseal..."
vault operator unseal "${UNSEAL_KEY}" >/dev/null 2>&1 || true

# 4) Login root
export VAULT_TOKEN="${ROOT_TOKEN}"
vault token lookup >/dev/null

# 5) Préparer répertoires/volumes (droits souples)
ok "==> Préparation des volumes..."
mkdir -p /vault/logs /bootstrap_backend /bootstrap_waf || true
chown -R 1000:1000 /bootstrap_backend /bootstrap_waf
chmod 750 /bootstrap_backend /bootstrap_waf

# 6) Activer secrets engines & auth (idempotent)
ok "==> Enable KV v2 @ secret/"
vault secrets enable -path=secret -version=2 kv 2>/dev/null || true

ok "==> Enable AppRole auth"
vault auth enable approle 2>/dev/null || true

ok "==> Enable PKI"
vault secrets enable -path=pki pki 2>/dev/null || true

# 7) PKI: tune + URLs + CA (si absente) + rôle
ok "==> PKI: tune TTLs"
# 10 ans max, 1 an par défaut (évite les erreurs de TTL côté /issue/*)
vault secrets tune -max-lease-ttl=87600h -default-lease-ttl=8760h pki >/dev/null

ok "==> PKI: config URLs (AIA/CRL)"
vault write pki/config/urls \
  issuing_certificates="http://vault:8200/v1/pki/ca" \
  crl_distribution_points="http://vault:8200/v1/pki/crl" >/dev/null

ok "==> PKI: génération Root CA (si absent)"
if ! vault read pki/cert/ca >/dev/null 2>&1; then
  vault write -force pki/root/generate/internal \
    common_name="Transcendence Local CA" ttl=87600h >/dev/null
fi

ok "==> PKI: rôle waf-role"
vault write pki/roles/waf-role \
  allow_localhost=true \
  allowed_domains="localhost,nginx" \
  allow_subdomains=true \
  allow_bare_domains=true \
  allow_ip_sans=true \
  key_type="rsa" key_bits=2048 \
  max_ttl="72h" ttl="24h" >/dev/null

# 8) Policies
ok "==> Policies (backend, waf)"
vault policy write backend /policies/backend.hcl
vault policy write waf     /policies/waf.hcl

# 9) AppRoles + export des role_id/secret_id (idempotent)
ok "==> AppRole backend"
vault write auth/approle/role/backend \
  token_policies="backend" \
  secret_id_ttl="24h" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  bind_secret_id=true >/dev/null

BACKEND_ROLE_ID=$(vault read -field=role_id auth/approle/role/backend/role-id)
BACKEND_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/backend/secret-id)

echo "$BACKEND_ROLE_ID"   > /bootstrap_backend/role_id
echo "$BACKEND_SECRET_ID" > /bootstrap_backend/secret_id
chown 1000:1000 /bootstrap_backend/role_id /bootstrap_backend/secret_id
chmod 640 /bootstrap_backend/role_id
chmod 600 /bootstrap_backend/secret_id

ok "==> AppRole waf"
vault write auth/approle/role/waf \
  token_policies="waf" \
  secret_id_ttl="24h" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  bind_secret_id=true >/dev/null

WAF_ROLE_ID=$(vault read -field=role_id auth/approle/role/waf/role-id)
WAF_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/waf/secret-id)

echo "$WAF_ROLE_ID"   > /bootstrap_waf/waf-role-id
echo "$WAF_SECRET_ID" > /bootstrap_waf/waf-secret-id
chown 1000:1000 /bootstrap_waf/waf-role-id /bootstrap_waf/waf-secret-id
chmod 640 /bootstrap_waf/waf-role-id
chmod 600 /bootstrap_waf/waf-secret-id

# 10) Seed KV v2 (secret/backend/app) du .env
ok "==> Seed KV: secret/backend/app"
vault kv put secret/backend/app \
  DB_PATH="${DB_PATH}" \
  DATABASE_URL="${DATABASE_URL:-sqlite3://${DB_PATH}}" \
  JWT_SECRET="${JWT_SECRET}" \
  JWT_EXPIRES="${JWT_EXPIRES:-7d}" \
  TOTP_ISSUER="${TOTP_ISSUER:-ft_transcendence}" \
  TWOFA_MAX_ATTEMPTS="${TWOFA_MAX_ATTEMPTS:-5}" \
  TWOFA_WINDOW_MS="${TWOFA_WINDOW_MS:-15000}" \
  TWOFA_LOCK_MS="${TWOFA_LOCK_MS:-15000}" \
  OAUTH42_CLIENT_ID="${OAUTH42_CLIENT_ID}" \
  OAUTH42_CLIENT_SECRET="${OAUTH42_CLIENT_SECRET}" \
  OAUTH42_REDIRECT_URI="${OAUTH42_REDIRECT_URI}" \
  OAUTH42_AUTH_URL="${OAUTH42_AUTH_URL}" \
  OAUTH42_TOKEN_URL="${OAUTH42_TOKEN_URL}" \
  OAUTH42_API_BASE="${OAUTH42_API_BASE}" >/dev/null

# 11) Sanity checks
ok "==> Vérifications"
vault kv get secret/backend/app >/dev/null
vault read pki/roles/waf-role   >/dev/null

ok "==> Bootstrap terminé."
