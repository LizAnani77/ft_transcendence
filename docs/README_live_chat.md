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
- **Notifications** : Badges de messages non lus
- **Statut de lecture** : Vu/non vu

#### Définitions des messages directs

- **1-à-1 (one-to-one)** : Conversation entre deux personnes uniquement, les messages ne sont visibles que par ces deux utilisateurs
- **Historique** : L'ensemble des messages passés sauvegardés, permettant de relire les anciennes conversations
- **Badge** : Une petite pastille numérique affichant le nombre de messages non lus

### Actions sociales

- **Invitations de jeu** : Lancer une partie depuis le chat
- **Profils utilisateurs** : Accès rapide aux profils
- **Blocage** : Bloquer un utilisateur empêche toute communication

#### Définitions des actions sociales

- **Invitation de jeu** : Un message spécial qui permet de défier directement un autre joueur à une partie depuis la fenêtre de chat
- **Profil utilisateur** : Page contenant les informations publiques d'un joueur (statistiques, avatar, historique de parties)
- **Blocage** : Action qui empêche un utilisateur spécifique de vous contacter ou de voir votre activité (protection contre le harcèlement ou spam)

### Notifications système

- Notifications disponibles via `GET /api/chat/notifications`
- Marquage lu/non-lu individuel et global

## Interface utilisateur

### Layout

```
┌─────────────────┬──────────────────────┐
│  Conversations  │   Messages actifs    │
│                 │                      │
│  • Ami 1 ●      │  Hey! GG la partie   │
│  • Ami 2 ○      │  Revanche ?          │
│  • Ami 3 ●      │                      │
│                 │  [Envoyer]           │
└─────────────────┴──────────────────────┘
```

### Indicateurs

- ● Statut en ligne (vert)
- ○ Statut hors ligne (gris)
- Badge de nouveaux messages non lus

#### Définitions des indicateurs

- **Statut en ligne** : Indicateur visuel (généralement un point vert) qui montre qu'un utilisateur est actuellement connecté et actif
- **Badge** : Une petite pastille numérique (souvent rouge) affichant le nombre de messages non lus

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

- Longueur maximale de message : **500 caractères**
- Rate limiting pour éviter le spam (max 1 message par seconde)

#### Définitions de modération

- **Modération** : Ensemble de règles et mécanismes pour maintenir un environnement de chat sain et respectueux
- **Rate limiting** : Limitation du nombre de messages qu'un utilisateur peut envoyer dans un laps de temps donné pour prévenir le spam

## Architecture technique

### Communication en temps réel

- **WebSocket** pour les messages instantanés
- **Fallback HTTP** si l'envoi WebSocket échoue
- **Reconnexion automatique** en cas de déconnexion

#### Définitions de communication

- **Fallback HTTP** : Méthode alternative de secours qui envoie les messages via HTTP standard lorsque l'envoi WebSocket échoue
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
GET    /api/chat/conversations                    - Liste des conversations
GET    /api/chat/conversation/:userId             - Conversation avec un utilisateur
GET    /api/chat/conversations/:conversationId/messages - Messages d'une conversation
POST   /api/chat/messages                         - Envoyer un message privé
POST   /api/chat/global                           - Envoyer un message global
GET    /api/chat/global                           - Messages du chat global
POST   /api/chat/game-challenge                   - Envoyer un défi de jeu
POST   /api/chat/block                            - Bloquer un utilisateur
DELETE /api/chat/block/:userId                    - Débloquer
GET    /api/chat/blocked                          - Liste des utilisateurs bloqués
GET    /api/chat/notifications                    - Notifications de l'utilisateur
PUT    /api/chat/notifications/:id/read           - Marquer une notification comme lue
PUT    /api/chat/notifications/read-all           - Marquer toutes comme lues
POST   /api/chat/mark-conversation-read           - Marquer une conversation comme lue
GET    /api/chat/unread-counts                    - Compteurs de messages non lus
```

## Événements WebSocket

```typescript
// Réception d'un message privé (serveur → client)
type: 'chat:private_message'

// Réception d'un message global (serveur → client)
type: 'chat:global_message'

// Défi de jeu reçu (serveur → client)
type: 'game:challenge_received'

// Envoi d'un message privé (client → serveur)
type: 'chat:private_message'

// Envoi d'un message global (client → serveur)
type: 'chat:global_message'

// Envoi d'un défi de jeu (client → serveur)
type: 'game:challenge'
```

### Définitions des événements

- **Événement** : Un message structuré envoyé via WebSocket pour notifier d'une action ou d'un changement d'état
- **type** : Le type d'événement qui indique au client comment traiter le message (nouveau message, invitation, notification)

## Expérience utilisateur

- Messages envoyés instantanément
- Scroll automatique vers les nouveaux messages
- Emojis supportés
- Interface responsive (mobile-friendly)

### Définitions d'expérience utilisateur

- **Scroll automatique** : Défilement automatique de la fenêtre de chat vers le bas pour afficher les messages les plus récents
- **Emoji** : Petites icônes graphiques (😀 🎮 ❤️) qui permettent d'exprimer des émotions ou concepts dans les messages
- **Responsive** : Interface qui s'adapte automatiquement à la taille de l'écran de l'appareil (ordinateur, tablette, smartphone)
