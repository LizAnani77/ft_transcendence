# Server-Side Pong + API

## Vue d'ensemble

Implémentation du jeu Pong côté serveur avec une API complète permettant l'accès au jeu via interface web et ligne de commande (CLI).

### Glossaire

- **Server-Side (côté serveur)** : Logique de jeu qui s'exécute sur le serveur plutôt que dans le navigateur du joueur
- **API (Application Programming Interface)** : Ensemble de règles et d'endpoints qui permettent aux applications de communiquer avec le serveur
- **Game Loop (boucle de jeu)** : Cycle répétitif qui met à jour l'état du jeu à intervalle régulier (ici 60 fois par seconde)
- **Gameplay** : Les mécaniques et règles qui définissent comment on joue (déplacement, collision, score)

## Architecture

### Logique de jeu côté serveur

Tout le gameplay est géré par le serveur (`ServerGameEngine.ts`) :
- Position et vélocité de la balle
- Détection des collisions
- Calcul des scores
- Gestion des états de jeu

**Avantages** :
- Pas de triche possible
- Synchronisation garantie entre joueurs

#### Définitions de logique de jeu

- **Vélocité** : La vitesse et la direction d'un objet en mouvement (ex: la balle se déplace de 10 pixels vers la droite et 10 vers le haut à chaque frame)
- **Collision** : Moment où deux objets se touchent (balle touche paddle, balle touche mur)
- **État de jeu** : La situation actuelle de la partie (en attente de joueurs, en cours, terminée)

### Game Loop

```
┌─> État du jeu
│   ├─ Mise à jour physique (60 FPS)
│   ├─ Détection collisions
│   ├─ Calcul score
│   └─ Broadcast aux clients
└─────┘
```

#### Définitions du game loop

- **Mise à jour physique** : Calcul des nouvelles positions de tous les objets en mouvement (balle, paddles) basé sur leur vélocité
- **Broadcast** : Envoi simultané du nouvel état du jeu à tous les clients connectés via `game:state_update`
- **Frame** : Une "image" de l'état du jeu à un instant précis, 60 FPS signifie 60 frames (mises à jour) par seconde

## API REST (gestion des matchs de tournoi)

Les routes de jeu gèrent les matchs de tournoi et sont préfixées par `/api/games/` :

```
GET    /api/games/status                              - Statut général du serveur de jeu
POST   /api/games/tournament-match/start              - Démarrer un match de tournoi
POST   /api/games/tournament-match/report             - Reporter le résultat d'un match
GET    /api/games/tournament-match/:tournamentId/:matchId - Détails d'un match spécifique
POST   /api/games/cleanup                             - Nettoyer les éléments obsolètes
```

> **Note** : Il n'y a pas d'endpoint CRUD générique (`/api/games/:id`). Les parties sont créées et gérées via WebSocket et les routes de tournoi.

## WebSocket pour temps réel

### Événements serveur → client

```typescript
// État du jeu (envoyé 60 fois/seconde)
type: 'game:state_update'  → { ball, paddle1, paddle2, scores, maxScore }

// Début de partie
type: 'game:started'       → { gameId, side, opponent }

// Fin de partie
type: 'game:finished'      → { winner, score1, score2, gameId }

// Déconnexion de l'adversaire
type: 'game:player_disconnected'
```

### Commandes client → serveur

```typescript
// Contrôle paddle
type: 'game:input'  → { gameId, direction: 'up' | 'down' | 'stop' }
```

## CLI Integration

### Client en ligne de commande

Un client CLI permet de jouer depuis le terminal :

```bash
$ pong-cli connect
Recherche d'une partie...
Adversaire trouvé : User42

┌────────────────────────┐
│     3  │  2           │
│     │  │  │           │
│     │  ●  │           │
│     │  │  │           │
└────────────────────────┘

Controls: ↑/↓ ou W/S
```

### Authentification CLI

```bash
$ pong-cli login username password
Token sauvegardé.

$ pong-cli play
Connexion au serveur...
```

Le CLI utilise la même API que l'interface web.

## Physique du jeu

### Paramètres réels

```typescript
const GAME_CONFIG = {
  ballSpeedX: 10,       // vitesse horizontale initiale
  ballSpeedY: 10,       // vitesse verticale initiale
  ballRadius: 8,
  paddleHeight: 100,
  paddleWidth: 10,
  boardWidth: 800,
  boardHeight: 600,
  maxScore: 5           // score pour gagner
}
```

#### Définitions des paramètres

- **Physique du jeu** : Ensemble de règles qui simulent le comportement réaliste des objets (mouvement, rebonds, vitesse)
- **Rayon (radius)** : Distance du centre d'un cercle à son bord, ici pour définir la taille de la balle
- **Board (terrain)** : La zone de jeu délimitée où se déroule la partie

### Détection de collision

- **Murs** : Rebond vertical (inverse vy)
- **Paddles** : Rebond horizontal avec modification d'angle
- **But** : Point marqué, reset de la balle

## Persistance et historique

### Sauvegarde des parties

Chaque partie est enregistrée :
- Timestamp de début/fin
- Scores finaux
- Identité des deux joueurs

> **Note** : Il n'y a pas de système de replay (rejouer une partie). Les états successifs ne sont pas stockés, seul le résultat final est persisté.

## Sécurité

- Validation des commandes côté serveur
- Rate limiting sur les requêtes API
- Vérification de l'appartenance au jeu
- Anti-cheat : serveur autoritaire

### Définitions de sécurité

- **Validation des commandes** : Vérification que les actions demandées par le client sont légales et possibles avant de les exécuter
- **Appartenance au jeu** : Vérification qu'un joueur a bien le droit de contrôler un paddle dans une partie donnée
- **Anti-cheat** : Mécanismes pour empêcher la triche (le serveur autoritaire décide de tout, le client ne peut pas mentir sur sa position)
- **Serveur autoritaire** : Le serveur a le dernier mot sur tous les calculs, même si le client envoie des données contradictoires

## Performance

- Game loop optimisé (60 FPS stable)
- Broadcasting efficace de l'état complet à chaque tick
- Nettoyage des parties terminées

### Définitions de performance

- **Performance** : Capacité du système à fonctionner rapidement et efficacement sans ralentissements
- **Stable** : Qui maintient une cadence constante sans variations (60 FPS reste à 60, ne baisse pas)
- **Nettoyage** : Suppression automatique des données de parties terminées pour libérer de la mémoire
