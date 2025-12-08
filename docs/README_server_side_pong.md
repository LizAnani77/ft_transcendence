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

Tout le gameplay est géré par le serveur :
- Position et vélocité de la balle
- Détection des collisions
- Calcul des scores
- Gestion des états de jeu

**Avantages** :
- Pas de triche possible
- Synchronisation garantie entre joueurs
- Rejouabilité des parties (replay)

#### Définitions de logique de jeu

- **Vélocité** : La vitesse et la direction d'un objet en mouvement (ex: la balle se déplace de 5 pixels vers la droite et 3 vers le haut à chaque frame)
- **Collision** : Moment où deux objets se touchent (balle touche paddle, balle touche mur)
- **État de jeu** : La situation actuelle de la partie (en attente de joueurs, en cours, terminée)
- **Rejouabilité/Replay** : Capacité à revoir le déroulement d'une partie passée

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

- **Mise à jour physique** : Calcul des nouvelles positions de tous les objets en mouvement (balle, éventuellement paddles) basé sur leur vélocité
- **Broadcast** : Envoi simultané du nouvel état du jeu à tous les clients connectés
- **Frame** : Une "image" de l'état du jeu à un instant précis, 60 FPS signifie 60 frames (mises à jour) par seconde

## API REST

### Endpoints de gestion

```
POST   /api/games              - Créer une partie
GET    /api/games/:id          - État d'une partie
POST   /api/games/:id/join     - Rejoindre une partie
DELETE /api/games/:id          - Quitter/terminer
```

### Endpoints de contrôle

```
POST   /api/games/:id/move     - Déplacer la paddle
GET    /api/games/:id/state    - État en temps réel
GET    /api/games/:id/history  - Historique des événements
```

### Modèle de données

```typescript
Game {
  id: string
  players: [Player, Player]
  ball: { x, y, vx, vy }
  paddles: [{ y, height }, { y, height }]
  score: [number, number]
  state: 'waiting' | 'playing' | 'finished'
  startedAt: timestamp
}
```

#### Définitions du modèle de données

- **Modèle de données** : Structure qui définit comment les informations d'une partie sont organisées et stockées
- **x, y** : Coordonnées de position sur le terrain (x = horizontal, y = vertical)
- **vx, vy** : Composantes de vélocité (vx = vitesse horizontale, vy = vitesse verticale)
- **Timestamp** : Horodatage précis enregistrant le moment exact d'un événement

## WebSocket pour temps réel

### Événements serveur → client

```typescript
// État du jeu
{ type: 'GAME_UPDATE', state }

// Événements
{ type: 'GOAL', player, newScore }
{ type: 'COLLISION', object }
{ type: 'GAME_END', winner }
```

### Commandes client → serveur

```typescript
// Contrôle paddle
{ type: 'PADDLE_MOVE', direction: 'up' | 'down' }
{ type: 'PADDLE_STOP' }

// Actions
{ type: 'READY' }
{ type: 'PAUSE' }
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

### Paramètres

```typescript
const GAME_CONFIG = {
  ballSpeed: 5,
  ballRadius: 10,
  paddleHeight: 100,
  paddleWidth: 10,
  boardWidth: 800,
  boardHeight: 600,
  scoreToWin: 11
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

### Algorithme de collision paddle

```typescript
if (ballOverlapsPaddle(ball, paddle)) {
  ball.vx = -ball.vx
  // Angle basé sur position d'impact
  const relativeY = (ball.y - paddle.y) / paddle.height
  ball.vy += relativeY * 2
}
```

#### Définitions de collision

- **Rebond** : Changement de direction d'un objet lorsqu'il frappe un obstacle
- **Inverse** : Changer le signe (positif devient négatif et vice-versa), ici pour inverser la direction
- **Angle** : Direction du mouvement, modifiée selon l'endroit où la balle frappe le paddle pour varier le jeu
- **Algorithme** : Suite d'instructions précises pour résoudre un problème (ici, détecter et traiter une collision)
- **relativeY** : Position relative de l'impact sur le paddle (haut, centre, bas) qui influence l'angle de rebond

## Persistance et historique

### Sauvegarde des parties

Chaque partie est enregistrée :
- Timestamp de début/fin
- Scores finaux
- Événements clés (goals)
- Statistiques (nombre de hits)

### Replay

Possibilité de rejouer une partie :
- Stockage des états successifs
- Reconstruction du déroulement
- Analyse post-game

#### Définitions de persistance et historique

- **Persistance** : Conservation permanente des données après la fin d'une partie ou l'arrêt du serveur
- **Événements clés** : Moments importants d'une partie qui méritent d'être enregistrés (but marqué, collision spéciale)
- **Hits** : Nombre de fois où la balle a touché un paddle
- **États successifs** : Captures de l'état du jeu à intervalles réguliers permettant de reconstituer le déroulement
- **Post-game** : Analyse effectuée après la fin de la partie

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
- Broadcasting efficace (uniquement les changements)
- Nettoyage des parties terminées
- Pool de connexions WebSocket

### Définitions de performance

- **Performance** : Capacité du système à fonctionner rapidement et efficacement sans ralentissements
- **Optimisé** : Code amélioré pour utiliser moins de ressources (CPU, mémoire) et s'exécuter plus vite
- **Stable** : Qui maintient une cadence constante sans variations (60 FPS reste à 60, ne baisse pas à 30 ou 45)
- **Nettoyage** : Suppression automatique des données de parties terminées pour libérer de la mémoire
- **Pool de connexions** : Ensemble de connexions WebSocket prêtes à l'emploi, réutilisables pour éviter de recréer une nouvelle connexion à chaque fois
