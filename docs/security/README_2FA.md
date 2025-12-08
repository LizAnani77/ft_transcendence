# 2FA (TOTP) – Guide d’intégration et d’exploitation

Ce document décrit l’implémentation **2FA par TOTP** de l’application (backend Fastify + frontend). Il couvre la configuration (Vault), les endpoints, le rate‑limit, l’UX, etc...

---

## Sommaire

- [Vue d’ensemble](#vue-densemble)
- [Configuration via Vault](#configuration-via-vault)
- [Endpoints backend](#endpoints-backend)
- [Rate‑limit & sécurité](#rate-limit--sécurité)
- [Intégration frontend](#intégration-frontend)
- [Dépannage](#dépannage)

---

## Vue d’ensemble

**Flux d’activation (enrôlement) :**
1. L’utilisateur **clique “Enable Two‑Factor”** dans son profil.
2. Le front appelle `POST /api/auth/2fa/setup` → le backend génère un **secret TOTP** et renvoie une URL **otpauth://**.
3. Le front **affiche un QR code** à partir de l’`otpauth://` (bibliothèque `qrcode`) et expose le **secret (Base32)** en fallback.
4. L’utilisateur scanne le QR dans son application d’authentification (Google Authenticator, Authy, …) puis renseigne un **code 6 chiffres**.
5. Le front appelle `POST /api/auth/2fa/activate` → si **code valide**, le 2FA est activé en base.

**Flux de connexion avec 2FA activé :**
1. `POST /api/auth/login` → si 2FA activé, le backend renvoie `{ requires_2fa: true, temp_token }`.
2. Le front affiche un **formulaire 2FA** et appelle `POST /api/auth/login/2fa` avec `{ temp_token, code }`.
3. Si valide → **JWT final** + profil ; sinon → erreurs gérées, **rate‑limit** appliqué.

**Désactivation :**
- Le profil affiche un bouton “Disable Two‑Factor” qui ouvre un **mini‑form** pour saisir un code TOTP courant, puis `POST /api/auth/2fa/disable`.

---

## Configuration via Vault

### Clés KV (path : `secret/backend/app`)

Ces clés sont rendues dans `/secrets/app.env` par **vault-agent-backend** (template `app.env.ctmpl`).

| Clé KV | Description | Défaut seed |
|---|---|---|
| `JWT_SECRET` | Secret JWT | généré au bootstrap |
| `DB_PATH` / `DATABASE_URL` | SQLite | `/app/database/pong.db` |
| `TOTP_ISSUER` | Nom affiché dans les apps d’authenticator | `ft_transcendence` |
| `TWOFA_MAX_ATTEMPTS` | Tentatives **invalides** autorisées par fenêtre | `5` |
| `TWOFA_WINDOW_MS` | Taille de fenêtre de comptage (ms) | `300000` (5 min) |
| `TWOFA_LOCK_MS` | Durée de verrouillage (ms) après dépassement | `900000` (15 min) |

> Exemple dans le bootstrap :  
> ```sh
> vault kv put secret/backend/app >   JWT_SECRET="${CUR_JWT}" >   DB_PATH="/app/database/pong.db" >   DATABASE_URL="sqlite3:///app/database/pong.db" >   TOTP_ISSUER="ft_transcendence" >   TWOFA_MAX_ATTEMPTS="5" >   TWOFA_WINDOW_MS="300000" >   TWOFA_LOCK_MS="900000"
> ```

### Template agent (`vault/agent/backend/templates/app.env.ctmpl`)

Les variables 2FA sont exposées :
```hcl
{{- with secret "secret/data/backend/app" -}}
TOTP_ISSUER={{ or .Data.data.TOTP_ISSUER "ft_transcendence" }}
TWOFA_MAX_ATTEMPTS={{ or .Data.data.TWOFA_MAX_ATTEMPTS "5" }}
TWOFA_WINDOW_MS={{ or .Data.data.TWOFA_WINDOW_MS "300000" }}
TWOFA_LOCK_MS={{ or .Data.data.TWOFA_LOCK_MS "900000" }}
{{- end }}
```

---

## Endpoints backend

Tous les endpoints se trouvent dans `backend/src/routes/auth.ts`.

| Méthode / Path | Auth | Rôle |
|---|---|---|
| `POST /api/auth/2fa/setup` | Oui | Génère **secret** + renvoie `otpauth_url` |
| `POST /api/auth/2fa/activate` | Oui | Vérifie un **code** puis **active** le 2FA |
| `POST /api/auth/2fa/disable` | Oui | Vérifie un **code** puis **désactive** le 2FA |
| `POST /api/auth/login` | Non | Si 2FA actif → `{ requires_2fa, temp_token }` |
| `POST /api/auth/login/2fa` | Non (temp JWT) | Valide `{ temp_token, code }` → **JWT final** |
| `GET  /api/auth/2fa/health` | Oui | Renvoie la **config effective** et l’état 2FA de l’utilisateur |

> `GET /api/auth/2fa/health` renvoie par ex. :
> ```json
> {
>   "ok": true,
>   "config": {
>     "issuer": "ft_transcendence",
>     "maxAttempts": 3,
>     "windowMs": 15000,
>     "lockMs": 15000,
>     "otpWindow": 1
>   },
>   "user": { "id": 3, "username": "alice", "two_factor_enabled": true }
> }
> ```

---

## Rate‑limit & sécurité

- **Paramètres** :  
  - `TWOFA_MAX_ATTEMPTS` = nombre de **codes invalides** autorisés **par fenêtre**.  
  - `TWOFA_WINDOW_MS` = durée de la fenêtre de comptage.  
  - `TWOFA_LOCK_MS` = durée de **verrouillage** après dépassement.
- **Périmètre** : le compteur est **par utilisateur** et **commun** aux endpoints 2FA (`/2fa/activate`, `/2fa/disable`, `/auth/login/2fa`). Des essais échoués sur l’un **consomment** le quota global.
- **Réponse en dépassement** : `429 Too Many Requests` + entête `Retry-After: <sec>`.
- **OTP window** : `otplib.authenticator.options.window = 1` (tolérance ±1 intervalle de 30s).

> 📌 Remarque : par design, le verrouillage se matérialise **au premier appel qui dépasse** la limite. Exemple avec `MAX_ATTEMPTS=3` : 3 mauvais codes passent (401) ; à la **4e** requête, on renvoie 429 (puis lock pendant `TWOFA_LOCK_MS`).

---

## Intégration frontend

### Connexion (palier 2FA)

- `POST /api/auth/login` → si `requires_2fa`, le front montre une **carte 2FA** et appelle `POST /api/auth/login/2fa` avec `{ temp_token, code }`.
- Gestion des erreurs **401/400/429** : un message est affiché à l’utilisateur. Pour `429`, le front **n’auto‑rejoue pas** et affiche `Retry-After` si présent.

### Profil → Activer 2FA (QR)

- Le bouton **Enable Two‑Factor** appelle `POST /api/auth/2fa/setup` et **affiche un QR** (lib `qrcode`) ; le **secret (Base32)** est proposé en fallback manuel.
- Installation côté TS :  
  ```sh
  npm i qrcode
  npm i -D @types/qrcode
  ```
- Exemple (extrait) :
  ```ts
  import * as QRCode from 'qrcode';

  // après /2fa/setup :
  const qrBox = document.getElementById('twofa-qr')!;
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, otpauth_url, { width: 200, margin: 1 });
  qrBox.replaceChildren(canvas);
  ```

### Profil → Désactiver 2FA

- Bouton **Disable Two‑Factor** → ouvre un **mini‑form** (code 6 chiffres) qui appelle `POST /api/auth/2fa/disable`.  
- En cas de `429`, afficher le message et ne pas réessayer automatiquement.

---

## Dépannage

**“TypeScript : Could not find a declaration file for module 'qrcode'”**  
→ Installez les types dans frontend : `npm i -D @types/qrcode`.

**“Je veux 30 s de lock”**  
→ Mettez à jour dans Vault :  
```sh
vault kv patch secret/backend/app TWOFA_WINDOW_MS="30000" TWOFA_LOCK_MS="30000" TWOFA_MAX_ATTEMPTS="3"
# redeploy agent / redémarrer backend si nécessaire
```

**“429 trop tôt/trop tard”**  
- Le 429 arrive **quand la limite est dépassée**. Ex : avec 3, vous verrez 401 sur les 3 premiers mauvais codes, puis **429 au 4e appel**.
- Front : ne pas boucler, **afficher `Retry‑After`** si présent.

---

## Références rapides

- Variables : `TOTP_ISSUER`, `TWOFA_MAX_ATTEMPTS`, `TWOFA_WINDOW_MS`, `TWOFA_LOCK_MS`  
- Fichiers clés :  
  - Backend : `backend/src/routes/auth.ts`  
  - Vault agent template : `vault/agent/backend/templates/app.env.ctmpl`  
  - Front : `frontend/src/core/AuthService.ts`, `frontend/src/core/ProfileRenderer.ts`, `frontend/src/services/WebSocketService.ts`  
