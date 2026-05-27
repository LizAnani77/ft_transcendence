# i18n — Multiple Language Support

## Objectif
Support multi-langues (EN / FR / ES) pour l’UI avec sélecteur, persistance et accessibilité, sans dépendance clé-en-main.

## Architecture
- **Service** : `frontend/src/core/I18n.ts`
  - Détection : `?lang=xx` > `localStorage` > `navigator.language`.
  - Chargement JSON : `/locales/<lang>.json`.
  - Persistance : `localStorage.lang`.
  - Accessibilité : met à jour `html[lang]`.
  - **Fallback** : si la locale échoue, bascule EN.
- **Bootstrap** : `frontend/src/main.ts`
  - Charge la langue **avant** `app.start()` pour éviter le flash.
- **Sélecteur** : `Navigation.ts` → boutons EN/FR/ES (`data-action="set-lang"`).
- **Event listeners** : `frontend/src/core/initEventListeners.ts`
  - Gestion `set-lang` + garde-fou (pas de reload si la langue est déjà active).
- **Constantes dynamiques** : `frontend/src/constants/navigation.ts`
  - `getNavigationItems()` & `getAppViews()` génèrent labels/titres à la volée.
- **Vues localisées** :
  - `Navigation.ts`, `PageRenderer.ts` (landing/welcome/auth/404), `DashboardRenderer.ts`.
  - Dates via `Intl.*` (format natif selon `html[lang]`).
  - Chat (labels de base).

## Fichiers de traduction
- `frontend/public/locales/en.json`
- `frontend/public/locales/fr.json`
- `frontend/public/locales/es.json`

### Ajouter une clé
1. Ajouter la clé dans **toutes** les locales.
2. Remplacer le texte en dur par `i18n.t('ma.clé')`.

### Clés Tournoi (activité/erreurs/validation)

- Préfixes: `tournament.activity.*`, `tournament.error.*`, `tournament.validation.*`
- Emplacements d'usage:
  - `TournamentService.ts`: création / rejoindre / quitter / démarrer / reset + messages d'attente
  - `WebSocketBinder.ts`: événements temps-réel (annulé, terminé, round, match commencé/terminé, élimination)
  - `TournamentBinder.ts`: validations côté UI et erreurs (chargement liste/historique, join/leave)

Exemples:

- `tournament.activity.createdAwaiting` → `i18n.t('tournament.activity.createdAwaiting').replace('{name}', name).replace('{count}', '3')`
- `tournament.activity.roundComplete` → `i18n.t('tournament.activity.roundComplete').replace('{completedRound}', String(r1)).replace('{nextRound}', String(r2))`
- `tournament.validation.aliasInvalidFormat` → messages de formulaire (alias)
- `tournament.error.failedJoin` → fallback d'erreur réseau lors du join

## WAF / Nginx
Pour éviter les faux positifs ModSecurity sur les JSON statiques :
- `nginx/modsecurity/api-allow.conf`
  ```apache
  SecRule REQUEST_URI "@beginsWith /locales/" "id:100500,phase:1,pass,ctl:ruleEngine=DetectionOnly,nolog,allow"
