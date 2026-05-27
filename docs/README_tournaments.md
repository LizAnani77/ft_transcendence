## Tournois — Comportement, événements et forfaits

### Glossaire

- **Tournoi** : Compétition organisée où plusieurs joueurs s'affrontent dans une série de matchs éliminatoires jusqu'à désigner un champion
- **Round** : Une étape du tournoi (round 1 = demi-finales, round 2 = finale)
- **Forfait** : Abandon d'un match, entraînant la victoire automatique de l'adversaire
- **Deadline** : Limite de temps à laquelle les joueurs doivent être prêts, sinon ils perdent par forfait
- **SPA (Single Page Application)** : Application web qui ne recharge pas la page complète lors de la navigation (tout se passe dans une seule page)
- **WebSocket (WS)** : Connexion permanente permettant la communication en temps réel entre serveur et client
- **Guest (invité)** : Joueur non enregistré qui participe avec un alias temporaire

### TL;DR
- États du tournoi: waiting → active → finished | cancelled
- 4 joueurs, 2 demi-finales (round 1), 1 finale (round 2)
- Préparation match: chaque match en `pending` a p1_ready/p2_ready + deadline à +20s, vérifiée toutes les 5s.
- Forfait d’un joueur: l’adversaire gagne; le round suivant est généré quand tous les matchs du round sont terminés.
- Comportement client :
  - Quitter la vue `game` (navigation SPA / changement de hash / bouton back) pendant un match de tournoi → drop WS (`dropAndReconnect`) ⇒ forfeit immédiat.
  - Logout pendant un match de tournoi → même logique (purge `pendingRemoteGameId`, drop WS, cleanup HTTP en arrière-plan).
  - Refresh (F5) pendant un match de tournoi → envoie un forfeit HTTP via `beforeunload`, mais garde `pendingRemoteGameId` et tente de se ré-attacher au reload (peut décaler la résolution si le POST ne passe pas).
- Forfait du créateur:
  - via HTTP POST /api/tournaments/:id/forfeit: annule seulement si le tournoi est encore en waiting; une fois actif il est traité comme un forfait joueur (le tournoi continue)
  - via déconnexion WebSocket pendant un match → traité comme un forfait joueur (le tournoi continue)
- Pairings: endpoint strictement en lecture (GET /api/tournaments/:id/pairings)
- Événements WS clés: tournament:started, tournament:match_started, tournament:match_finished, tournament:match_forfeited, tournament:match_cancelled, tournament:finished, tournament:cancelled, tournament:round_complete

---

## Rôles, identités et états

- Propriétaire (owner): créateur du tournoi.
- Joueurs authentifiés: userId > 0.
- Invités (guests): userId négatif, dérivé de leur guestToken; le lien alias ↔ token est géré dans guest_sessions.
- États du tournoi: waiting | active | finished | cancelled.

### Définitions des rôles et états

- **Propriétaire/Owner** : Le joueur qui a créé le tournoi et a le droit de le démarrer
- **Joueur authentifié** : Utilisateur connecté avec un compte enregistré dans le système
- **Alias** : Nom d'affichage choisi par un joueur pour le tournoi (peut différer du username)
- **guestToken** : Jeton unique permettant d'identifier un invité temporaire sans compte
- **waiting (en attente)** : État initial où le tournoi attend que les joueurs s'inscrivent
- **active (actif)** : Le tournoi a démarré et les matchs sont en cours
- **finished (terminé)** : Le tournoi est complété avec un champion déclaré
- **cancelled (annulé)** : Le tournoi a été interrompu sans vainqueur

## Cycle de vie d'un tournoi

1) Création et inscriptions (waiting)
- POST /api/tournaments: crée un tournoi (owner enregistré ou guest accepté).
- POST /api/tournaments/:id/join: rejoint avec un alias unique dans le tournoi (accepte userId négatif pour guests).
- Le tournoi démarre avec exactement 4 joueurs.

2) Démarrage (active)
- POST /api/tournaments/:id/start (réservé au propriétaire) place le tournoi en active, crée les 2 matchs de demi-finale (round 1) en status pending et initialise un ready_deadline à +20s.
- Diffusion WS: tournament:started.

### Définitions du cycle de vie

- **Cycle de vie** : La succession d'étapes par lesquelles passe un tournoi depuis sa création jusqu'à sa conclusion
- **Inscription** : Action de rejoindre un tournoi avant son démarrage
- **Demi-finale** : Match éliminatoire entre 4 joueurs (2 matchs, 2 gagnants passent en finale)
- **Finale** : Match final entre les 2 gagnants des demi-finales pour déterminer le champion
- **Pending (en attente)** : Match créé mais pas encore commencé, en attente que les joueurs soient prêts
- **Diffusion WS** : Envoi d'un message via WebSocket à tous les participants concernés

3) Préparation des matchs (pending → active)
- Chaque match a p1_ready/p2_ready et une ready_deadline fixée à +20s dès la création.
- Un job serveur périodique (toutes les 5s) contrôle les deadlines expirées:
  - 1 prêt vs 1 non prêt → forfait du non prêt (status=finished), `tournament:match_forfeited`
  - 0 prêt vs 0 prêt → match terminé sans vainqueur (status=finished, winner_alias=null) + `tournament:match_cancelled`
  - Les matchs où les deux sont prêts sont démarrés par startTournamentMatch; la partie Pong est identifiée par gameId `tournament_{tid}_{matchId}` et `tournament:match_started` est diffusé.

### Définitions de préparation de match

- **p1_ready/p2_ready** : Indicateurs booléens montrant si le joueur 1 et le joueur 2 sont prêts à commencer le match
- **Job serveur périodique** : Tâche automatique qui s'exécute à intervalles réguliers (ici toutes les 5 secondes) pour vérifier les deadlines
- **gameId** : Identifiant unique d'une partie (format `tournament_{tournamentId}_{matchId}` pour les matchs de tournoi)

4) Matchs actifs et fin de partie
- Les parties de tournoi utilisent gameId `tournament_{tournamentId}_{matchId}`.
- Le moteur envoie game:state_update; à la fin, un drain ~100ms déclenche `autoSaveTournamentMatchResult` qui persiste et diffuse `tournament:match_finished` (finale: broadcast global; demi-finales: seulement aux joueurs concernés). `game:finished` est aussi envoyé aux deux joueurs.
- Quand tous les matchs d'un round sont terminés, `generateNextRound` enchaîne:
  - 2 gagnants après round 1 → finale (round 2)
  - 1 gagnant après round 2 → tournoi fini → `tournament:finished`
  - 3 gagnants après round 1 (double forfait) → logique spéciale pour composer la finale
  - Cas invalid_winner_count → tournoi annulé → `tournament:cancelled { reason: 'invalid_winner_count' }`

### Définitions des matchs actifs

- **game:state_update** : Événement envoyé régulièrement pendant la partie pour informer les joueurs de l'état actuel du jeu (position de la balle, score, etc.)
- **Drain** : Un mécanisme de vidange qui traite les résultats en attente après un court délai, ici ~100ms après la fin de la partie
- **Persister** : Sauvegarder de manière permanente les données dans la base de données pour qu'elles ne soient pas perdues
- **Broadcast global** : Envoi d'un message à tous les utilisateurs connectés au système (utilisé pour la finale car tout le monde est intéressé)
- **generateNextRound** : Fonction qui crée automatiquement le prochain round du tournoi en fonction des gagnants du round précédent
- **invalid_winner_count** : Situation anormale où le nombre de gagnants ne correspond pas aux attentes (ni 1, ni 2, ni 3 gagnants), forçant l'annulation du tournoi

## Forfaits: règles et chemins d’exécution

Sources possibles d’un forfait:
1) Route HTTP: POST /api/tournaments/:id/forfeit { playerAlias, reason }
   - Si playerAlias est propriétaire ET tournoi en waiting → annuler le tournoi (status=cancelled), diffusion tournament:cancelled
   - Si tournoi déjà actif (owner ou joueur) → match terminé par forfait (status=finished), diffusion tournament:match_forfeited; la route ne stoppe pas une partie Pong déjà en cours (à faire côté WS)
   - Déclenche la génération du prochain round si tous les matchs du round sont clos

2) Déconnexion WebSocket pendant un match de tournoi actif (déclenchée par le client)
   - Navigation/back/changement de hash: la SPA détecte la sortie de `/game`, drop la WS (`dropAndReconnect('tournament_forfeit_navigation')`), le serveur traite le forfeit immédiatement.
   - Logout en cours de match: supprime `pendingRemoteGameId`, drop WS (`dropAndReconnect('tournament_forfeit_logout')`), puis envoie un forfeit HTTP en arrière-plan; résultat attendu: forfeit immédiat côté serveur.
   - F5/refresh: un forfeit HTTP `reason='disconnected'` est tenté via `beforeunload` (keepalive), mais `pendingRemoteGameId` reste; au reload le client tente de se ré-attacher (peut décaler la résolution si le POST est perdu).
   - Dans tous les cas où le serveur constate la déconnexion WS d’un joueur en match actif, il déclare le forfeit (reason='disconnected'), stoppe la partie, persiste le résultat et diffuse `tournament:match_forfeited`.

3) Déconnexion pendant la fenêtre pending/active (avant la création de la game)
   - Le joueur est déclaré forfait (reason='disconnected'), ce qui évite d’attendre la deadline

4) Deadline expirée (job périodique)
   - Voir règles « 1 prêt vs 1 non prêt » et « 0 vs 0 » ci-dessus

Remarques invitées (guests):
- Lors d'un forfait, d'une annulation ou de la fin de tournoi, le lien alias↔guestToken peut être libéré pour permettre la réutilisation de l'alias dans un futur tournoi.

### Définitions des forfaits

- **Route HTTP** : Un chemin d'API (comme POST /api/tournaments/:id/forfait) qui permet de déclarer un forfait via une requête HTTP standard
- **reason (raison)** : Un paramètre qui indique pourquoi le forfait a eu lieu (navigation, déconnexion, logout, etc.) pour faciliter le débogage et les statistiques
- **dropAndReconnect** : Fonction qui ferme intentionnellement la connexion WebSocket puis tente de la rétablir, utilisée lors de navigations ou changements d'état
- **beforeunload** : Événement du navigateur déclenché juste avant de quitter ou recharger la page, permettant d'envoyer un dernier message au serveur
- **keepalive** : Option d'une requête HTTP qui permet à la requête de continuer même après la fermeture de la page (utilisé avec beforeunload)
- **pendingRemoteGameId** : Variable stockée localement qui indique qu'un joueur est dans une partie en cours, permettant la reconnexion après un refresh
- **Cleanup HTTP** : Processus d'envoi de requêtes pour informer le serveur de l'état du client, exécuté en arrière-plan lors d'une déconnexion
- **Libération du lien alias↔guestToken** : Action de permettre à un alias temporaire d'être réutilisé par un autre invité dans un futur tournoi

## Événements WebSocket (tournament:*)

- started { currentRound }
- player_joined { playerAlias, currentPlayers }
- player_left { playerAlias, participants }
- match_started { matchId, round, player1Alias, player2Alias }
- match_finished { matchId, round, winnerAlias, score? }
- match_forfeited { matchId, round, winnerAlias, reason }
- match_cancelled { matchId, round, reason }
- finished { championAlias, ... }  ← tournoi terminé
- cancelled { reason, ... }        ← tournoi annulé (inclut invalid_winner_count)
- Note: en cas de double non-prêt, le match est marqué finished (winner_alias=null) mais l’événement envoyé est match_cancelled.

Événements jeu (game:*):
- game:started, game:state_update, game:finished, game:player_disconnected (feedback immédiat côté adversaire)

### Définitions des événements WebSocket

- **Événement WebSocket** : Un message structuré envoyé en temps réel via WebSocket pour notifier les clients d'un changement d'état du tournoi
- **tournament:*** : Convention de nommage où le préfixe "tournament:" indique que l'événement concerne le tournoi (par opposition aux événements de jeu "game:*")
- **currentRound** : Le numéro du round actuel du tournoi (1 = demi-finales, 2 = finale)
- **championAlias** : Le nom d'affichage du joueur qui a remporté le tournoi
- **match_cancelled** : Événement spécial envoyé quand un match ne peut pas avoir lieu (généralement quand aucun joueur n'était prêt à temps)
- **game:player_disconnected** : Événement envoyé à l'adversaire pour l'informer immédiatement qu'un joueur s'est déconnecté pendant la partie

## Endpoints REST principaux

- POST /api/tournaments            → créer
- POST /api/tournaments/:id/join   → rejoindre (alias unique)
- POST /api/tournaments/:id/start  → démarrer (owner)
- GET  /api/tournaments/:id/pairings → LECTURE SEULE: renvoie les matchs du round courant avec p1Ready/p2Ready et readyDeadline
- POST /api/tournaments/:id/forfeit → déclarer un forfait (voir sémantique ci-dessus)
- POST /api/tournaments/match/:matchId/result → enregistrer un résultat (non utilisé pendant une partie temps réel; utilisé par l'auto-save du moteur)

### Définitions des endpoints REST

- **Endpoint** : Un point d'accès de l'API identifié par une méthode HTTP (GET, POST, DELETE) et un chemin (URL), permettant d'effectuer une action spécifique
- **POST** : Méthode HTTP utilisée pour créer ou modifier des ressources (créer un tournoi, rejoindre, démarrer, déclarer forfait)
- **GET** : Méthode HTTP utilisée pour récupérer des informations sans modifier l'état du serveur (consulter les pairings)
- **:id** : Paramètre variable dans l'URL représentant l'identifiant unique d'un tournoi (ex: /api/tournaments/123/join)
- **LECTURE SEULE** : L'endpoint ne modifie pas l'état du tournoi, il permet uniquement de consulter les informations actuelles
- **pairings** : Les associations de joueurs pour les matchs du round en cours, incluant leur statut de préparation
- **Sémantique** : Le sens et le comportement précis d'une opération selon le contexte (le forfait se comporte différemment selon l'état du tournoi)
- **Auto-save du moteur** : Sauvegarde automatique déclenchée par le moteur de jeu à la fin d'une partie, sans intervention manuelle

## Détails d'implémentation utiles

- gameId des matchs de tournoi: tournament_{tournamentId}_{matchId}
- La boucle de vidange (drainFinishedSummaries) passe toutes les ~100ms; c'est elle qui envoie game:finished et déclenche l'auto-save tournoi
- startTournamentMatch refuse de démarrer si un des joueurs n'est pas connecté (cohérence UX)
- La génération de round est verrouillée par tournoi pour éviter les courses (tournamentLocks)

### Définitions d'implémentation

- **drainFinishedSummaries** : Une boucle qui vérifie régulièrement (toutes les ~100ms) les parties terminées en attente de traitement pour finaliser leurs résultats
- **Cohérence UX** : Garantir une expérience utilisateur cohérente en évitant des situations problématiques (comme démarrer un match avec un joueur déconnecté)
- **Verrouillage (lock)** : Un mécanisme qui empêche deux processus d'exécuter simultanément la même action, évitant ainsi les incohérences
- **Course (race condition)** : Une situation problématique où deux opérations simultanées tentent de modifier le même état, créant des résultats imprévisibles ou incorrects
- **tournamentLocks** : Un système de verrouillage spécifique qui assure qu'un seul processus à la fois peut générer le prochain round d'un tournoi donné

---
