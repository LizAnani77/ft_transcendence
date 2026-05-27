# Architecture TypeScript - ft_transcendence
Documentation des fichiers TypeScript avec leurs fonctions essentielles et leur rôle.
---

## 📁 BACKEND

### `backend/src/config/limits.ts`

**`USER_LIMITS`**
  → Configuration

**`CHAT_LIMITS`**
  → Configuration

**`TOURNAMENT_LIMITS`**
  → Configuration

**`GAME_LIMITS`**
  → Configuration

**`DATABASE_LIMITS`**
  → Configuration

**`SECURITY_LIMITS`**
  → Configuration

**`WEBSOCKET_LIMITS`**
  → Configuration

**`LIMITS`**
  → Configuration

---



### `backend/src/game/ServerGameEngine.ts`

**Classe `ServerGameEngine`**
  • `startGame(gameId: string)` → Démarre la boucle de jeu pour une partie 
  • `endGame(gameId: string)` → Termine une partie proprement 
  • `resetFinishedGame(gameId: string)` → Réinitialise une partie finie pour un rematch (scores=0, positions reset) 
  • `processPlayerInput(gameId: string, input: PlayerInput)` → Traite les entrées des joueurs (map userId → bon paddle) 
  • `updatePlayerConnection(gameId: string, userId: number, conne...)` → Met à jour le statut de connexion d'un joueur 
  • `tryResumeGame(gameId: string)` → Reprend une partie si les deux joueurs sont connectés 
  • `getGameState(gameId: string)` → Retourne l'état d'une partie 
  • `getActiveGames()` → Retourne toutes les parties actives 
  • `removeGame(gameId: string)` → Supprime une partie terminée 
  • `cancelGame(gameId: string)` → Annule une partie sans l'enregistrer comme 'finished' (pas de résumé, pas de DB) 
  • `cleanup()` → Nettoie les parties inactives 
  • `drainFinishedSummaries()` → Draine les parties terminées pour notification 

---



### `backend/src/middleware/tournamentAuth.ts`

**Interfaces**
  • `TournamentAuthUser`

**Fonctions**
  • `tournamentAuthMiddleware()`
  • `extractUserIdentifier()`

---


### `backend/src/routes/auth.ts`

**POST /register**
  → Inscription d'un utilisateur 

**POST /login**
  → Connexion d'un utilisateur 

**POST /login/2fa**
  → Étape 2 du login (2FA) : valide le TOTP contre le secret en base, renvoie le token final 

**GET /oauth42/url**
  → Endpoint API

**GET /oauth42/callback**
  → Endpoint API

**GET /me**
  → Récupère le profil de l'utilisateur connecté 

**GET /language**
  → Récupère la langue préférée 

**PUT /language**
  → Met à jour la langue préférée 

**POST /2fa/setup**
  → Démarre l’enrôlement 2FA (user connecté) : génère et stocke un secret + otpauth URL 

**POST /2fa/activate**
  → Valide un code (après scan du QR) et ACTIVE le 2FA pour le compte 

**POST /2fa/disable**
  → Désactive le 2FA après vérification d'un code valide

**GET /dashboard/stats**
  → ===== NOUVELLE ROUTE DASHBOARD ===== 

**PUT /profile**
  → Met à jour le profil de l'utilisateur connecté 

**POST /logout**
  → Déconnecte l'utilisateur courant 

**GET /users/search**
  → Recherche des utilisateurs (exclut l'utilisateur courant) 

**POST /friends/add**
  → Envoie une demande d'ami 

**POST /friends/accept**
  → Accepte une demande d'ami 

**DELETE /friends/decline/:friendId**
  → Refuse une demande d'ami 

**DELETE /friends/:friendId**
  → Supprime un ami existant 

**GET /friends**
  → Récupère la liste des amis de l'utilisateur 

**GET /friends/requests**
  → Récupère les demandes d'ami en attente 

**GET /users/:userId/matches**
  → Récupère l'historique des matches d'un utilisateur 

**POST /matches**
  → Crée un match (outil de test) 

**GET /users/:userId/stats**
  → Récupère les statistiques d'un utilisateur 

**GET /ranking**
  → Classement global (leaderboard simple) 

**GET /users/:userId/rank**
  → Rang d'un utilisateur donné (position actuelle) 

**GET /2fa/health**
  → Health 2FA (vérifie conf + état utilisateur) 

**`authRoutes`**
  → Enregistre les routes d'authentification et initialise les dépendances 

---



### `backend/src/routes/chat.ts`

**GET /global**
  → Récupérer les messages du chat global 

**POST /global**
  → Envoyer un message dans le chat global avec vérification de blocage 

**GET /conversations**
  → Récupérer les conversations privées de l'utilisateur 

**GET /conversations/:conversationId/messages**
  → Récupérer les messages d'une conversation privée 

**GET /conversation/:userId**
  → Obtenir la conversation privée entre deux utilisateurs 

**POST /messages**
  → Envoyer un message privé avec vérification de blocage 

**GET /unread-counts**
  → Obtenir les compteurs de messages non lus 

**POST /mark-read**
  → Marquer les messages d'un utilisateur comme lus 

**POST /mark-conversation-read**
  → Marquer tous les messages d'une conversation comme lus 

**POST /block**
  → Bloquer un utilisateur 

**DELETE /block/:userId**
  → Débloquer un utilisateur 

**GET /blocked**
  → Récupérer la liste des utilisateurs bloqués 

**POST /friend-request**
  → Envoyer une demande d'ami 

**POST /game-challenge**
  → Envoyer un défi de jeu 

**POST /game-invite**
  → Envoyer une invitation de jeu via chat avec vérification de blocage 

**GET /notifications**
  → Récupérer les notifications de l'utilisateur 

**PUT /notifications/:id/read**
  → Marquer une notification comme lue 

**PUT /notifications/read-all**
  → Marquer toutes les notifications comme lues 

**`chatRoutes`**
  → Enregistre les routes de chat et initialise les dépendances 

---



### `backend/src/routes/games.ts`

**GET /status**
  → GET /status — Retourne le statut général du serveur de jeu 

**POST /tournament-match/start**
  → POST /tournament-match/start — Démarre un match de tournoi spécifique 

**POST /tournament-match/report**
  → POST /tournament-match/report — Reporte le résultat d'un match de tournoi terminé 

**GET /tournament-match/:tournamentId/:matchId**
  → GET /tournament-match/:tournamentId/:matchId — Récupère les détails d'un match spécifique 

**POST /cleanup**
  → POST /cleanup — Nettoie les éléments obsolètes liés aux tournois 

**`default`**
  → Routes de jeux (tournois & matchs) 

---



### `backend/src/routes/guest.ts`

**POST /token**
  → Génère un nouveau token guest 

**GET /validate**
  → Valide un token guest existant 

**GET /guest/session**
  → Récupère les informations d'une session guest 

**DELETE /guest/session**
  → Supprime une session guest (déconnexion) 

**`guestRoutes`**
  → Fonction par défaut

---



### `backend/src/routes/tournaments.ts`

**POST /guest/token**
  → Endpoint API

**GET /guest/validate**
  → Endpoint API

**GET /**
  → Endpoint API

**GET /history**
  → Endpoint API

**POST /:id/quit**
  → Endpoint API

**POST /**
  → Endpoint API

**POST /:id/join**
  → Endpoint API

**POST /:id/forfeit**
  → Endpoint API

**GET /:id/check-participation**
  → Endpoint API

**POST /:id/start**
  → Endpoint API

**GET /:id/bracket**
  → Endpoint API

**GET /:id/pairings**
  → Endpoint API

**POST /match/:matchId/result**
  → N'envoie PLUS de messages chat ici - c'est fait dans server.ts via generateNextRound()

**`default`**
  → Fonction par défaut

---



### `backend/src/server.ts`

**Fonctions**
  • `broadcastTournamentUpdate()`
  • `sendTournamentChatMessage()`
  • `notifyFriendsOnlineStatus()`
  • `handleTournamentForfeit()`
  • `getTournamentMatchByGameId()`
  • `autoSaveTournamentMatchResult()`
  • `generateNextRound()`
  • `checkExpiredDeadlines()`
  • `startTournamentMatch()`
  • `wsHandler()`
  • `broadcastGameState()`

**Enregistrements Fastify**
  • `app.register(fastifyCors)`
  • `app.register(fastifyJWT)`
  • `app.register(fastifyWebsocket)`
  • `app.register(gameRoutes)`
  • `app.register(tournamentRoutes)`
  • `app.register(authRoutes)`
  • `app.register(guestRoutes)`
  • `app.register(chatRoutes)`
  • `app.register(async)`

---


### `backend/src/services/database.chats.ts`

**Classe `ChatOperations`**
  • `constructor(private db: sqlite3.Database)` → Méthode
  • `getOrCreatePrivateConversation(user1Id: number, user2Id: number)` → CONVERSATIONS 
  • `getMessages(conversationId: number, userId: numbe...)` → Récupère les messages en filtrant UNIQUEMENT par blocage utilisateur 
  • `getUserConversations(userId: number)` → Méthode
  • `getLastUserMessage(userId: number, conversationId: number)` → Méthode
  • `blockUser(blockerId: number, blockedId: number,...)` → BLOCKING 
  • `unblockUser(blockerId: number, blockedId: number)` → Méthode
  • `isUserBlocked(userId: number, otherUserId: number)` → Méthode
  • `getBlockedUsers(userId: number)` → Méthode
  • `createNotification(userId: number, type: string, title: ...)` → NOTIFICATIONS 
  • `getUserNotifications(userId: number, limit: number = 20, u...)` → Méthode
  • `getUnreadNotificationCount(userId: number)` → Méthode
  • `markNotificationAsRead(notificationId: number, userId: number)` → Méthode
  • `markAllNotificationsAsRead(userId: number)` → Méthode
  • `createFriendRequest(requesterId: number, requestedId: num...)` → FRIEND REQUESTS 
  • `createGameChallenge(challengerId: number, challengedId: n...)` → Méthode
  • `markMessageAsRead(messageId: number, userId: number)` → MESSAGE READS 
  • `markConversationMessagesAsRead(conversationId: number, userId: number)` → Méthode
  • `markUserMessagesAsRead(currentUserId: number, otherUserId: n...)` → Méthode
  • `getUnreadChatCounts(userId: number)` → Compteurs de messages non lus (exclut UNIQUEMENT les messages des utilisateurs bloqués) 
  • `COUNT(*)` → Méthode
  • `MAX(m.created_at)` → Méthode
  • `getTotalUnreadChatCount(userId: number)` → Total messages non lus (exclut UNIQUEMENT les messages des utilisateurs bloqués) 
  • `getUnreadMessageCounts(userId: number)` → Récupère les compteurs de messages non lus groupés par utilisateur (pour les notifications WebSocket) 
  • `isMessageRead(messageId: number, userId: number)` → Méthode
  • `cleanupOldMessageReads(daysOld: number = 30)` → Méthode

---



### `backend/src/services/database.schema.ts`

**Classe `DatabaseSchema`**
  • `constructor(private db: sqlite3.Database)` → Méthode
  • `initialize()` → Initialise le schéma de la base de données et effectue toutes les migrations nécessaires 
  • `resolve()` → Méthode
  • `reject(error)` → Méthode
  • `UNIQUE(provider, provider_user_id)` → Méthode

---



### `backend/src/services/database.tournaments.ts`

**Classe `TournamentOperations`**
  • `constructor(private db: sqlite3.Database)` → Méthode
  • `isUserInActiveTournament(userId: number)` → Vérifie si un utilisateur est dans un tournoi actif 
  • `cancelTournament(tournamentId: number)` → Annule complètement un tournoi 
  • `isOwnerAlias(tournamentId: number, playerAlias: st...)` → Vérifie si un alias est le créateur 
  • `findCurrentMatch(tournamentId: number, playerAlias: st...)` → Trouve le match actuel d'un joueur 
  • `AND(player1_alias = ? OR player2_alias = ?)` → Méthode
  • `declareForfeit(tournamentId: number, forfeitingAlias...)` → Déclare un forfait et détermine le gagnant 
  • `createTournament(name: string, status: string = 'waiti...)` → Crée un nouveau tournoi avec validation du nom, statut et nombre de joueurs 
  • `getTournament(tournamentId: number)` → Récupère les informations complètes d'un tournoi par son ID 
  • `updateTournament(tournamentId: number, updates: Partia...)` → Met à jour les propriétés d'un tournoi (status, round, dates) 
  • `getOpenTournaments(limit: number = 20)` → Récupère la liste des tournois en attente avec places disponibles 
  • `COALESCE(COUNT(ta.id)` → Méthode
  • `addTournamentAlias(tournamentId: number, playerAlias: st...)` → Ajoute un joueur au tournoi avec son alias, vérifie les contraintes et la disponibilité 
  • `VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)` → Méthode
  • `getTournamentAliases(tournamentId: number)` → Récupère tous les alias (pseudonymes) des participants d'un tournoi 
  • `getTournamentAliasCount(tournamentId: number)` → Compte le nombre de participants inscrits dans un tournoi 
  • `aliasExistsInTournament(tournamentId: number, playerAlias: st...)` → Vérifie si un alias existe déjà dans un tournoi donné 
  • `getUserIdByAlias(tournamentId: number, playerAlias: st...)` → Récupère l'ID utilisateur associé à un alias dans un tournoi spécifique 
  • `createTournamentMatchAlias(tournamentId: number, round: number, ...)` → Crée un nouveau match de tournoi avec les alias des joueurs 

---



### `backend/src/services/database.ts`

**Classe `DatabaseService`**
  • `constructor()` → Méthode
  • `setTimeout(()` → Méthode
  • `reject(error)` → Méthode
  • `resolve()` → Méthode
  • `initialize()` → Méthode
  • `createUser(username: string, password_hash: stri...)` → Délégation des méthodes utilisateurs 
  • `getUserByUsername(username: string)` → Méthode
  • `getUserByEmail(email: string)` → Méthode
  • `getUserByOAuth(provider: string, providerUserId: string)` → Méthode
  • `getUserById(id: number)` → Méthode
  • `updateLastLogin(userId: number)` → Méthode
  • `setUserOffline(userId: number)` → Méthode
  • `updateUserProfile(userId: number, updates: Partial<Pick...)` → Méthode
  • `getUserStats(userId: number)` → Méthode
  • `addFriend(userId: number, friendId: number)` → Méthode
  • `acceptFriend(userId: number, friendId: number)` → Méthode
  • `declineFriend(userId: number, friendId: number)` → Méthode
  • `removeFriend(userId: number, friendId: number)` → Méthode
  • `getFriendshipStatus(userId: number, friendId: number)` → Méthode
  • `getFriends(userId: number)` → Méthode
  • `getPendingFriendRequests(userId: number)` → Méthode
  • `createGame(player1Id: number, player2Id: number,...)` → Méthode
  • `getUserMatchHistory(userId: number, limit: number = 20)` → Méthode
  • `searchUsers(searchTerm: string, excludeUserId?: n...)` → Méthode
  • `getUserCount()` → Méthode
  • `getLeaderboard(limit: number = 20, offset: number = 0)` → Méthode
  • `getUserRank(userId: number)` → Méthode
  • `setTwoFactorSecret(userId: number, secret: string)` → Méthode
  • `activateTwoFactor(userId: number)` → Méthode
  • `disableTwoFactor(userId: number)` → Méthode
  • `getTwoFactorData(userId: number)` → Méthode
  • `getOnlineUsers()` → Méthode
  • `getOAuthAccount(provider: string, providerUserId: string)` → Méthode
  • `createTournament(name: string, status: string = 'waiti...)` → Délégation des méthodes tournois 
  • `getTournament(tournamentId: number)` → Méthode
  • `isUserInActiveTournament(userId: number)` → Méthode
  • `updateTournament(tournamentId: number, updates: Partia...)` → Méthode
  • `getOpenTournaments(limit: number = 20)` → Méthode
  • `addTournamentAlias(tournamentId: number, playerAlias: st...)` → Méthode
  • `getTournamentAliases(tournamentId: number)` → Méthode
  • `getTournamentAliasCount(tournamentId: number)` → Méthode
  • `aliasExistsInTournament(tournamentId: number, playerAlias: st...)` → Méthode
  • `createTournamentMatchAlias(tournamentId: number, round: number, ...)` → Méthode
  • `updateTournamentMatchAlias(matchId: number, winnerAlias: string,...)` → Méthode
  • `getTournamentMatchesAliases(tournamentId: number, round?: number)` → Méthode
  • `getPendingMatchesCount(tournamentId: number, round: number)` → Méthode
  • `getRoundWinners(tournamentId: number, round: number)` → Méthode
  • `saveTournamentResultAlias(tournamentId: number, playerAlias: st...)` → Méthode
  • `getTournamentHistoryByAlias(playerAlias: string, limit: number = 10)` → Méthode
  • `saveTournamentResult(tournamentId: string, userId: number,...)` → Méthode
  • `updateTournamentStats(userId: number, isWinner: boolean)` → Méthode
  • `getUserTournamentHistory(userId: number, limit: number = 10)` → Méthode
  • `getOrCreatePrivateConversation(user1Id: number, user2Id: number)` → Délégation des méthodes chat 
  • `getMessages(conversationId: number, userId: numbe...)` → Méthode
  • `getUserConversations(userId: number)` → Méthode
  • `blockUser(blockerId: number, blockedId: number,...)` → Méthode
  • `unblockUser(blockerId: number, blockedId: number)` → Méthode
  • `isUserBlocked(userId: number, otherUserId: number)` → Méthode
  • `getBlockedUsers(userId: number)` → Méthode
  • `getLastUserMessage(userId: number, conversationId: number)` → Méthode
  • `createNotification(userId: number, type: string, title: ...)` → Méthode
  • `getUserNotifications(userId: number, limit: number = 20, u...)` → Méthode
  • `getUnreadNotificationCount(userId: number)` → Méthode
  • `markNotificationAsRead(notificationId: number, userId: number)` → Méthode
  • `markAllNotificationsAsRead(userId: number)` → Méthode
  • `createFriendRequest(requesterId: number, requestedId: num...)` → Méthode
  • `createGameChallenge(challengerId: number, challengedId: n...)` → Méthode
  • `markMessageAsRead(messageId: number, userId: number)` → Méthode
  • `markConversationMessagesAsRead(conversationId: number, userId: number)` → Méthode
  • `markUserMessagesAsRead(currentUserId: number, otherUserId: n...)` → Méthode
  • `getUnreadChatCounts(userId: number)` → Méthode
  • `getTotalUnreadChatCount(userId: number)` → Méthode
  • `isMessageRead(messageId: number, userId: number)` → Méthode
  • `cleanupOldMessageReads(daysOld: number = 30)` → Méthode
  • `getUnreadMessageCounts(userId: number)` → Récupère les compteurs de messages non lus par utilisateur (pour les notifications en temps réel) 
  • `dbGet(query: string, params: any[] = [])` → Méthode helper pour accès direct (utilisée en interne) 
  • `dbAll(query: string, params: any[] = [])` → Méthode
  • `dbRun(query: string, params: any[] = [])` → Méthode
  • `close()` → Méthode

**`MAX_CHAT_CHARS`**
  → Configuration

---



### `backend/src/services/database.types.ts`

**Interfaces**
  • `User`
  • `UserStats`
  • `LeaderboardEntry`
  • `Tournament`
  • `TournamentAlias`
  • `TournamentMatchAlias`
  • `OAuthAccount`

---


### `backend/src/services/database.users.ts`

**Classe `UserOperations`**
  • `constructor(private db: sqlite3.Database)` → Méthode
  • `reject(new Error(`Database query failed: ${e...)` → Méthode
  • `resolve(row)` → Méthode
  • `createUser(username: string, password_hash: stri...)` → Crée un nouvel utilisateur avec ses statistiques et retourne l'objet utilisateur 
  • `getUserByUsername(username: string)` → Récupère un utilisateur par son nom d'utilisateur 
  • `getUserByEmail(email: string)` → Récupère un utilisateur par son adresse email 
  • `getUserByOAuth(provider: string, providerUserId: string)` → Récupère un utilisateur via son compte OAuth (provider et ID externe) 
  • `VALUES(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ...)` → Méthode
  • `getOAuthAccount(provider: string, providerUserId: string)` → Récupère les informations d'un compte OAuth par provider et ID externe 
  • `getUserById(id: number)` → Récupère un utilisateur par son ID 
  • `updateLastLogin(userId: number)` → Met à jour la dernière connexion et marque l'utilisateur comme en ligne 
  • `setUserOffline(userId: number)` → Marque un utilisateur comme hors ligne 
  • `updateUserProfile(userId: number, updates: Partial<Pick...)` → Met à jour le profil utilisateur (username, email, avatar) et retourne l'utilisateur mis à jour 
  • `getUserStats(userId: number)` → Récupère les statistiques de jeu d'un utilisateur 
  • `addFriend(userId: number, friendId: number)` → Envoie une demande d'ami ou accepte automatiquement si une demande inverse existe 
  • `acceptFriend(userId: number, friendId: number)` → Accepte une demande d'ami en attente et crée la relation bidirectionnelle 
  • `declineFriend(userId: number, friendId: number)` → Refuse une demande d'ami en attente 
  • `removeFriend(userId: number, friendId: number)` → Supprime complètement une relation d'amitié entre deux utilisateurs 
  • `getFriendshipStatus(userId: number, friendId: number)` → Récupère le statut de la relation d'amitié entre deux utilisateurs 
  • `getFriends(userId: number)` → Récupère la liste des amis acceptés d'un utilisateur avec dates et statuts 
  • `getPendingFriendRequests(userId: number)` → Récupère les demandes d'ami en attente reçues par un utilisateur 
  • `createGame(player1Id: number, player2Id: number,...)` → Enregistre une partie jouée et met à jour les statistiques des deux joueurs 
  • `getUserMatchHistory(userId: number, limit: number = 20)` → Récupère l'historique des matchs d'un utilisateur avec détails des adversaires et résultats 
  • `searchUsers(searchTerm: string, excludeUserId?: n...)` → Recherche des utilisateurs par nom d'utilisateur avec option d'exclusion 
  • `getUserCount()` → Compte le nombre total d'utilisateurs enregistrés 
  • `getLeaderboard(limit: number = 20, offset: number = 0)` → Récupère le classement général des joueurs avec statistiques et pagination 
  • `getUserRank(userId: number)` → Récupère le rang d'un utilisateur dans le classement général 
  • `setTwoFactorSecret(userId: number, secret: string)` → Enregistre le secret 2FA pour un utilisateur 
  • `activateTwoFactor(userId: number)` → Active l'authentification à deux facteurs pour un utilisateur 
  • `disableTwoFactor(userId: number)` → Désactive l'authentification à deux facteurs et supprime le secret 
  • `getTwoFactorData(userId: number)` → Récupère les données d'authentification à deux facteurs d'un utilisateur 
  • `getOnlineUsers()` → Récupère la liste de tous les utilisateurs actuellement en ligne 

---



### `backend/src/services/guestTokens.ts`

**Classe `GuestTokenService`**
  • `constructor(private db: sqlite3.Database)` → Méthode
  • `generateGuestUserId(token: string)` → Génère un userId stable et négatif basé sur un token 
  • `generateGuestToken()` → Génère un token unique pour un guest 
  • `createGuestSession(token: string)` → Crée une session guest dans la base de données 
  • `VALUES(?, ?, ?, CURRENT_TIMESTAMP)` → Méthode
  • `reject(new Error(`Failed to create guest ses...)` → Méthode
  • `resolve(userId)` → Méthode
  • `validateGuestToken(token: string)` → Valide un token guest et met à jour la dernière activité 
  • `getUserIdFromToken(token: string)` → Récupère l'userId depuis un token 
  • `linkGuestToTournament(token: string, tournamentId: number, ...)` → Associe un token guest à un tournoi et un alias 
  • `function(err)` → Méthode
  • `getGuestSession(token: string)` → Récupère les informations d'une session guest 
  • `deleteGuestSession(token: string)` → Supprime une session guest (quand le guest quitte le tournoi) 
  • `cleanExpiredSessions()` → Nettoie les sessions expirées (à appeler périodiquement) 
  • `isAliasUsedByGuest(tournamentId: number, playerAlias: st...)` → Vérifie si un alias est déjà utilisé par un guest dans un tournoi 
  • `unlinkGuestFromTournament(token: string)` → Dissocier un guest d'un tournoi (quand le tournoi se termine) 
  • `updateGuestAlias(token: string, newAlias: string, tour...)` → Mettre à jour l'alias d'un guest (SANS changer le tournamentId si déjà défini) 

---



### `backend/src/services/oauth42.ts`

**Classe `OAuth42ConfigError`**
  • `constructor(message: string)` → Méthode
  • `super(message)` → Méthode

**Classe `OAuth42Service`**
  • `isConfigured()` → Méthode
  • `buildAuthorizeUrl(state: string)` → Méthode
  • `exchangeCode(code: string)` → Méthode
  • `fetchProfile(accessToken: string)` → Méthode

---



### `backend/src/types/auth.ts`

**Interfaces**
  • `JWTPayload`
  • `AuthenticatedRequest`

---



## 📁 CLI-PONG

### `cli-pong/src/auth.ts`

**Classe `AuthService`**
  • `constructor(baseUrl: string = 'http://127.0.0.1:8...)` → Méthode
  • `login(username: string, password: string)` → Authentifie l'utilisateur avec ses identifiants et retourne les tokens d'authentification. 
  • `verify2FA(tempToken: string, code: string)` → Vérifie le code 2FA et retourne les tokens d'authentification finaux. 
  • `register(username: string, password: string)` → Crée un nouveau compte utilisateur et retourne les tokens d'authentification. 
  • `getStoredTokens()` → Récupère les tokens d'authentification sauvegardés localement. 
  • `saveTokens(tokens: AuthTokens)` → Sauvegarde les tokens d'authentification dans un fichier local. 
  • `clearTokens()` → Supprime les tokens d'authentification sauvegardés localement. 
  • `isAuthenticated()` → Vérifie si l'utilisateur possède des tokens d'authentification valides. 

---



### `cli-pong/src/cli.ts`

**Fonctions**
  • `askQuestion()`
  • `askPassword()`
  • `login()`
  • `register()`
  • `listOnlinePlayers()`
  • `challengePlayer()`
  • `play()`
  • `logout()`
  • `showHelp()`
  • `main()`

---


### `cli-pong/src/game.ts`

**Classe `PongGame`**
  • `constructor(ws: WebSocketService, userId: number,...)` → Méthode
  • `setInterval(()` → Check pour auto-stop si pas d'input (150ms pour laisser le temps de maintenir la touche)
  • `setTimeout(()` → Méthode
  • `waitForPlayerList()` → Attend la réception de la liste des joueurs en ligne avant de continuer. 
  • `reject(new Error('Timeout waiting for player...)` → Méthode
  • `waitForChallenge()` → Met le joueur en attente de recevoir un défi d'un autre joueur. 
  • `challengeByUsername(targetUsername: string)` → Envoie un défi à un joueur spécifique identifié par son nom d'utilisateur. 

---



### `cli-pong/src/websocket.ts`

**Classe `WebSocketService`**
  • `constructor(private url: string, private token: s...)` → Méthode
  • `connect()` → Établit la connexion WebSocket avec le serveur en utilisant le token d'authentification. 
  • `setTimeout(()` → Attendre 300ms avant de demander la liste (laisser le temps au serveur d'enregistrer la présence)
  • `resolve()` → Méthode
  • `reject(error)` → Méthode
  • `on(type: string, handler: MessageHandler)` → Enregistre un gestionnaire pour un type de message spécifique. 
  • `send(type: string, data: any = {})` → Envoie un message au serveur via la connexion WebSocket. 
  • `disconnect()` → Ferme la connexion WebSocket et nettoie les ressources. 

---


## 📁 FRONTEND

### `frontend/src/components/Navigation.ts`

**Classe `Navigation`**
  • `render(currentUser: any = null)` → Affiche la barre de navigation latérale en fonction de l'état de connexion de l'utilisateur 

---



### `frontend/src/constants/navigation.ts`

**`getNavigationItems()`**
  → Routes de navigation principales (générées dynamiquement selon la langue) 

**`getAppViews()`**
  → Vues de l'application (titres localisés) 

**`PROTECTED_ROUTES`**
  → Configuration

**`PUBLIC_ROUTES`**
  → Configuration

**`DEFAULT_AUTHENTICATED_ROUTE`**
  → Configuration

**`DEFAULT_UNAUTHENTICATED_ROUTE`**
  → Configuration

**`ROUTES`**
  → Configuration

**`THEME`**
  → Configuration

---



### `frontend/src/core/AuthService.ts`

**Classe `AuthService`**
  • `on(event: string, handler: Function)` → Permet aux autres services de réagir à des événements AuthService 
  • `constructor(wsService: WebSocketService, gameEngi...)` → Initialise le service avec les dépendances WebSocket et moteur de jeu. 
  • `getCurrentUser()` → Retourne l'utilisateur actuellement authentifié. 
  • `getUserStats()` → Retourne les statistiques de l'utilisateur courant. 
  • `setCurrentUser(user: any)` → Définit l'utilisateur courant après authentification ou mise à jour. 
  • `setUserStats(stats: UserStats)` → Met à jour les statistiques stockées pour l'utilisateur courant. 
  • `checkExistingAuth()` → MODIFIÉ : Vérifie la session existante côté serveur avec isolation par onglet 
  • `loadUserData()` → Charge les données liées à l'utilisateur (stats, amis, demandes, historique, classement). 
  • `clearAuthForms()` → Réinitialise les formulaires de connexion et d'inscription dans l'UI. 
  • `reset('login-form')` → Méthode
  • `saveMatchResult(winner: string, currentMatch: any = n...)` → Les parties VS en ligne sont automatiquement enregistrées côté serveur
  • `showSuccessPopup(`Match ended (online)` → Méthode
  • `logout()` → Déconnecte l'utilisateur et nettoie l'état local avec isolation par onglet 
  • `handleAuthSuccess(data: any, loadUserData: ()` → Gère le succès d'authentification : reset UI, stocke l'utilisateur et navigue. 
  • `handleAuthError(data: any, showErrorPopup: (m: string)` → Gère une erreur d'authentification et affiche un message utilisateur. 
  • `showErrorPopup(localized)` → Méthode
  • `handleAuthLogout(clearUserData: ()` → Gère la déconnexion avec nettoyage session 
  • `clearUserData()` → Méthode
  • `handleUserProfileLoaded(data: any)` → Met à jour l'utilisateur courant après chargement du profil. 
  • `handleProfileUpdated(data: any, showSuccessPopup: (m: string)` → Met à jour le profil en mémoire et confirme la réussite à l'utilisateur. 
  • `handleProfileUpdateError(data: any, showErrorPopup: (m: string)` → Informe l'utilisateur d'une erreur lors de la mise à jour du profil. 
  • `handleUserStatsLoaded(data: any)` → Enregistre les statistiques utilisateur et alimente l'UI. 
  • `handleUserRankLoaded(data: any)` → Optionnel: met à jour la position de classement de l'utilisateur courant. 
  • `handleLeaderboardLoaded(_data: any)` → Optionnel: handler de confort si tu veux relayer le leaderboard vers d'autres listeners. 
  • `handleMatchCreated(data: any, showSuccessPopup: (m: string)` → Confirme la création d'un match et rafraîchit stats, historique et classement. 
  • `hasPending2FA()` → Indique si un palier 2FA est en cours (temp token présent) 
  • `clearPending2FA()` → Méthode
  • `processLoginResponse(resp: any)` → Retourne true si 2FA requis (et déclenche l'événement pour l'UI), false sinon. 
  • `confirmLogin2FA(code: string)` → Confirme le code TOTP. 

---



### `frontend/src/core/ChatController.ts`

**Classe `ChatController`**
  • `constructor(private ws: WebSocketService, private...)` → Initialise le contrôleur de chat avec les services WebSocket et UI 
  • `clearInterval(this.badgeUpdateTimer)` → Méthode
  • `setTimeout(()` → Méthode
  • `addBlockedUser(userId: number)` → Ajoute un utilisateur à la liste des bloqués et filtre les messages 
  • `removeBlockedUser(userId: number)` → Retire un utilisateur de la liste des bloqués 
  • `requestAnimationFrame(()` → Méthode
  • `clearTimeout(this.typingTimers.get(userId)` → Méthode

---



### `frontend/src/core/DashboardRenderer.ts`

**Classe `DashboardRenderer`**
  • `renderDashboard(user: any, dashboardData: DashboardSt...)` → Rendu principal de la page Dashboard avec graphiques 
  • `attachEventListeners()` → Attache les event listeners 

---



### `frontend/src/core/DashboardService.ts`

**Classe `DashboardService`**
  • `constructor(private wsService: WebSocketService)` → Méthode
  • `setTimeout(()` → Méthode
  • `loadStats()` → Charge les statistiques du dashboard 
  • `refreshStats()` → Rafraîchit les statistiques 
  • `getDashboardData()` → Récupère les données du dashboard 
  • `isLoadingStats()` → Indique si les données sont en cours de chargement 
  • `hasData()` → Indique si les données ont été chargées 
  • `formatDuration(seconds: number)` → Formate une durée en secondes vers un format lisible 
  • `formatPercentage(value: number)` → Formate un pourcentage 
  • `formatNumber(value: number)` → Formate une valeur numérique avec séparateurs de milliers 
  • `getStreakColor(streak: number)` → Détermine la couleur CSS selon le streak 
  • `getStreakMessage(streak: number)` → Génère un message descriptif pour le streak 
  • `clearData()` → Nettoie les données (utile lors de la déconnexion) 

---



### `frontend/src/core/FriendsService.ts`

**Classe `FriendsService`**
  • `constructor(wsService: WebSocketService, uiUtils:...)` → Initialise le service avec WebSocket et utilitaires UI. 
  • `getFriends()` → Retourne la liste des amis. 
  • `getFriendRequests()` → Retourne la liste des demandes d'amis. 
  • `getSearchResults()` → Retourne les résultats de recherche d'utilisateurs. 
  • `getMatchHistory()` → Retourne l'historique des matchs. 
  • `clearData()` → Réinitialise toutes les données liées aux amis et matchs. 
  • `addFriend(friendId: number)` → Envoie une requête pour ajouter un ami. 
  • `acceptFriend(friendId: number)` → Accepte une demande d'ami. 
  • `removeFriend(friendId: number)` → Supprime un ami existant. 
  • `declineFriend(friendId: number)` → Refuse une demande d'ami. 
  • `challengeFriend(friendId: number)` → Lance un défi de jeu à un ami 
  • `refreshMatchHistory()` → Déclenche un rafraîchissement de l'historique des matchs. 
  • `handleFriendsLoaded(data: any)` → Charge la liste des amis reçue via WebSocket. 
  • `handleFriendRequestsLoaded(data: any)` → Charge les demandes d'amis reçues via WebSocket. 
  • `handleUsersFound(data: any)` → Charge les résultats de recherche d'utilisateurs. 
  • `handleFriendRequestSent(data: any)` → Gère l'envoi d'une demande d'ami et notifie l'utilisateur. 
  • `handleFriendAccepted(data: any)` → Gère l'acceptation d'une demande d'ami et met à jour la liste. 
  • `handleFriendDeclined(data: any)` → Gère le refus d'une demande d'ami et met à jour la liste. 
  • `handleFriendRemoved(data: any)` → Gère la suppression d'un ami et nettoie les listes locales. 
  • `handleFriendRequestError(data: any)` → Affiche une erreur lors de la gestion des demandes d'amis. 
  • `handleMatchHistoryLoaded(data: any)` → Charge l'historique des matchs reçu via WebSocket. 
  • `getOnlineFriends()` → Retourne uniquement les amis actuellement en ligne. 
  • `getFriendById(id: number)` → Recherche un ami par son identifiant. 
  • `hasPendingRequestFrom(userId: number)` → Vérifie si une demande est en attente de la part d'un utilisateur. 
  • `isFriend(userId: number)` → Vérifie si un utilisateur est déjà ami. 
  • `getFriendCount()` → Retourne le nombre total d'amis. 
  • `getPendingRequestCount()` → Retourne le nombre de demandes d'amis en attente. 
  • `getOnlineFriendCount()` → Retourne le nombre d'amis actuellement en ligne. 
  • `clearSearchResults()` → Vide les résultats de recherche. 
  • `hasSearchResults()` → Vérifie si des résultats de recherche existent. 
  • `getRecentMatches(limit: number = 10)` → Retourne les matchs récents avec une limite (10 par défaut). 
  • `getWins()` → Retourne uniquement les matchs gagnés. 
  • `getLosses()` → Retourne uniquement les matchs perdus. 
  • `getWinRate()` → Calcule et retourne le taux de victoire en pourcentage. 

---



### `frontend/src/core/GameRenderer.ts`

**Classe `GameRenderer`**
  • `resetGameEndData()` → Réinitialise les données de fin de partie (à appeler au début d'une nouvelle partie) 
  • `clearTimeout(this.tournamentRedirectTimer)` → Méthode
  • `setTournamentMatchInfo(tournamentId: number, matchId: number)` → Configure les métadonnées du match de tournoi (seulement 2 paramètres) 
  • `clearTournamentMatchInfo()` → Nettoie les métadonnées du tournoi 
  • `isTournamentMatch()` → Vérifie si on est en match de tournoi 
  • `renderGame(currentUser: any, currentMatch: Tourn...)` → Affiche l'écran du jeu Pong (match simple ou tournoi) – style aligné LOCAL 
  • `mountCanvas()` → Prépare et mémorise le canvas (à appeler juste après l'injection HTML) 
  • `bindWebSocket(ws: WebSocketService)` → Lie les messages WebSocket liés au jeu pour le rendu remote (une seule fois) 
  • `syncCurrentUserAvatar(user: any)` → Exposé public : utilisé par PongApp après login/profile update 

---



### `frontend/src/core/I18n.ts`

**Classe `I18n`**
  • `detect()` → Détecte la langue via ?lang=, localStorage, navigator 
  • `loadInitialLanguage()` → - Si user connecté et pas de langue en BDD -> on pousse la détection locale côté serveur (PUT)
  • `setLang(lang: Lang)` → Charge le dictionnaire de la langue demandée 
  • `t(key: string)` → Raccourci de traduction 
  • `onChange(cb: (lang: Lang)` → Écouteurs pour réagir aux changements de langue 

---



### `frontend/src/core/MatchHistoryService.ts`

**Classe `MatchHistoryService`**
  • `constructor(wsService: WebSocketService)` → Initialise le service avec la dépendance WebSocket 
  • `getMatchHistory()` → Retourne l’historique des matchs 
  • `clearData()` → Réinitialise l’historique (utile lors de la déconnexion) 
  • `handleMatchHistoryLoaded(data: any)` → Charge l’historique reçu via WebSocket 
  • `refreshMatchHistory(userId: number, limit: number = 20)` → Rafraîchit l’historique pour un utilisateur donné 
  • `formatMatchDate(dateString: string)` → Formate une date de match avec un temps relatif lisible 
  • `formatMatchDuration(seconds: number)` → Transforme une durée en secondes en format lisible (m/s/h) 
  • `getRecentMatches(limit: number = 10)` → Retourne les matchs récents (limite par défaut 10) 
  • `getWins()` → Retourne uniquement les matchs gagnés 
  • `getLosses()` → Retourne uniquement les matchs perdus 
  • `getWinRate()` → Calcule et retourne le taux de victoire en pourcentage 
  • `getTotalGames()` → Retourne le nombre total de matchs joués 
  • `getMatchesByGameMode(gameMode: string)` → Filtre les matchs par mode de jeu 
  • `getAverageScore()` → Calcule le score moyen marqué et encaissé 
  • `getLongestWinStreak()` → Retourne la plus longue série de victoires 
  • `getCurrentStreak()` → Retourne la série actuelle (victoires ou défaites) 
  • `getOpponentStats()` → Compile les statistiques par adversaire (matchs, victoires, défaites) 

---



### `frontend/src/core/ModuleManager.ts`

**Classe `ModuleManager`**
  • `checkBrowserCompatibility()` → Vérifie la compatibilité du navigateur avec les fonctionnalités requises 
  • `initialize(modules: string[])` → Initialise les modules (version simplifiée) 
  • `checkBackendConnection()` → Vérifie la connectivité avec le backend 
  • `logSystemInfo()` → Affiche les informations système (debug) 
  • `cleanup()` → Nettoie les ressources et réinitialise les modules 

---



### `frontend/src/core/NeonFrameRenderer.ts`

**Classe `NeonFrameRenderer`**
  • `constructor(options: NeonFrameOptions = {})` → Méthode
  • `attach(canvas: HTMLCanvasElement, ctx?: Canv...)` → Méthode
  • `detach()` → Méthode
  • `render(timestamp?: number)` → Méthode

---



### `frontend/src/core/OtherUserProfileService.ts`

**Classe `OtherUserProfileService`**
  • `constructor(wsService: WebSocketService, uiUtils:...)` → Initialise le service de profil utilisateur avec les services WebSocket et UI 
  • `loadOtherUserData(userId: number)` → Charge les données d'un autre utilisateur 
  • `fetch('/api/auth/friends', { headers })` → Méthode
  • `blockUser(userId: number)` → Bloque un utilisateur SANS reason (backend n'en a pas besoin) 
  • `unblockUser(userId: number)` → Débloque un utilisateur 
  • `sendFriendRequest(userId: number, message?: string)` → Envoie une demande d'ami 
  • `removeFriend(userId: number)` → Supprime un ami 
  • `sendGameChallenge(userId: number, message?: string, gam...)` → Envoie un défi de jeu 
  • `openChatWithUser(userId: number)` → Ouvre le chat avec un utilisateur 
  • `setTimeout(()` → Méthode
  • `getCachedUserData(userId: number)` → Récupère les données en cache d'un utilisateur 
  • `isLoadingUser(userId: number)` → Vérifie si les données d'un utilisateur sont en cours de chargement 

---



### `frontend/src/core/PageRenderer.ts`

**Classe `PageRenderer`**
  • `constructor()` → Constructeur : instancie les utilitaires UI 
  • `renderLandingPage()` → Affiche la page d'accueil (landing page) 
  • `renderOAuth42Callback(currentUser: any)` → Méthode
  • `renderWelcomePage(currentUser: any, userStats: UserStat...)` → Affiche la page de bienvenue avec boutons et infos utilisateur 
  • `renderAuth(currentUser: any)` → Affiche la page d'authentification (login et register) 
  • `renderOnlineGame(currentUser: any, friends: Friend[])` → Affiche la page de jeu en ligne (Online Game) - uniquement pour utilisateurs connectés 
  • `render404(currentUser: any)` → Affiche la page 404 en cas de route non trouvée 

---



### `frontend/src/core/PongApp.ts`

**Classe `PongApp`**
  • `constructor()` → Initialise l'application Pong avec tous les services et gestionnaires d'événements 
  • `requestAnimationFrame(()` → Méthode
  • `setTimeout(()` → Rediriger vers la page tournoi après succès
  • `blockUserFromProfile(userId: number)` → Bloque un utilisateur depuis son profil et met à jour l'interface 
  • `unblockUserFromProfile(userId: number)` → Débloque un utilisateur depuis son profil et met à jour l'interface 

---



### `frontend/src/core/ProfileRenderer.ts`

**Classe `ProfileRenderer`**
  • `constructor(uiUtils: UIUtils, wsService: WebSocke...)` → Constructeur, initialise l'outil utilitaire pour l'UI 
  • `renderProfile(currentUser: any, userStats: UserStat...)` → Affiche la page de profil utilisateur avec ses informations, statistiques et historique récent 
  • `renderOtherUserProfile(currentUser: any, otherUserData: Othe...)` → Affiche le profil d'un autre utilisateur (lecture seule) avec système de blocage CORRIGÉ 
  • `attachTwoFAEvents(currentUser?: any)` → Méthode
  • `setTimeout(()` → Re-render la vue profil pour refléter le nouvel état

---



### `frontend/src/core/RemoteGameController.ts`

**Classe `RemoteGameController`**
  • `logNote(msg: string)` → Enregistre une note publique dans les logs 
  • `setTournamentMatchInfo(tournamentId: number, matchId: number)` → Configure les métadonnées d'un match de tournoi 
  • `clearTournamentMatchInfo()` → Nettoie les métadonnées du tournoi 
  • `isTournamentMatch()` → Vérifie si le match actuel est un match de tournoi 
  • `isActiveTournamentGame()` → Indique si un match de tournoi est en cours (non terminé) côté client 
  • `getTournamentMatchInfo()` → Retourne les infos du tournoi 
  • `markTournamentRedirectPending()` → Marque qu'une redirection tournoi est en cours 
  • `clearTimeout(this.postGameRedirectTimer)` → Méthode
  • `handleGameSync(msg: any, currentViewGetter: ()` → Synchronise l'état et détermine mon côté (gauche/droite) 
  • `handleOpponentLeft()` → Ne PAS rediriger si redirection tournoi en cours 
  • `setTimeout(()` → Méthode
  • `handleYouLeft()` → Ne PAS rediriger si redirection tournoi en cours 
  • `handleGameCancelled(message: string)` → Ne PAS rediriger si redirection tournoi en cours 
  • `bindRemoteControls()` → Installe les listens clavier pour le remote 
  • `unbindRemoteControls(notifyServer: boolean = false)` → Retire les listens clavier remote (option: notifier serveur) 
  • `showEscHintAndBind()` → Affiche l'indice ESC et binde la touche pour les matchs 1v1 normaux 
  • `removeEscHint()` → Supprime l'indice ESC (no-op car dessiné dans le canvas) 
  • `hasActiveRemoteGame()` → Vérifie si une partie distante est active 
  • `bindEscapeToHome()` → Binde la touche Escape pour retourner à l'accueil (sauf tournoi) 
  • `unbindEscape()` → Retire le listener de la touche Escape 

---



### `frontend/src/core/SocialRenderer.ts`

**Classe `SocialRenderer`**
  • `constructor(uiUtils: UIUtils)` → Méthode
  • `renderChat(currentUser: any, friends: Friend[])` → Page Chat
  • `renderFriends(currentUser: any, friends: Friend[], ...)` → Friends Page 
  • `attachEventListeners()` → Attacher seulement les hover effects, les actions sont gérées par PongApp 

---



### `frontend/src/core/TournamentBinder.ts`

**Classe `TournamentBinder`**
  • `forceWaitingAnimation()` → Force l'affichage de l'animation d'attente 
  • `clearWaitingAnimation()` → Efface le flag d'animation d'attente 
  • `renderAndBind()` → Rend l'interface de tournoi et attache les gestionnaires d'événements 

---



### `frontend/src/core/TournamentPage.ts`

**`mountTournamentPage(container?: HTMLElement)`**
  → Monte la page Tournoi dans l'élément #app (ou le conteneur donné) 

**`unmountTournamentPage()`**
  → Fonction utilitaire pour déclencher cleanup manuellement 

---



### `frontend/src/core/TournamentService.ts`

**Classe `TournamentService`**
  • `constructor(uiUtils: UIUtils)` → Initialise le service de tournoi avec les utilitaires d'interface 
  • `declareForfeit(reason: 'declined_invitation' | 'aban...)` → Déclare le forfait du joueur avec la raison spécifiée 
  • `leaveTournament()` → Quitte le tournoi actif en utilisant l'endpoint de forfait 
  • `quitTournament()` → Quitte un tournoi terminé pour libérer l'alias 
  • `markReady(matchId: number)` → Marque le joueur comme prêt pour le match spécifié 
  • `getTournamentHistory(userId?: number, alias?: string, limi...)` → Récupère l'historique des tournois pour un utilisateur ou alias donné 
  • `createTournament(name: string, creatorAlias: string, u...)` → Crée un nouveau tournoi avec le nom et l'alias du créateur 
  • `joinTournament(tournamentId: number, playerAlias: st...)` → Rejoint un tournoi existant avec l'alias du joueur 
  • `startTournamentAsOwner()` → Démarre le tournoi en tant que propriétaire 

---



### `frontend/src/core/UIUtils.ts`

**Classe `UIUtils`**
  • `showSuccessPopup(message: string)` → Affiche une popup de succès 
  • `showErrorPopup(message: string)` → Affiche une popup d'erreur 
  • `showLoadingPopup(message: string)` → Affiche une popup de chargement 
  • `hideLoadingPopup()` → Masque la popup de chargement 
  • `createPopup(message: string, type: 'success' | 'e...)` → Crée et affiche une popup avec animation 
  • `setTimeout(()` → Méthode
  • `renderAvatar(user: any, size: number = 40)` → Génère l'affichage d'un avatar utilisateur 
  • `formatDate(dateString: string)` → Formate une date au format lisible 
  • `escapeHtml(text: string)` → Échappe le HTML pour éviter les injections 
  • `isUserBlocked(userId: number)` → Indique si un utilisateur est bloqué côté client 

---



### `frontend/src/core/WebSocketBinder.ts`

**Classe `WebSocketBinder`**
  • `bindCore(navigate: (path: string)` → Attache tous les gestionnaires d'événements WebSocket principaux 
  • `on('connection', ()` → Méthode
  • `rerender()` → Méthode
  • `onLogoutCleanup()` → Méthode
  • `refreshFriends()` → Méthode
  • `navigate('/game')` → Méthode

---



### `frontend/src/core/initEventListeners.ts`

**Fonctions**
  • `getInt()`
  • `applyZoomVar()`

**Actions data-attribute**
  • `challenge-friend`
  • `send-on-enter`
  • `add-friend`
  • `refresh-history`
  • `generate-next-match`
  • `navigate-welcome`
  • `start-match`
  • `reset-tournament`
  • `add-player`
  • `logout`
  • `start-tournament`
  • `reload`
  • `img-fallback`
  • `declare-winner`
  • `play-match`
  • `decline-friend`
  • `dev-debug`
  • `set-lang`
  • `accept-friend`
  • `remove-friend`
  • ... et 1 autres

---


### `frontend/src/core/interfaces.ts`

**Interfaces**
  • `ChatMessage`
  • `UnreadChatCount`
  • `ChatUIState`
  • `UserNotification`
  • `UserProfileActions`
  • `BlockedUser`
  • `GameChallenge`
  • `ChatGlobalMessageData`
  • `ChatPrivateMessageData`
  • `NotificationUpdateData`
  • `FriendRequestData`
  • `BlockUserData`
  • `GameChallengeData`
  • `TournamentPlayer`
  • `TournamentMatch`
  • `TournamentState`
  • `TdUserRef`
  • `TdMatchScore`
  • `TdMatchPublic`
  • `TdPublicState`
  • `TEventCreated`
  • `TEventState`
  • `TEventMatchStarted`
  • `TEventMatchResult`
  • `TEventFinished`
  • `TEventError`
  • `TInvitePayload`
  • `TStartPayload`
  • `User`
  • `Friend`
  • `FriendRequest`
  • `UserStats`
  • `MatchHistory`
  • `LeaderboardEntry`
  • `LeaderboardResponse`
  • `UserRankResponseBody`
  • `WSMessage`
  • `GameState`
  • `GameSettings`
  • `LoginFormData`
  • `RegisterFormData`
  • `ProfileUpdateData`
  • `SearchFormData`
  • `ApiResponse`
  • `Route`
  • `PopupOptions`
  • `AvatarOptions`
  • `AppError`
  • `ValidationError`

**Types**
  • `ConversationType`
  • `MessageType`
  • `TdPhase`
  • `TdMatchStatus`
  • `TournamentWSIn`
  • `TournamentPhase`
  • `GameMode`
  • `MatchResult`
  • `UserStatus`

---


### `frontend/src/game/GameEngine.ts`

**Classe `GameEngine`**
  • `constructor()` → Constructeur 
  • `initializeRemoteMode(gameId: string, wsService: WebSocketS...)` → Active le mode remote + abonnements WS 
  • `restartGame()` → Restart (local) 
  • `initialize(canvasId: string)` → Init canvas + boucle 
  • `reset()` → Reset complet 
  • `destroy()` → Destruction 
  • `getTournamentMatch()` → Getters utilitaires 
  • `getGameState()` → Méthode
  • `startGame()` → Méthode
  • `togglePause()` → Toggle pause uniquement en local 
  • `isRemote()` → Méthode

---



### `frontend/src/main.ts`

**Fonctions**
  • `initializeSessionIsolation()`
  • `setupSessionCleanup()`
  • `showStartupError()`

---


### `frontend/src/services/GuestAuthService.ts`

**Classe `GuestAuthService`**
  • `generateGuestToken()` → Génère un nouveau token guest depuis le backend 
  • `getGuestToken()` → Récupère le token guest actuel depuis sessionStorage 
  • `getGuestUserId()` → Récupère l'userId guest depuis sessionStorage 
  • `isGuest()` → Vérifie si l'utilisateur actuel est un guest 
  • `isAuthenticated()` → Vérifie si l'utilisateur est authentifié (user ou guest) 
  • `setGuestAlias(alias: string)` → Stocke l'alias du guest 
  • `getGuestAlias()` → Récupère l'alias du guest 
  • `validateGuestToken(token?: string)` → Valide le token guest auprès du backend 
  • `clearGuestData()` → Nettoie les données du guest (déconnexion) 
  • `getAuthHeaders()` → Obtient les headers d'authentification (pour user ou guest) 
  • `getUserIdentifier()` → Obtient l'identifiant de l'utilisateur actuel (userId) 
  • `getDisplayName()` → Obtient le nom d'affichage de l'utilisateur actuel 
  • `initializeGuest()` → Initialise un guest (génère un token si nécessaire) 

---



### `frontend/src/services/MatchHistoryService.ts`

**Classe `MatchHistoryService`**
  • `getUserMatchHistory(userId: number, limit: number = 20)` → Récupère l'historique des matchs d'un utilisateur 
  • `getMyMatchHistory(limit: number = 20)` → Récupère l'historique des matchs de l'utilisateur connecté 
  • `formatDuration(seconds?: number)` → Formate une durée exprimée en secondes 
  • `formatDate(dateString: string)` → Formate une date pour l'affichage 
  • `getResultText(result: 'win' | 'loss')` → Retourne le texte correspondant au résultat 
  • `getResultColor(result: 'win' | 'loss')` → Retourne la couleur CSS en fonction du résultat 

---



### `frontend/src/services/Router.ts`

**Classe `Router`**
  • `getView(path: string)` → Retourne la vue correspondant au chemin demandé 
  • `getUrlParams(url?: string)` → Récupère les paramètres d'URL (query string) 
  • `navigateTo(path: string)` → Méthode
  • `goToAuth()` → Raccourci pour aller sur la page d'authentification 
  • `goToWelcome()` → Raccourci pour aller sur la page d'accueil "welcome" 
  • `goToUserProfile(userId: number)` → Raccourci pour aller sur le profil d'un utilisateur 
  • `goToOwnProfile()` → Raccourci pour aller sur son propre profil 
  • `goToDashboard()` → Raccourci pour aller au Dashboard 
  • `getCurrentRoute()` → Retourne la route actuellement affichée 
  • `isCurrentRoute(route: string)` → Vérifie si la route courante correspond à une route donnée 
  • `isViewingOtherUserProfile()` → Méthode
  • `getUrlParam(name: string, url?: string)` → Méthode

---



### `frontend/src/services/WebSocketService.ts`

**Classe `WebSocketService`**
  • `constructor()` → Méthode
  • `setAuthToken(token: string | null)` → Helpers de token publics avec synchronisation 
  • `getAuthToken()` → Méthode
  • `sendGlobalMessage(content: string, messageType: string ...)` → Envoie un message dans le chat global 
  • `sendPrivateMessage(recipientId: number, content: string,...)` → Envoie un message privé via WebSocket avec le bon type 
  • `sendTypingIndicator(recipientId: number, isTyping: boolea...)` → Envoie un indicateur de frappe 
  • `sendGameInvitation(recipientId: number)` → Envoie une invitation de jeu via chat 
  • `sendFriendRequest(userId: number, message?: string)` → Envoie une demande d'ami 
  • `blockUser(userId: number, reason?: string)` → Bloque un utilisateur 
  • `unblockUser(userId: number)` → Débloque un utilisateur 
  • `sendGameChallenge(challengedUserId: number, message?: s...)` → Envoie un défi de jeu 
  • `markNotificationAsRead(notificationId: number)` → Marque une notification comme lue 
  • `markAllNotificationsAsRead()` → Marque toutes les notifications comme lues 
  • `setupTwoFA()` → Démarre l'enrôlement 2FA, renvoie l'otpauth:// 
  • `activateTwoFA(code: string)` → Active la 2FA en validant un code TOTP 
  • `disableTwoFA(code: string)` → Désactive la 2FA pour le compte courant 
  • `getDashboardStats()` → Récupère les statistiques complètes pour le dashboard 
  • `refreshDashboardStats()` → Méthode helper pour rafraîchir les stats du dashboard après une partie 
  • `getChatConversations()` → Récupère les conversations de l'utilisateur 
  • `getChatMessages(conversationId: number, limit: number...)` → Récupère les messages d'une conversation 
  • `sendChatMessageHTTP(recipientId: number, content: string,...)` → Envoie un message via HTTP (fallback si WebSocket échoue) 
  • `sendGlobalMessageHTTP(content: string, messageType: string ...)` → Envoie un message global via HTTP (fallback) 
  • `sendFriendRequestHTTP(userId: number, message?: string)` → Envoie une demande d'ami via HTTP 
  • `blockUserHTTP(userId: number, reason?: string)` → Bloque un utilisateur via HTTP 
  • `unblockUserHTTP(userId: number)` → Débloque un utilisateur via HTTP 
  • `sendGameChallengeHTTP(challengedUserId: number, message?: s...)` → Envoie un défi de jeu via HTTP 

**`CHAT_MESSAGE_MAX_CHARS`**
  → Configuration

---



### `frontend/src/types/index.ts`

**Interfaces**
  • `User`
  • `UserStats`
  • `TournamentPlayer`
  • `TournamentMatch`
  • `TournamentState`
  • `GameState`
  • `NavigationItem`
  • `AppView`
  • `PopupMessage`
  • `AuthResponse`
  • `ChatMessage`
  • `GameInvite`
  • `MatchHistoryItem`
  • `MatchHistoryResponse`
  • `DashboardStats`

**Types**
  • `ViewName`

---


### `frontend/vite.config.ts`

**Configuration Vite**
  • Configuration du serveur de développement
  • Proxy API et WebSocket vers backend
  • Configuration de build et optimisation
  • Alias de chemins TypeScript

---


