# WAF – Reverse Proxy Nginx avec Vault TLS

Configuration du **Web Application Firewall** (Nginx + ModSecurity).

---

## Arborescence

```
nginx/
├── Dockerfile            # Image WAF basée sur Nginx + ModSecurity
├── nginx.conf            # Configuration principale Nginx (TLS, proxy, CSP, headers)
├── modsecurity/
│   ├── modsecurity.conf  # Configuration ModSecurity
│   ├── crs-setup.conf    # OWASP Core Rule Set setup
│   ├── include.conf      # Inclusion des règles CRS
│   └── api-allow.conf    # Exceptions pour API locales
└── wait-for-tls.sh       # Script d’attente des certificats TLS
```

---

## Description des composants

### `wait-for-tls.sh`

Ce script est utilisé comme **entrypoint** avant de lancer `nginx`.  
Il attend que Vault Agent (`vault-agent-waf`) ait généré les fichiers TLS :

- `/etc/nginx/ssl/tls.crt`
- `/etc/nginx/ssl/tls.key`

Fonctionnement :  
1. Boucle jusqu’à ce que les deux fichiers existent et soient non vides.  
2. Dès que prêts, il démarre `nginx -g 'daemon off;'`.  

Cela garantit que **Nginx démarre toujours avec un certificat valide** fourni par Vault.

---

## Intégration avec Vault

- Le volume `vault_waf_tls` est partagé entre `vault-agent-waf` et le conteneur WAF.  
- Vault Agent écrit directement les certificats (`tls.crt`, `tls.key`).  
- Le WAF lit ces certificats au démarrage.  
- En cas de renouvellement, on peut recharger Nginx avec `kill -HUP $(cat /run/nginx.pid)`.

---

## Volumes utilisés

- `vault_waf_tls` : certificat et clé TLS.  
- `uploads_data` : fichiers statiques (`/uploads/`) exposés via HTTPS.  

---

## Sécurité

- TLS obligatoire sur port `3443`.  
- En-têtes de sécurité configurés :  
  - `Strict-Transport-Security`  
  - `X-Frame-Options`  
  - `X-Content-Type-Options`  
  - `Content-Security-Policy`  
- ModSecurity activé avec **OWASP CRS** (829 règles).

---

## Test du WAF

1- **`scripts/test_waf.sh`**

Ce script automatise la **vérification du bon fonctionnement du WAF** en lançant une série d’attaques simulées sur l’URL `https://localhost:3443` et en vérifiant les codes de réponse.  

**Attaques testées :**
- **SQLi** (`?id=1' OR '1'='1`) → attendu **403**
- **XSS** (`?q=<script>alert(1)</script>`) → attendu **403**
- **LFI** (`?page=../../../../etc/passwd`) → attendu **403**
- **Content-Type invalide** (`POST` sur `/api/auth/login` avec `text/plain`) → attendu **415**
- **TRACE** → attendu **403** ou **405**

Chaque test affiche :
- le **code HTTP** obtenu,
- le **serveur** qui a répondu (`nginx` ou backend),
- et, en cas d’échec, un extrait des **logs ModSecurity** depuis `/tmp/modsec_audit.log`.

**Exemple d’exécution :**
```bash
./scripts/test_waf.sh
```
**Sortie typique:**
```bash
🔒 Testing WAF on https://localhost:3443 (path-as-is used for LFI tests)
🔍 SQLi in query                -> 403
🔍 Reflected XSS                -> 403
🔍 LFI path traversal           -> 403
🔍 POST bad CT -> 415           -> 415
🔍 TRACE blocked/disabled       -> 405

✅ Test suite finished successfully.
```
📘 Ce script prouve que le WAF **bloque efficacement les attaques classiques** (SQLi, XSS, LFI, mauvaise méthode ou mauvais Content-Type) et qu’il **applique bien les politiques de sécurité** configurées dans modsecurity.conf et nginx.conf.

2- **Vérification de l'absence d'inline event handlers**

Les **inline event handlers** (`onclick`, `onmouseover`, `onerror`, etc.) sont des attributs HTML contenant du code JavaScript directement dans la balise, par exemple :

**Mauvais :**
```html
<button onclick="logout()">Logout</button>
```

**Correct :**
```html
<button data-action="logout">Logout</button>
```
```ts
document.querySelectorAll('[data-action="logout"]').forEach(el =>
  el.addEventListener('click', () => window.pongApp.logout())
);
```

## 🔍 Test de vérification rapide
```bash
if grep -RIl \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
  --include='*.html' --include='*.ts' --include='*.tsx' --include='*.js' \
  -E '<[^>]*\bon[a-zA-Z]+\s*=|`[^`]*\bon[a-zA-Z]+\s*=[^`]*`|href\s*=\s*["'\''"]\s*javascript:' . >/dev/null; then
  echo "❌ Inlines détectés (handlers on* ou javascript:)."
  exit 1
else
  echo "✅ Aucun inline bloquant détecté."
fi
```

## ⚠️ Pourquoi ils sont interdits
- **Risque XSS** : le code inline peut être injecté ou manipulé par un attaquant.  
- **Violation CSP/ModSecurity** : ces attributs sont bloqués par les politiques de sécurité modernes (`Content-Security-Policy`) et les pare‑feux applicatifs (WAF).  
- **Incompatibilité** : provoque des erreurs du CSP.

**Objectif :** aucune logique JavaScript inline dans le HTML, tout doit passer par des `data-action` ou des listeners JS centralisés (`initEventListeners.ts`).
