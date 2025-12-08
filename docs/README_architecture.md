# Architecture Docker Compose – Transcendence

Ce document décrit l’architecture Docker Compose du projet **Transcendence**, organisée autour de plusieurs services interconnectés : base de données, backend, frontend, WAF (reverse proxy), et Vault pour la gestion sécurisée des secrets et certificats.

---

## 🗂️ Volumes nommés

- **database_data** : contient la base SQLite (`pong.db`).
- **uploads_data** : contient les fichiers utilisateurs (avatars, PNG…).
- **vault_logs** : journaux du serveur Vault.
- **vault_data** : données persistantes de Vault (Raft storage).
- **vault_config** : configuration de Vault.
- **vault_waf_tls** : certificats TLS générés par Vault pour le WAF.
- **vault_waf_bootstrap** : fichiers bootstrap (role_id, secret_id) du WAF.
- **vault_backend_secrets** : secrets d’environnement du backend (JWT_SECRET, DB_PATH…).
- **vault_backend_bootstrap** : fichiers bootstrap du backend.

---

## 🏗️ Services

### 1. **volumes-init**
Prépare les répertoires utilisés par tous les services.
- Crée `/app/database`, `/app/uploads`, `/secrets_waf`, `/secrets_backend`.
- Définit les permissions (`1000:1000` pour backend/frontend, `root` pour Vault).
- Initialise les volumes : `database_data`, `uploads_data`, `vault_*`.

---

### 2. **vault-perms**
Assure les droits corrects pour Vault :
- Crée `/vault/data`, `/vault/config`, `/vault/logs`.
- Définit le propriétaire `vault:vault`.
- Permissions restrictives (`750`).

---

### 3. **vault**
Le serveur HashiCorp Vault :
- Lance Vault en mode serveur (stockage Raft).
- Dépend de `volumes-init` et `vault-perms`.
- Monté sur `vault_data`, `vault_config`, `vault_logs`.
- Healthcheck via `vault status`.

---

### 4. **vault-bootstrap**
Initialise et configure Vault :
- Unseal de Vault.
- Active les engines : **KV**, **AppRole**, **PKI**.
- Crée les policies (backend, waf).
- Génère les secrets de bootstrap (role_id, secret_id).
- Seed des secrets backend (DB path, JWT_SECRET…).

---

### 5. **vault-agent-waf**
Agent Vault pour le WAF :
- Authentification AppRole.
- Récupère et renouvelle automatiquement les certificats TLS (`tls.crt`, `tls.key`).
- Écrit dans `vault_waf_tls`.
- Healthcheck : fichiers TLS présents et valides.

---

### 6. **vault-agent-backend**
Agent Vault pour le backend :
- Authentification AppRole.
- Récupère et renouvelle les secrets applicatifs (`app.env`).
- Écrit dans `vault_backend_secrets`.
- Healthcheck : présence du fichier `app.env`.

---

### 7. **uploads-seed**
Service utilitaire (one-shot) :
- Copie des fichiers PNG seed (`uploads/`) vers `uploads_data` **si le volume est vide**.
- Assure la cohérence de l’UI au premier démarrage.

---

### 8. **waf**
Reverse proxy basé sur **Nginx + ModSecurity** :
- Dépend du backend, frontend et des certificats TLS générés par Vault.
- Sert :
  - Le frontend sur `https://localhost:3443/`.
  - Les APIs backend `/api/...`.
  - Les fichiers statiques (PNG) depuis `uploads_data`.
- Sécurité :
  - CSP, HSTS, Referrer-Policy, etc.
  - Healthcheck : validation config Nginx + process PID actif.

---

### 9. **backend**
API **Node.js (Fastify)** :
- Utilise les secrets injectés par Vault (`app.env`).
- Stocke la base SQLite dans `database_data`.
- Sert aussi les fichiers uploadés (`uploads_data`).
- Expose :
  - Authentification JWT.
  - Routes de jeu, chat, tournois.
  - WebSocket `/ws`.
- Healthcheck : endpoint `/health`.

---

### 10. **frontend**
Client **Vite (TypeScript)** :
- Se connecte au backend via le WAF (TLS).
- Routage SPA (single-page application).
- Dépend du backend (healthy).
- Healthcheck : service accessible sur `localhost:4000` (mode dev).

---

### 11. **cli-pong**
Interface CLI (client Pong en terminal) :
- Permet de jouer en **ligne de commande** contre d’autres joueurs ou des bots.  
- Connectée au **WAF** via :
  - `API_URL=https://waf`  
  - `WS_URL=wss://waf/ws`
- Démarre en mode interactif (`stdin_open: true`, `tty: true`).
- Volume `pong_cli_home` pour sauvegarder la configuration locale.
- Utile pour **tester le gameplay réseau et la stabilité WebSocket** sans interface graphique.

---

## 🔄 Flux global

1. **Initialisation des volumes**
   - `volumes-init` → crée les répertoires nécessaires (`database`, `uploads`, `secrets_waf`, `secrets_backend`).
   - `vault-perms` → applique les permissions adaptées à Vault.

2. **Lancement du système Vault**
   - `vault` démarre en mode serveur avec stockage Raft.
   - `vault-bootstrap` initialise Vault : unseal, création des policies et des secrets (backend + WAF).
   - `vault-agent-waf` récupère automatiquement les certificats TLS et les écrit dans `vault_waf_tls`.
   - `vault-agent-backend` récupère les secrets d’application (JWT, DB_PATH, etc.) et les écrit dans `vault_backend_secrets`.

3. **Initialisation applicative**
   - `uploads-seed` insère les images par défaut dans `uploads_data` si le volume est vide.
   - `backend` démarre avec ses secrets Vault et la base SQLite.
   - `frontend` démarre une fois le backend healthy (`http://backend:8080/health`).

4. **Mise en ligne via WAF**
   - `waf` devient la **porte d’entrée unique** en HTTPS :
     - Proxy du frontend (`/`)
     - Proxy des API backend (`/api/...`)
     - Gestion du TLS via certificats Vault
     - Sécurité renforcée via ModSecurity (OWASP CRS activé)

5. **Accès utilisateur**
   - L’utilisateur navigue sur [https://localhost:3443](https://localhost:3443).
   - Toutes les requêtes passent par le WAF (HTTPS).

---

## 🌐 Points d’accès

| Service | URL / Protocole | Description |
|----------|------------------|--------------|
| **Frontend (SPA)** | [https://localhost:3443/](https://localhost:3443/) | Interface utilisateur (Vite + TypeScript) servie via le WAF |
| **Backend API** | [https://localhost:3443/api/...](https://localhost:3443/api/...) | Toutes les requêtes API passent par le WAF (HTTPS obligatoire) |
| **WebSocket** | `wss://localhost:3443/ws` | Canal temps réel (jeu Pong, chat, tournois) |
| **Uploads** | [https://localhost:3443/uploads/1.png](https://localhost:3443/uploads/1.png) | Fichiers statiques (avatars) |
| **Health backend** | Non exposé via WAF | Endpoint interne du backend: `http://backend:8080/health` (utilisé par les healthchecks) |
| **Vault UI (optionnel)** | *non exposée* | Vault reste interne au réseau Docker (non accessible directement) |
| **CLI Pong** | `cli-pong` → via `API_URL=https://waf` et `WS_URL=wss://waf/ws` | Client terminal pour tester le gameplay et le WebSocket via le WAF |

---

## ✅ Résumé

- Tous les secrets (JWT, DB_PATH, certs TLS...) sont gérés **dynamiquement par Vault**.  
- Les données utilisateurs (DB + uploads) sont stockées dans des **volumes nommés persistants**.  
- Le WAF protège l’ensemble et fournit un accès unique en HTTPS.  
- Le système est reproductible : un simple `docker compose up --build` recrée tout, y compris les certificats.
