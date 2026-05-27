# Vault – Gestion des secrets et certificats

**HashiCorp Vault** : serveur, bootstrap, et agents.

---

## Arborescence

```
vault/
├── Dockerfile            # Image principale du serveur Vault
├── config/
│   └── server.hcl        # Configuration de Vault (storage raft, listener)
├── bootstrap/
│   ├── Dockerfile        # Image de bootstrap
│   ├── bootstrap.sh      # Script d’initialisation
│   └── policies/         # Policies HCL (backend.hcl, waf.hcl)
│       ├── backend.hcl
│       └── waf.hcl
└── agent/
    ├── backend/
    │   ├── Dockerfile
    │   ├── agent.hcl     # Auto-auth AppRole backend, template app.env.ctmpl
    │   └── templates/
    │       └── app.env.ctmpl
    └── waf/
        ├── Dockerfile
        ├── agent.hcl     # Auto-auth AppRole WAF, templates TLS
        └── templates/
            ├── tls.crt.ctmpl
            └── tls.key.ctmpl
```

---

## Description des composants

### `bootstrap.sh`

Script exécuté par **vault-bootstrap**.
Il réalise automatiquement :

1. **Attente** du serveur Vault (`/v1/sys/health`).  
2. **Chargement du `.env`** (échec si absent) + **validation des secrets critiques** (erreur si manquants ou JWT faible).  
3. **Initialisation** si première exécution (`vault operator init`), stockage des clés **dans `.env`** via `replace_or_append` (chmod 600).  
4. **Unseal** idempotent (`vault operator unseal`) en utilisant `VAULT_UNSEAL_KEY` du `.env`.  
5. **Activation** des engines/méthodes :  
   - `secret/` (**KV v2**) pour les secrets applicatifs.  
   - `approle/` (auth des Vault Agents).  
   - `pki/` (émission de certificats pour le WAF).  
6. **PKI** : configuration des URLs (AIA/CRL), génération de la **Root CA** si absente, rôle `waf-role`.  
7. **Policies** : `backend` et `waf` (droits minimaux sur les chemins utilisés).  
8. **AppRoles** : création des rôles `backend` et `waf`, export des `role_id` / `secret_id` vers les volumes de bootstrap.  
9. **Seed KV (`secret/backend/app`)** : écriture idempotente des clés applicatives, notamment :  
   - `JWT_SECRET` (généré une fois si absent)  
   - `DB_PATH`, `DATABASE_URL`  
   - **Clés 2FA consommées par le backend** :  
     - `TOTP_ISSUER` (par défaut `ft_transcendence`)  
     - `TWOFA_MAX_ATTEMPTS` (p. ex. `5`)  
     - `TWOFA_WINDOW_MS` (p. ex. `300000`)  
      - `TWOFA_LOCK_MS` (p. ex. `900000`)  
   - **Remote auth (OAuth2)** : `OAUTH42_CLIENT_ID`, `OAUTH42_CLIENT_SECRET`, `OAUTH42_REDIRECT_URI`, `OAUTH42_AUTH_URL`, `OAUTH42_TOKEN_URL`, `OAUTH42_API_BASE`  
10. **Vérifications** : lecture du secret seedé et du rôle PKI.

> ℹ️ La logique 2FA (limiteurs d’essais, validation TOTP, endpoints) est gérée par l’application. Vault ne stocke ici **que la configuration** (issuer + limites).

Ce processus rend Vault **utilisable automatiquement** sans étape manuelle.

---

## Vault Agents

Deux **Vault Agents** consomment Vault via **AppRole** et rendent des fichiers montés dans les conteneurs cibles :

- **vault-agent-backend**  
  - Auto-auth avec le rôle `backend`.  
  - Rendu du template **`app.env.ctmpl`** vers `/secrets/app.env`.  
  - Variables écrites pour le backend :  
    - `DB_PATH`, `DATABASE_URL`, `JWT_SECRET`  
    - **2FA** : `TOTP_ISSUER`, `TWOFA_MAX_ATTEMPTS`, `TWOFA_WINDOW_MS`, `TWOFA_LOCK_MS`  
    - **OAuth2 remote auth** : `OAUTH42_CLIENT_ID`, `OAUTH42_CLIENT_SECRET`, `OAUTH42_REDIRECT_URI`, `OAUTH42_AUTH_URL`, `OAUTH42_TOKEN_URL`, `OAUTH42_API_BASE`
  - Le backend lit ce fichier au démarrage.  
  - Healthcheck : OK quand `/secrets/app.env` existe et est non vide.  
- **vault-agent-waf**  
  - Auto-auth avec le rôle `waf`.  
  - Émission **PKI** côté Vault, rendu vers : `/secrets/tls.crt` et `/secrets/tls.key` pour Nginx.
  - Healthcheck : OK quand `tls.crt` et `tls.key` sont présents.

> 🔁 Les agents renouvellent/rafraîchissent automatiquement. Pour forcer un rendu, redémarrer l’agent concerné.

---

## Voir les secrets dans Vault

```
docker compose exec vault-agent-backend sh -lc '
  set -e
  export VAULT_ADDR=http://vault:8200

  ROLE_ID=$(cat /bootstrap/role_id)
  SECRET_ID=$(cat /bootstrap/secret_id)

  # Obtenir un client token via AppRole
  VAULT_TOKEN=$(vault write -field=token auth/approle/login role_id="$ROLE_ID" secret_id="$SECRET_ID")
  export VAULT_TOKEN

  echo "== vault status =="
  vault status
  echo

  echo "== secret/backend/app =="
  vault kv get secret/backend/app
'
```

---

## Volumes utilisés

- `vault_data` : données Raft de Vault.  
- `vault_config` : configuration persistée.  
- `vault_logs` : logs persistés.  
- `vault_waf_bootstrap`, `vault_backend_bootstrap` : tokens AppRole générés.  
- `vault_waf_tls`, `vault_backend_secrets` : secrets rendus par les agents.

---

## Variables requises (`.env` local, ignoré par git)

Le bootstrap échoue si ces variables manquent ou sont faibles :
- `DB_PATH`
- `JWT_SECRET` (≥ 32 caractères, valeur aléatoire)
- `JWT_EXPIRES`
- `TOTP_ISSUER`, `TWOFA_MAX_ATTEMPTS`, `TWOFA_WINDOW_MS`, `TWOFA_LOCK_MS`
- `OAUTH42_CLIENT_ID`, `OAUTH42_CLIENT_SECRET`, `OAUTH42_REDIRECT_URI`, `OAUTH42_AUTH_URL`, `OAUTH42_TOKEN_URL`, `OAUTH42_API_BASE`
- Optionnel : `DATABASE_URL` (défaut : `sqlite3://${DB_PATH}`)
- Écrits automatiquement à la première init si absents : `VAULT_UNSEAL_KEY`, `VAULT_ROOT_TOKEN`

`.env` sert de source initiale ; les secrets sont ensuite copiés dans Vault (KV v2) et les services consomment uniquement les rendus produits par les agents (`/secrets/app.env` pour le backend, `tls.crt`/`tls.key` pour le WAF). La source de vérité reste Vault.
