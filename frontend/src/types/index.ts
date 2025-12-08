// frontend/src/types/index.ts

/* Représente un utilisateur */
export interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  createdAt: Date;
  stats?: UserStats;
}

/* Statistiques d'un utilisateur */
export interface UserStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  tournamentWins: number;
}

/* Factorisations pour réduire la duplication */
interface Paddle { x: number; y: number; width: number; height: number; }
interface PlayerState { name: string; score: number; paddle: Paddle; }
interface Ball { x: number; y: number; dx: number; dy: number; radius: number; }
interface Score { player1Score: number; player2Score: number; }

/* Joueur d'un tournoi */
export interface TournamentPlayer { alias: string; eliminated: boolean; }

/* Match d'un tournoi */
export interface TournamentMatch {
  player1: string;
  player2: string;
  winner: string | null;
  played: boolean;
  score?: Score;
}

/* État global d'un tournoi */
export interface TournamentState {
  active: boolean;
  players: TournamentPlayer[];
  currentRound: number;
  matches: TournamentMatch[];
  currentMatch: TournamentMatch | null;
  champion: string | null;
  startTime?: Date;
  endTime?: Date;
}

/* État de la partie en cours */
export interface GameState {
  player1: PlayerState;
  player2: PlayerState;
  ball: Ball;
  gameActive: boolean;
  winner: string | null;
}

/* Élément de navigation */
export interface NavigationItem {
  path: string;
  label: string;
  requiresAuth: boolean;
  icon?: string;
}

/* Vue de l'application */
export interface AppView { name: string; path: string; title: string; requiresAuth: boolean; }

/* Liste des vues possibles - AJOUT du dashboard */
export type ViewName = 'home' | 'welcome' | 'auth' | 'game' | 'tournament' | 'profile' | 'dashboard' | 'chat' | '404';

/* Message affiché dans une popup */
export interface PopupMessage { message: string; type: 'success' | 'error' | 'info' | 'warning'; duration?: number; }

/* Réponse d'authentification */
export interface AuthResponse { success: boolean; token?: string; user?: User; error?: string; }

/* Message de chat */
export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: Date;
  type: 'text' | 'system' | 'game_invite';
}

/* Invitation à une partie */
export interface GameInvite {
  id: string;
  fromUser: string;
  toUser: string;
  gameType: 'casual' | 'tournament';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: Date;
}

/* Élément de l'historique des matchs */
export interface MatchHistoryItem {
  id: number;
  opponent: { id: number; username: string; avatar_url?: string; rank?: number; };
  my_score: number;
  opponent_score: number;
  result: 'win' | 'loss';
  game_mode: string;
  duration?: number;
  played_at: string;
}

/* Réponse contenant l'historique des matchs */
export interface MatchHistoryResponse {
  success: boolean;
  user: { id: number; username: string; avatar_url?: string; };
  matches: MatchHistoryItem[];
}

/* Interface pour les statistiques détaillées du dashboard */
export interface DashboardStats {
  user: {
    id: number;
    username: string;
    avatar_url?: string;
    rank: number;
    rank_position: number;
  };
  stats: {
    games_played: number;
    games_won: number;
    games_lost: number;
    tournaments_played: number;
    tournaments_won: number;
    total_points_scored: number;
    total_points_conceded: number;
    longest_rally: number;
  };
  recentMatches: MatchHistoryItem[];
  winStreak: number;
  averageGameDuration: number;
  winRate: number;
  pointsPerGame: number;
}