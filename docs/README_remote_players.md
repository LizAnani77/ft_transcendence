# Remote Players

## Vue d'ensemble

Module permettant à deux joueurs sur des ordinateurs différents de jouer au Pong en temps réel via Internet.

### Glossaire

- **Remote (distant)** : Qui se trouve sur un autre ordinateur ou à un autre emplacement géographique, connecté via Internet
- **Multijoueur** : Mode de jeu où plusieurs personnes jouent ensemble en même temps, chacune depuis son propre appareil
- **Latence** : Le délai entre une action (appuyer sur une touche) et sa prise en compte visible à l'écran, mesuré en millisecondes (ms)
- **Ping** : Mesure de la latence réseau entre votre ordinateur et le serveur, exprimée en millisecondes (ex: 50ms = excellent, 200ms = lent)

## Fonctionnalités principales

### Connexion multijoueur

- **Matchmaking** : Association automatique de joueurs
- **Création de partie** : Invitation directe d'un ami
- **Synchronisation en temps réel** : WebSocket pour latence minimale
- **Gestion de connexion** : Reconnexion automatique en cas de déconnexion

#### Définitions de connexion

- **Matchmaking** : Système qui associe automatiquement des joueurs de niveau similaire pour créer une partie équilibrée
- **Synchronisation** : Processus qui assure que les deux joueurs voient exactement le même état du jeu au même moment
- **Reconnexion** : Capacité du jeu à rétablir automatiquement la connexion si elle est temporairement perdue

### Expérience de jeu

- **Faible latence** : Optimisation des communications réseau
- **Prédiction côté client** : Fluidité même avec latence
- **Gestion des déconnexions** : Pause automatique ou victoire par forfait
- **Indicateur de latence** : Affichage du ping en jeu

#### Définitions d'expérience de jeu

- **Prédiction côté client** : Technique où votre ordinateur anticipe les mouvements avant la confirmation du serveur pour un jeu plus réactif
- **Forfait** : Abandon ou perte automatique d'une partie lorsqu'un joueur se déconnecte ou quitte
- **Indicateur de latence** : Affichage visuel (nombre ou couleur) qui montre la qualité de votre connexion en temps réel

## Architecture technique

### Communication WebSocket

```
Client A ←→ WebSocket Server ←→ Client B
```

- Protocole WebSocket pour communication bidirectionnelle
- Messages JSON pour échange d'état du jeu
- Heartbeat pour détecter les déconnexions

#### Définitions de communication WebSocket

- **Bidirectionnel** : Communication dans les deux sens simultanément, le client et le serveur peuvent tous deux envoyer des messages à tout moment
- **Messages JSON** : Données structurées sous forme de texte lisible (format JavaScript Object Notation) pour échanger les informations de jeu
- **Heartbeat** : Signal régulier envoyé entre client et serveur pour vérifier que la connexion est toujours active (comme un battement de cœur)

### Gestion de l'état

- **Authoritative server** : Le serveur fait autorité sur l'état du jeu
- **Client prediction** : Anticipation locale pour réactivité
- **Reconciliation** : Correction des divergences

#### Définitions de gestion de l'état

- **Authoritative server (serveur autoritaire)** : Architecture où le serveur est la source de vérité unique, les clients ne peuvent pas tricher en modifiant localement l'état du jeu
- **Client prediction** : Le client simule immédiatement le résultat de ses actions localement sans attendre la confirmation du serveur pour une meilleure réactivité
- **Reconciliation** : Processus de correction qui ajuste l'état local du client si celui-ci diffère de la version officielle du serveur
- **Divergence** : Différence entre ce que voit le client localement et l'état réel du jeu sur le serveur

## Types de messages

```typescript
// Mouvement de paddle
{ type: 'PADDLE_MOVE', playerId, position }

// État du jeu
{ type: 'GAME_STATE', ball, paddles, score }

// Événements
{ type: 'GOAL', scorer }
{ type: 'GAME_END', winner }
```

## Gestion des problèmes réseau

### Latence élevée

- Interpolation des mouvements
- Buffer de commandes
- Affichage du ping

#### Définitions de gestion de latence

- **Interpolation** : Technique qui calcule les positions intermédiaires d'un objet pour créer un mouvement fluide même si les mises à jour du serveur arrivent espacées
- **Buffer** : Zone de mémoire temporaire qui stocke les commandes en attente de traitement pour lisser les variations de latence
- **Latence élevée** : Connexion lente où le délai entre action et réaction dépasse 100-150ms, rendant le jeu moins réactif

### Déconnexion

- Timeout de 10 secondes
- Notification à l'adversaire
- Sauvegarde du résultat si le jeu était en cours

### Reconnexion

- Reprise de la partie si possible
- Resynchronisation de l'état

#### Définitions de déconnexion/reconnexion

- **Timeout** : Délai d'attente maximum avant de considérer qu'un joueur est définitivement déconnecté (ici 10 secondes)
- **Notification** : Message affiché à l'autre joueur pour l'informer que son adversaire a perdu la connexion
- **Resynchronisation** : Processus de mise à jour de l'état local du jeu pour correspondre à l'état actuel sur le serveur après une reconnexion

## Flow d'une partie

1. **Recherche** : Le joueur lance le matchmaking
2. **Match trouvé** : Connexion WebSocket établie
3. **Countdown** : 3-2-1 avant le début
4. **Partie** : Échange en temps réel
5. **Fin** : Résultat sauvegardé, retour au menu

### Définitions du flow

- **Flow (flux)** : La séquence ordonnée des étapes que traverse une partie du début à la fin
- **Countdown (compte à rebours)** : Décompte avant le début de la partie donnant aux joueurs le temps de se préparer
- **Match trouvé** : Moment où le système a trouvé un adversaire approprié et initialise la partie

## Optimisations

- Compression des messages WebSocket
- Envoi uniquement des deltas d'état
- Throttling des mises à jour (60 FPS)
- Interpolation pour compenser la latence

### Définitions d'optimisation

- **Compression** : Réduction de la taille des messages envoyés sur le réseau pour économiser la bande passante et accélérer la transmission
- **Delta** : Seulement les changements depuis le dernier état, plutôt que l'état complet (ex: envoyer "paddle a bougé de 5px" au lieu de "paddle est à position 125")
- **Throttling** : Limitation de la fréquence d'envoi des mises à jour (ici 60 par seconde) pour ne pas surcharger le réseau
- **FPS (Frames Per Second)** : Nombre d'images par seconde, ici 60 FPS signifie 60 mises à jour de l'état du jeu par seconde
- **Bande passante** : La quantité de données qui peuvent être transmises par seconde sur une connexion réseau
