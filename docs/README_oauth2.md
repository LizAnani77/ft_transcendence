## Module OAuth 42 (Authentification distante)

Ce module permet de se connecter au site avec un compte **Intra 42** au lieu d’un mot de passe local.
Il s’appuie uniquement sur l’API officielle OAuth de l’école.

### Résumé

- **Création d'un app sur l'intra de 42** : <https://profile.intra.42.fr/oauth/applications>
- **Vault** : Valeurs dans `.env` (utilisé par `vault/bootstrap/bootstrap.sh`)
- **Backend** : ajout d’un service `OAuth42Service`, de routes `GET /api/auth/oauth42/url` et `GET /api/auth/oauth42/callback`, et d’une table `oauth_accounts` dans SQLite pour relier un utilisateur local à son UID 42. Les comptes OAuth héritent aussi de la 2FA existante.
- **Secrets** : le bootstrap Vault et le template d’agent rendent toutes les variables `OAUTH42_*` (`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `AUTH_URL`, `PROMPT`, etc.) depuis `/secrets/app.env`, ce qui permet au backend de fonctionner en conteneur sans fuite de clés.
- **Frontend** : le formulaire d’authentification affiche un bouton “Continuer avec 42” et une page `/oauth/42/callback` qui finalise le flux côté SPA (chargement, redirection, éventuel passage par la carte 2FA). Les textes EN/FR/ES ont été ajoutés.
- **CSP/WAF** : la politique `img-src` autorise `https://cdn.intra.42.fr` pour afficher les avatars 42.

### Flux en deux étapes

1. Le frontend appelle `/api/auth/oauth42/url` et redirige l’utilisateur vers l’Intra.
2. L’Intra renvoie sur `/oauth/42/callback?code=...&state=...`; la SPA affiche un loader, appelle `/api/auth/oauth42/callback`, puis réceptionne soit un jeton JWT, soit un `requires_2fa` qu’elle traite comme le login classique.

Cette mise en place valide le module « Remote Authentication » du sujet ft_transcendence tout en maintenant les contraintes de Vault, ModSecurity et 2FA.
