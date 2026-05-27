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

- **Défi direct** : Inviter un ami via le chat ou la liste d'amis
- **Synchronisation en temps réel** : WebSocket pour latence minimale
- **Gestion de déconnexion** : Forfait automatique si un joueur quitte

#### Définitions de connexion

- **Défi (challenge)** : Un joueur envoie une invitation de jeu à un autre, qui peut l'accepter ou la refuser
- **Synchronisation** : Processus qui assure que les deux joueurs voient exactement le même état du jeu au même moment

### Expérience de jeu

- **Faible latence** : Optimisation via WebSocket persistant
- **Gestion des déconnexions** : Victoire automatique par forfait si l'adversaire se déconnecte

#### Définitions d'expérience de jeu

- **Forfait** : Abandon ou perte automatique d'une partie lorsqu'un joueur se déconnecte ou quitte

## Architecture technique

### Communication WebSocket

```
Client A ←→ WebSocket Server ←→ Client B
```

- Protocole WebSocket pour communication bidirectionnelle
- Le serveur fait autorité sur l'état du jeu (**authoritative server**)
- Messages JSON pour échange d'état du jeu
- Heartbeat pour détecter les déconnexions

#### Définitions de communication WebSocket

- **Bidirectionnel** : Communication dans les deux sens simultanément, le client et le serveur peuvent tous deux envoyer des messages à tout moment
- **Authoritative server (serveur autoritaire)** : Architecture où le serveur est la source de vérité unique, les clients ne peuvent pas tricher en modifiant localement l'état du jeu
- **Messages JSON** : Données structurées sous forme de texte lisible pour échanger les informations de jeu
- **Heartbeat** : Signal régulier envoyé entre client et serveur pour vérifier que la connexion est toujours active

### Gestion de l'état

- **Authoritative server** : Le serveur calcule tout et envoie l'état complet à chaque tick (60 FPS)
- Le client affiche l'état reçu sans calcul local autonome

## Types de messages

```typescript
// Envoi d'une commande de paddle (client → serveur)
{ type: 'game:input', data: { gameId, direction: 'up' | 'down' | 'stop' } }

// État du jeu (serveur → client, 60 fois/seconde)
{ type: 'game:state_update', data: { ball, paddle1, paddle2, scores, maxScore } }

// Démarrage de partie (serveur → client)
{ type: 'game:started', data: { gameId, side, opponent } }

// Fin de partie (serveur → client)
{ type: 'game:finished', data: { winner, score1, score2 } }

// Déconnexion adverse (serveur → client)
{ type: 'game:player_disconnected' }
```

## Gestion des problèmes réseau

### Déconnexion

- Si un joueur se déconnecte pendant une partie, son adversaire reçoit `game:player_disconnected`
- Le joueur déconnecté perd par forfait

### Reconnexion

- Le client tente de se reconnecter automatiquement au WebSocket
- Une partie en cours **ne peut pas être reprise** après une déconnexion — elle se termine par forfait

## Flow d'une partie

1. **Défi** : Le joueur envoie un `game:challenge` à un ami
2. **Acceptation** : L'adversaire accepte, les deux joueurs reçoivent `game:started`
3. **Partie** : Échange d'état en temps réel via `game:state_update`
4. **Fin** : Les deux joueurs reçoivent `game:finished`, résultat sauvegardé, retour au menu

### Définitions du flow

- **Flow (flux)** : La séquence ordonnée des étapes que traverse une partie du début à la fin
- **Match trouvé** : Moment où l'adversaire a accepté le défi et la partie est initialisée

## Optimisations

- Envoi de l'état complet du jeu à chaque tick (60 fois/seconde)
- Connexions WebSocket persistantes

### Définitions d'optimisation

- **État complet** : L'intégralité de la situation du jeu (positions, scores) envoyée à chaque frame, sans différentiel partiel
- **Bande passante** : La quantité de données qui peuvent être transmises par seconde sur une connexion réseau
