# Live Chat

## Vue d'ensemble

Système de messagerie instantanée permettant aux utilisateurs de communiquer en temps réel, d'inviter à des parties et de gérer leurs interactions sociales.

### Glossaire

- **Messagerie instantanée** : Système de communication qui permet d'échanger des messages texte en temps réel avec d'autres utilisateurs connectés
- **Temps réel** : Communication où les messages sont transmis et affichés instantanément, sans délai perceptible
- **Chat** : Terme anglais pour désigner une conversation textuelle en ligne
- **Conversation** : Une série de messages échangés entre deux ou plusieurs utilisateurs

## Fonctionnalités principales

### Messages directs

- **Conversations privées** : Chat 1-à-1 entre utilisateurs
- **Historique** : Persistance des messages
- **Notifications** : Alertes pour nouveaux messages
- **Statut de lecture** : Vu/non vu

#### Définitions des messages directs

- **1-à-1 (one-to-one)** : Conversation entre deux personnes uniquement, les messages ne sont visibles que par ces deux utilisateurs
- **Historique** : L'ensemble des messages passés sauvegardés, permettant de relire les anciennes conversations
- **Notification** : Une alerte visuelle ou sonore qui informe l'utilisateur qu'il a reçu un nouveau message
- **Statut de lecture** : Indicateur qui montre si le destinataire a vu le message ou non

### Actions sociales

- **Invitations de jeu** : Lancer une partie depuis le chat
- **Profils utilisateurs** : Accès rapide aux profils
- **Blocage** : Bloquer un utilisateur empêche toute communication

#### Définitions des actions sociales

- **Invitation de jeu** : Un message spécial qui permet de défier directement un autre joueur à une partie depuis la fenêtre de chat
- **Profil utilisateur** : Page contenant les informations publiques d'un joueur (statistiques, avatar, historique de parties)
- **Blocage** : Action qui empêche un utilisateur spécifique de vous contacter ou de voir votre activité (protection contre le harcèlement ou spam)

### Notifications système

- **Tournois** : Annonces des prochains matchs
- **Amis** : Notifications quand un ami se connecte
- **Parties** : Résultats de parties

## Interface utilisateur

### Layout

```
┌─────────────────┬──────────────────────┐
│  Conversations  │   Messages actifs    │
│                 │                      │
│  • Ami 1 ●      │  Hey! GG la partie   │
│  • Ami 2 ○      │  Revanche ? 🎮       │
│  • Ami 3 ●      │                      │
│                 │  [Envoyer]           │
└─────────────────┴──────────────────────┘
```

### Indicateurs

- ● Statut en ligne (vert)
- ○ Statut hors ligne (gris)
- Badge de nouveaux messages non lus
- Typing indicator quand l'autre tape

#### Définitions des indicateurs

- **Statut en ligne** : Indicateur visuel (généralement un point vert) qui montre qu'un utilisateur est actuellement connecté et actif
- **Badge** : Une petite pastille numérique (souvent rouge) affichant le nombre de messages non lus
- **Typing indicator** : Animation ou texte qui indique que votre interlocuteur est en train de taper un message (ex: "... est en train d'écrire")

## Fonctionnalités avancées

### Invitations de partie

```
[Message système]
👤 Ami1 vous invite à jouer !
[Accepter] [Refuser]
```

Accepter lance automatiquement une partie multijoueur.

### Blocage d'utilisateurs

Bloquer un utilisateur :
- Empêche la réception de messages
- Cache des conversations
- Refuse automatiquement les invitations
- Reste réversible

### Modération

- Longueur maximale de message : 500 caractères
- Rate limiting pour éviter le spam
- Possibilité de signaler un utilisateur

#### Définitions de modération

- **Modération** : Ensemble de règles et mécanismes pour maintenir un environnement de chat sain et respectueux
- **Rate limiting** : Limitation du nombre de messages qu'un utilisateur peut envoyer dans un laps de temps donné pour prévenir le spam
- **Spam** : Envoi répétitif et abusif de messages non désirés
- **Signalement** : Action permettant de reporter un utilisateur problématique aux administrateurs pour violation des règles

## Architecture technique

### Communication en temps réel

- **WebSocket** pour les messages instantanés
- **Fallback** sur polling si WebSocket indisponible
- **Reconnexion automatique** en cas de déconnexion

#### Définitions de communication

- **Fallback** : Méthode alternative de secours utilisée lorsque la méthode principale (WebSocket) n'est pas disponible
- **Polling** : Technique où le client interroge régulièrement le serveur pour vérifier s'il y a de nouveaux messages (moins efficace que WebSocket mais plus compatible)
- **Reconnexion automatique** : Mécanisme qui rétablit automatiquement la connexion au serveur si elle est interrompue, sans intervention de l'utilisateur

### Stockage

```sql
messages (
  id, sender_id, receiver_id,
  content, timestamp, read
)

blocked_users (
  blocker_id, blocked_id, timestamp
)
```

#### Définitions de stockage

- **sender_id** : Identifiant unique de l'utilisateur qui a envoyé le message
- **receiver_id** : Identifiant unique de l'utilisateur qui reçoit le message
- **content** : Le texte du message lui-même
- **timestamp** : Date et heure précises de l'envoi du message
- **read** : Valeur booléenne (vrai/faux) indiquant si le message a été lu ou non

## API Endpoints

```
GET    /api/chat/conversations     - Liste des conversations
GET    /api/chat/:userId/messages  - Messages avec un utilisateur
POST   /api/chat/send              - Envoyer un message
POST   /api/chat/invite            - Inviter à une partie
POST   /api/chat/block             - Bloquer un utilisateur
DELETE /api/chat/block/:userId     - Débloquer
```

## Événements WebSocket

```typescript
// Réception de message
{ type: 'NEW_MESSAGE', from, content, timestamp }

// Notification système
{ type: 'TOURNAMENT_NEXT', match }

// Invitation de partie
{ type: 'GAME_INVITE', from, gameId }
```

### Définitions des événements

- **Événement** : Un message structuré envoyé via WebSocket pour notifier d'une action ou d'un changement d'état
- **type** : Le type d'événement qui indique au client comment traiter le message (nouveau message, invitation, notification)
- **from** : L'identifiant de l'utilisateur à l'origine de l'événement
- **gameId** : Identifiant unique d'une partie de jeu, permettant de la rejoindre directement

## Expérience utilisateur

- Messages envoyés instantanément
- Scroll automatique vers les nouveaux messages
- Emojis supportés
- Liens vers profils cliquables
- Interface responsive (mobile-friendly)

### Définitions d'expérience utilisateur

- **Scroll automatique** : Défilement automatique de la fenêtre de chat vers le bas pour afficher les messages les plus récents
- **Emoji** : Petites icônes graphiques (😀 🎮 ❤️) qui permettent d'exprimer des émotions ou concepts dans les messages
- **Cliquable** : Élément sur lequel on peut cliquer pour déclencher une action (ici, ouvrir un profil)
- **Responsive** : Interface qui s'adapte automatiquement à la taille de l'écran de l'appareil (ordinateur, tablette, smartphone)
- **Mobile-friendly** : Optimisé pour une utilisation confortable sur téléphone mobile (boutons assez grands, texte lisible)
