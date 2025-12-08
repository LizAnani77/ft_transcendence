/**
 * Configuration des Limites du Système
 *
 * Ce fichier centralise toutes les limites et contraintes du système.
 * Modifier ces valeurs pour ajuster les limites à l'échelle du système.
 */

// ============================================================================
// LIMITES UTILISATEUR
// ============================================================================

export const USER_LIMITS = {
  // Contraintes nom d'utilisateur
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 10,
  USERNAME_DB_MAX_LENGTH: 50,

  // Contraintes mot de passe
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 100,

  // Contraintes email
  EMAIL_MAX_LENGTH: 100,

  // Contraintes avatar
  AVATAR_URL_MAX_LENGTH: 255,

  // Limites de connexion
  MAX_CONNECTIONS_PER_USER: null, // null = illimité (non implémenté)
  MAX_CONCURRENT_USERS: 200, // Maximum d'utilisateurs connectés simultanément
  MAX_REGISTERED_USERS: 10000, // Maximum d'utilisateurs enregistrés dans la base

  // Limites sociales
  MAX_FRIENDS_PER_USER: 5, // Maximum d'amis par utilisateur
} as const;

// ============================================================================
// LIMITES CHAT
// ============================================================================

export const CHAT_LIMITS = {
  // Contraintes de message
  MAX_MESSAGE_LENGTH: 500,

  // Limites d'historique
  GLOBAL_CHAT_HISTORY_LIMIT: 100, // Nombre maximum de messages conservés dans le chat global
} as const;

// ============================================================================
// LIMITES TOURNOI
// ============================================================================

export const TOURNAMENT_LIMITS = {
  // Contraintes nom de tournoi
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH_FRONTEND: 20,
  NAME_MAX_LENGTH_BACKEND: 100,

  // Contraintes alias de joueur
  ALIAS_MIN_LENGTH: 1,
  ALIAS_MAX_LENGTH_FRONTEND: 10,
  ALIAS_MAX_LENGTH_BACKEND: 50,

  // Limites de joueurs
  MAX_PLAYERS_PER_TOURNAMENT: 4,

  // Tournois simultanés
  MAX_CONCURRENT_TOURNAMENTS: 50, // Maximum de tournois actifs simultanément

  // Limites de requêtes
  DEFAULT_TOURNAMENT_LIST_LIMIT: 20,
  DEFAULT_MATCH_HISTORY_LIMIT: 10,
} as const;

// ============================================================================
// LIMITES JEU
// ============================================================================

export const GAME_LIMITS = {
  // Score de jeu
  MAX_SCORE: 5, // Points nécessaires pour gagner une partie

  // Jeux/challenges simultanés
  MAX_CONCURRENT_CHALLENGES: 100, // Maximum de challenges actifs simultanément
} as const;

// ============================================================================
// LIMITES BASE DE DONNÉES
// ============================================================================

export const DATABASE_LIMITS = {
  // Pool de connexions
  MAX_POOL_SIZE: 20,

  // Timeouts d'opération
  OPERATION_TIMEOUT_MS: 15000, // 15 secondes

  // Tentatives de retry
  MAX_RETRY_ATTEMPTS: 2,

  // Limites de stockage et archivage
  MAX_DATA_STORAGE: null, // null = limite du système de fichiers SQLite
  TOURNAMENT_ARCHIVE_MONTHS: 6, // Archiver les tournois après N mois
  MAX_MATCH_HISTORY_PER_USER: 1000, // Maximum de matchs conservés par utilisateur
  INACTIVE_ACCOUNT_MONTHS: 12, // Supprimer les comptes inactifs après N mois (optionnel)
} as const;

// ============================================================================
// LIMITES SÉCURITÉ
// ============================================================================

export const SECURITY_LIMITS = {
  // Authentification à Deux Facteurs (2FA)
  TWOFA_MAX_ATTEMPTS: 5,
  TWOFA_WINDOW_MS: 300000, // 5 minutes
  TWOFA_LOCK_DURATION_MS: 900000, // 15 minutes

  // OAuth
  OAUTH_STATE_TTL_MS: 300000, // 5 minutes

  // Alias de session invité
  GUEST_ALIAS_MAX_LENGTH: 50,
} as const;

// ============================================================================
// LIMITES WEBSOCKET
// ============================================================================

export const WEBSOCKET_LIMITS = {
  // Limites de connexion
  MAX_CONNECTIONS_GLOBAL: null, // null = illimité

  // Limites de message
  MAX_MESSAGE_SIZE: null, // null = illimité (géré par la longueur du message chat)
} as const;

// ============================================================================
// LIMITES AGRÉGÉES (pour un accès facile)
// ============================================================================

export const LIMITS = {
  USER: USER_LIMITS,
  CHAT: CHAT_LIMITS,
  TOURNAMENT: TOURNAMENT_LIMITS,
  GAME: GAME_LIMITS,
  DATABASE: DATABASE_LIMITS,
  SECURITY: SECURITY_LIMITS,
  WEBSOCKET: WEBSOCKET_LIMITS,
} as const;

// ============================================================================
// TYPES HELPER
// ============================================================================

export type SystemLimits = typeof LIMITS;

