// frontend/src/core/interfaces.ts

/* ===== INTERFACES CHAT ===== */

/* Types de conversation */
export type ConversationType = 'global' | 'private';

/* Types de message */
export type MessageType = 'text' | 'game_invite' | 'tournament_announcement' | 'tournament_invite';

/* Message de chat */
export interface ChatMessage {
  id: number;
  conversation_id?: number;
  sender_id: number;
  sender_username: string;
  recipient_id?: number;
  content: string;
  message_type: MessageType;
  metadata?: string;
  created_at: string;
  conversationType: ConversationType;
}

/* NOUVEAU: Compteur de messages non lus par utilisateur */
export interface UnreadChatCount {
  userId: number;
  username: string;
  count: number;
  lastMessageTime: string;
}

/* État UI du chat - MODIFIÉ pour inclure les messages non lus */
export interface ChatUIState {
  currentConversationType: ConversationType;
  selectedConversationId: number | null;
  selectedUserId: number | null;
  globalMessages: ChatMessage[];
  privateConversations: Map<number, ChatMessage[]>;
  onlineUsers: User[];
  typingUsers: Map<number, string>;
  notifications: UserNotification[];
  unreadCount: number;
  // NOUVEAU: Tracking des messages non lus
  unreadChatMessages: Map<number, UnreadChatCount>; // userId -> count
  totalUnreadChatCount: number; // Total pour le badge principal
}

/* Notification utilisateur */
export interface UserNotification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  metadata?: string;
  is_read: boolean;
  created_at: string;
}

/* Actions disponibles sur un profil utilisateur */
export interface UserProfileActions {
  canBlock: boolean;
  canUnblock: boolean;
  canAddFriend: boolean;
  canRemoveFriend: boolean;
  canChallenge: boolean;
  canMessage: boolean;
  isBlocked: boolean;
  isFriend: boolean;
  hasPendingRequest: boolean;
}

/* Utilisateur bloqué */
export interface BlockedUser {
  id: number;
  username: string;
  avatar_url?: string;
  blocked_at: string;
  reason?: string;
}

/* Défi de jeu */
export interface GameChallenge {
  id: number;
  challenger_id: number;
  challenged_id: number;
  challenger_username?: string;
  challenged_username?: string;
  message?: string;
  game_mode: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  created_at: string;
}

/* Données pour les événements WebSocket du chat */
export interface ChatGlobalMessageData {
  content: string;
  messageType?: string;
}

export interface ChatPrivateMessageData {
  recipientId: number;
  content: string;
  messageType?: string;
  metadata?: string;
}

export interface NotificationUpdateData {
  notifications: UserNotification[];
  unreadCount: number;
}

export interface FriendRequestData {
  userId: number;
  message?: string;
}

export interface BlockUserData {
  userId: number;
  reason?: string;
}

export interface GameChallengeData {
  challengedUserId: number;
  message?: string;
  gameMode?: string;
}

/* ===== INTERFACES EXISTANTES (conservées) ===== */

/* Interfaces liées aux tournois */
export interface TournamentPlayer { alias: string; eliminated: boolean; }
export interface TournamentMatch { player1: string; player2: string; winner: string | null; played: boolean; }
export interface TournamentState {
active: boolean; players: TournamentPlayer[]; currentRound: number;
matches: TournamentMatch[]; currentMatch: TournamentMatch | null; champion: string | null;
}

/* === Tournoi serveur-driven (4 joueurs, élimination directe) ===

Ces types décrivent l'état « source de vérité » poussé par le serveur via WebSocket.

Ils cohabitent avec les types historiques ci-dessus (mode local UI). */
export type TdPhase = 'waiting' | 'in_progress' | 'finished' | 'cancelled';
export type TdMatchStatus = 'pending' | 'playing' | 'done' | 'walkover';

export interface TdUserRef {
id: number;
name: string;
avatar?: string | null;
}

export interface TdMatchScore { p1: number; p2: number; }

export interface TdMatchPublic {
id: number;
p1: TdUserRef;
p2: TdUserRef;
status: TdMatchStatus;
score?: TdMatchScore;
}

export interface TdPublicState {
id: string; // identifiant du tournoi
ownerId: number; // créateur/owner
status: TdPhase; // waiting | in_progress | finished | cancelled
players: TdUserRef[]; // liste des 4 joueurs (simples refs)
matches: TdMatchPublic[]; // demi-finales + finale
currentMatchIndex: number; // pointeur de match courant (−1 si aucun)
winnerId?: number | null; // rempli quand finished

/* Champ pratique pour l'UI (bannière match courant) */
current?: { matchId: number; p1: TdUserRef; p2: TdUserRef } | null;
}

/* === Événements WebSocket (serveur → client) pour tournoi serveur-driven ===
NB: les payloads sont strictement typées pour l'UI (toasts, modals, bannière, etc.). */
export interface TEventCreated { tournament: TdPublicState }
export interface TEventState { tournament: TdPublicState }
export interface TEventMatchStarted{ tournamentId: string; matchId: number; p1: TdUserRef; p2: TdUserRef }
export interface TEventMatchResult { tournamentId: string; matchId: number; score: TdMatchScore; status: Extract<TdMatchStatus,'done'|'walkover'> }
export interface TEventFinished { tournamentId: string; winnerId: number }
export interface TEventError { message: string; code?: string | number }

/* === Messages sortants (client → serveur) pour tournoi serveur-driven ===

Inviter exactement 3 amis en ligne (moi + 3 = 4 joueurs au total)

Démarrer explicitement le premier match quand tout le monde est prêt */
export interface TInvitePayload { name: string; friendIds: number[] } // friendIds.length === 3 attendu côté serveur
export interface TStartPayload { tournamentId: string } // start du bracket (verrouille inscriptions)

/* Interfaces liées aux utilisateurs et relations sociales */
export interface User {
id: number; username: string; email?: string; avatar_url?: string;
is_online: boolean; last_login?: string; created_at: string;

/* Rang actuel dans le classement simple (optionnel selon les endpoints) */
rank?: number; rank_position?: number;
}
type MiniUser = Pick<User, 'id'|'username'|'avatar_url'>;
export interface Friend extends Pick<User,'id'|'username'|'avatar_url'|'is_online'|'last_login'> { friendship_date: string; }
export interface FriendRequest extends MiniUser { request_date: string; }

/* Interfaces liées aux statistiques de jeu */
export interface UserStats {
user_id: number; games_played: number; games_won: number; games_lost: number;
tournaments_played: number; tournaments_won: number;
total_points_scored: number; total_points_conceded: number; longest_rally: number;
}
type OpponentRef = MiniUser;
export interface MatchHistory {
id: number; opponent: OpponentRef; my_score: number; opponent_score: number;
result: 'win' | 'loss'; game_mode: string; duration?: number; played_at: string;
}

/* Interfaces pour le classement simple */
export interface LeaderboardEntry {
user_id: number; username: string; avatar_url?: string; wins: number; losses: number;
point_diff: number; created_at: string; rank: number;
}
export interface LeaderboardResponse { leaderboard: LeaderboardEntry[]; }
export interface UserRankResponseBody { user: { id: number; username: string }; rank: number; }

/* Interfaces pour les messages WebSocket */
export interface WSMessage<T = any> { type: string; data: T; }

/* (Facultatif) Union typée pour consommation directe si besoin :
export type TournamentWSIn =
| { type: 'tournament:created'; data: TEventCreated }
| { type: 'tournament:state'; data: TEventState }
| { type: 'tournament:match_started'; data: TEventMatchStarted }
| { type: 'tournament:match_result'; data: TEventMatchResult }
| { type: 'tournament:finished'; data: TEventFinished }
| { type: 'tournament:error'; data: TEventError };
*/

/* Interfaces liées à l'état du jeu */
type PaddleState = { y: number; score: number; };
type BallState = { x: number; y: number; dx: number; dy: number; };
export interface GameState { paddle1: PaddleState; paddle2: PaddleState; ball: BallState; gameRunning: boolean; winner?: string; }
export interface GameSettings {
canvasWidth: number; canvasHeight: number; paddleWidth: number; paddleHeight: number;
ballSize: number; paddleSpeed: number; ballSpeed: number; winningScore: number;
}

/* Interfaces pour les formulaires (auth, profil, recherche) */
export interface LoginFormData { username: string; password: string; }
export interface RegisterFormData { username: string; password: string; email?: string; }
export interface ProfileUpdateData { username?: string; email?: string; avatar_url?: string | null; }
export interface SearchFormData { query: string; }

/* Interfaces pour les réponses API génériques */
export interface ApiResponse<T = any> { success: boolean; data?: T; error?: string; message?: string; }

/* Interfaces liées à la navigation et au routage */
export interface Route { path: string; component: string; requiresAuth?: boolean; }

/* Interfaces pour les composants UI (popups, avatars) */
export interface PopupOptions {
type: 'success' | 'error' | 'info' | 'warning';
duration?: number; position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}
export interface AvatarOptions { size: number; fallbackToInitials?: boolean; borderColor?: string; backgroundColor?: string; }

/* Types spécifiques au tournoi et au jeu */
export type TournamentPhase = 'setup' | 'active' | 'match' | 'bracket' | 'complete';
export type GameMode = 'classic' | 'tournament' | 'practice';
export type MatchResult = 'win' | 'loss' | 'draw';
export type UserStatus = 'online' | 'offline' | 'away' | 'busy';

/* Interfaces pour les erreurs applicatives */
export interface AppError { code: string; message: string; details?: any; }
export interface ValidationError { field: string; message: string; value?: any; }