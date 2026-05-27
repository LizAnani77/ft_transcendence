import { WebSocket } from 'ws';
import fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJWT from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import dotenv from 'dotenv';
import fs from 'fs';

import authRoutes from './routes/auth';
import gameRoutes from './routes/games';
import tournamentRoutes from './routes/tournaments';
import guestRoutes from './routes/guest';
import { dbService } from './services/database';
import chatRoutes from './routes/chat';
import { ServerGameEngine, PlayerInput, ServerGameState } from './game/ServerGameEngine';
import { GuestTokenService } from './services/guestTokens';
import { LIMITS } from './config/limits';
import sqlite3 from 'sqlite3';
import path from 'path';

const MAX_CHAT_CHARS = 500;

if (fs.existsSync('/secrets/app.env')) {
  console.log('Loading environment variables from Vault...');
  dotenv.config({ path: '/secrets/app.env' });
} else {
  console.log('Loading environment variables from .env file...');
  dotenv.config()
}

if (!process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET is not defined in environment variables');
  process.exit(1)
}

interface WSMessage {
  type: string;
  data: any;
  userId?: string;
  gameId?: string;
}

interface WSUser { 
  socket: WebSocket; 
  userId: number;
  username: string;
  tournamentId?: number | null;
  guestToken?: string;
  isGuest: boolean;
  currentGameId?: string | null;
}

interface GameCreateRequest { 
  opponentId?: number; 
  gameMode?: 'classic' | 'tournament';
  tournamentId?: number;
  matchId?: number;
}
interface GameJoinRequest { gameId: string }
interface GameInputRequest { gameId: string; action: 'up' | 'down' | 'stop' }
interface GameChallengeRequest { 
  challengedUserId: number;
  tournamentId?: number;
  matchId?: number;
  challengedAlias?: string;
}
interface GameChallengeCancelRequest {
  challengedUserId: number;
}
interface GameStartRequest { gameId: string }
interface ChatGlobalMessage { content: string; messageType?: string; metadata?: string }
interface ChatPrivateMessage { recipientId: number; content: string; messageType?: string; metadata?: string }
interface FriendActionRequest { userId: number; message?: string }
interface BlockActionRequest { userId: number; reason?: string }
interface NotificationAction { notificationId?: number }

const app = fastify({ logger: true });

app.addHook('onResponse', async (req, reply) => {
  const code = reply.statusCode || 0;
  if (code >= 500) {
    app.log.error({
      msg: '[HTTP-5xx]',
      code,
      method: req.method,
      url: req.url
    });
  }
});

const dbPath = path.join(process.cwd(), 'database', 'pong.db');
const guestDb = new sqlite3.Database(dbPath);
const guestTokenService = new GuestTokenService(guestDb);

const connectedUsers = new Map<number, Set<WSUser>>();
/* Vérifie si un utilisateur a au moins une session WebSocket active */
const hasActiveSession = (userId?: number | null): boolean => {
  if (typeof userId !== 'number') return false;
  const set = connectedUsers.get(userId);
  return !!set && set.size > 0;
};
/* Compte le nombre total d'utilisateurs uniques connectés */
const getConnectedUsersCount = (): number => {
  return connectedUsers.size;
};
const gameEngine = new ServerGameEngine();

app.register(fastifyCors, { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
app.register(fastifyJWT, { secret: process.env.JWT_SECRET || 'super-secret-key' });

/* Middleware d'authentification JWT avec vérification du statut 2FA */
(app as any).decorate('authenticate', async (request: any, reply: any) => {
  try {
    const payload = await request.jwtVerify();
    request.user = payload;
    
    if (request.user?.twofa_stage === 'pending') {
      return reply.code(401).send({ error: '2FA required' });
    }
  } catch (error: any) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
});

app.register(fastifyWebsocket);
app.decorate('isUserConnected', (userId: number) => hasActiveSession(userId));

/* Retourne la date et heure actuelle au format ISO */
const ts = () => new Date().toISOString();
/* Envoie un message WebSocket avec type, données et timestamp */
const send = (ws: WebSocket, type: string, data: any = {}) => {
  try { ws.send(JSON.stringify({ type, data, timestamp: ts() })); } catch (e: any) { app.log.error({ type, error: e.message }, '[WS] Send failed'); }
};
/* Envoie un message d'erreur WebSocket */
const sendErr = (ws: WebSocket, type: string, message: string) => {
  try { ws.send(JSON.stringify({ type, message, timestamp: ts() })); } catch (e: any) { app.log.error({ type, message, error: e.message }, '[WS] SendErr failed'); }
};

/* Récupère toutes les connexions WebSocket d'un utilisateur */
const getConns = (id?: number | null) => (id ? connectedUsers.get(id) : undefined);
/* Récupère une connexion WebSocket parmi celles d'un utilisateur */
const getOneConn = (id?: number | null): WSUser | undefined => {
  const set = getConns(id);
  return set && set.size ? (set.values().next().value as WSUser) : undefined
};

/* Envoie un message à toutes les connexions d'un utilisateur donné */
const sendToUser = (userId: number | undefined, type: string, data: any = {}) => {
  if (!userId) return;
  const conns = getConns(userId);
  if (!conns) return;
  const payload = JSON.stringify({ type, data, timestamp: ts() });
  for (const c of conns) {
    try { c.socket.send(payload) } catch (e: any) { app.log.error({ userId, type, error: e.message }, '[WS] sendToUser error') }
  }
};

/* Diffuse un message à tous les utilisateurs connectés */
const sendAll = (type: string, data: any = {}) => {
  const payload = JSON.stringify({ type, data, timestamp: ts() });
  for (const set of connectedUsers.values()) {
    for (const u of set) {
      try { u.socket.send(payload) } catch (e: any) { app.log.error({ userId: u.userId, type, error: e.message }, '[WS] sendAll error') }
    }
  }
};

/* Ajoute une connexion WebSocket pour un utilisateur et retourne true si c'est la première */
const addConn = (wsu: WSUser): boolean => {
  let set = connectedUsers.get(wsu.userId);
  const first = !set || set.size === 0;
  if (!set) { set = new Set<WSUser>(); connectedUsers.set(wsu.userId, set) }
  set.add(wsu);
  return first
};

/* Supprime une connexion WebSocket et retourne true si c'était la dernière */
const removeConn = (wsu: WSUser): boolean => {
  const set = connectedUsers.get(wsu.userId);
  if (!set) return true;
  set.delete(wsu);
  if (set.size === 0) { connectedUsers.delete(wsu.userId); return true }
  return false
};

/* Retourne la liste des utilisateurs en ligne avec leurs informations */
const listOnlineUsers = () => Array.from(connectedUsers.entries()).map(([id, set]) => {
  const any = set.values().next().value as WSUser | undefined;
  return { id, username: any?.username || `User${id}`, is_online: true }
});

/* Diffuse un message du chat global à tous les utilisateurs sauf ceux qui bloquent l'expéditeur */
const broadcastGlobalMessage = async (senderId: number, messageData: any) => {
  try {
    const onlineUsers = await dbService.getOnlineUsers();
    for (const user of onlineUsers) {
      if (user.id !== senderId) {
        const isBlocked = await dbService.isUserBlocked(user.id, senderId);
        if (!isBlocked) sendToUser(user.id, 'chat:global_message', messageData);
      }
    }
  } catch (error: any) { app.log.error({ error: error.message }, 'Error broadcasting global message:'); }
};

/* Envoie un message à toutes les sessions WebSocket d'un utilisateur */
const broadcastToUser = (userId: number, type: string, data: any) => {
  try {
    const conns = getConns(userId);
    if (!conns?.size) return;
    const payload = JSON.stringify({ type, data, timestamp: ts() });
    for (const conn of conns) {
      try { conn.socket.send(payload) } catch (e: any) { app.log.error({ userId, type, error: e.message }, '[BROADCAST] Send failed') }
    }
  } catch (e: any) { app.log.error({ userId, type, error: e.message }, '[BROADCAST] Broadcast failed') }
};

/* Efface la référence au jeu en cours pour toutes les connexions d'un utilisateur */
const clearCurrentGameForUser = (userId: number, gameId: string) => {
  const conns = getConns(userId);
  if (!conns) return;
  for (const conn of conns) {
    if (conn.currentGameId === gameId) {
      conn.currentGameId = null;
    }
  }
};

/* Recherche une partie active (non terminée) pour un utilisateur donné */
const findActiveGameForUser = (userId?: number | null): { gameId: string; state: ServerGameState } | null => {
  if (typeof userId !== 'number') return null;
  for (const gameId of gameEngine.getActiveGames()) {
    const state = gameEngine.getGameState(gameId);
    if (!state) continue;
    const { player1, player2 } = state.players;
    if (player1?.id === userId || player2?.id === userId) {
      return { gameId, state };
    }
  }
  return null;
};

const pendingFriendlyChallenges = new Map<number, number>();
const pendingFriendlyTargets = new Map<number, number>();

/* Vérifie si un joueur a déjà envoyé un challenge amical en attente */
const hasPendingFriendlyChallenge = (challengerId: number): boolean => pendingFriendlyChallenges.has(challengerId);

type FriendlyChallengeBlockReason =
  | 'challenger_has_pending'
  | 'challenger_in_game'
  | 'challenged_in_game'
  | 'challenged_has_pending'
  | 'challenged_challenging_other'
  | 'challenger_in_tournament'
  | 'challenged_in_tournament'
  | 'challenger_blocked_target'
  | 'challenged_blocked_challenger';

interface FriendlyChallengeValidationOk {
  ok: true;
}

interface FriendlyChallengeValidationError {
  ok: false;
  reason: FriendlyChallengeBlockReason;
  error: string;
}

type FriendlyChallengeValidationResult = FriendlyChallengeValidationOk | FriendlyChallengeValidationError;

/* Type guard pour vérifier si le résultat de validation est une erreur */
const isFriendlyChallengeValidationError = (
  result: FriendlyChallengeValidationResult
): result is FriendlyChallengeValidationError => result.ok === false;

/* Enregistre un challenge amical en attente entre deux joueurs */
const setPendingFriendlyChallenge = (challengerId: number, challengedUserId: number) => {
  pendingFriendlyChallenges.set(challengerId, challengedUserId);
  pendingFriendlyTargets.set(challengedUserId, challengerId);
};
/* Supprime un challenge amical en attente */
const clearPendingFriendlyChallenge = (challengerId?: number, challengedUserId?: number) => {
  if (typeof challengerId !== 'number' && typeof challengedUserId === 'number') {
    challengerId = pendingFriendlyTargets.get(challengedUserId);
  }
  if (typeof challengedUserId !== 'number' && typeof challengerId === 'number') {
    challengedUserId = pendingFriendlyChallenges.get(challengerId);
  }
  if (typeof challengerId === 'number') {
    pendingFriendlyChallenges.delete(challengerId);
  }
  if (typeof challengedUserId === 'number') {
    pendingFriendlyTargets.delete(challengedUserId);
  }
};
/* Annule un challenge amical et notifie le joueur challengé */
const cancelPendingFriendlyChallenge = (challengerId: number, reason: string = 'cancelled') => {
  const challengedUserId = pendingFriendlyChallenges.get(challengerId);
  if (!challengedUserId) return;
  const challengerConn = getOneConn(challengerId);
  sendToUser(challengedUserId, 'game:challenge_cancelled', {
    challengerId,
    challengerName: challengerConn?.username || 'Player',
    reason
  });
  clearPendingFriendlyChallenge(challengerId, challengedUserId);
};

/* Valide toutes les conditions pour qu'un challenge amical soit possible */
const ensureFriendlyChallengePossible = async (
  challengerId: number,
  challengedUserId: number
): Promise<FriendlyChallengeValidationResult> => {
  if (hasPendingFriendlyChallenge(challengerId)) {
    return {
      ok: false,
      reason: 'challenger_has_pending',
      error: 'You already sent a challenge. Wait for a response first.'
    };
  }

  const challengerActiveGame = findActiveGameForUser(challengerId);
  if (challengerActiveGame) {
    return {
      ok: false,
      reason: 'challenger_in_game',
      error: 'You are already in an active game'
    };
  }

  const challengedActiveGame = findActiveGameForUser(challengedUserId);
  if (challengedActiveGame) {
    return {
      ok: false,
      reason: 'challenged_in_game',
      error: 'This user is already playing another game'
    };
  }

  const existingChallenger = pendingFriendlyTargets.get(challengedUserId);
  if (existingChallenger) {
    return {
      ok: false,
      reason: 'challenged_has_pending',
      error: 'This user already has a pending challenge'
    };
  }

  const challengedHasOutgoing = pendingFriendlyChallenges.get(challengedUserId);
  if (challengedHasOutgoing) {
    return {
      ok: false,
      reason: 'challenged_challenging_other',
      error: 'This user already has a pending challenge'
    };
  }

  const [blockedByChallenger, blockedByChallenged, challengerInTournament, challengedInTournament] =
    await Promise.all([
      dbService.isUserBlocked(challengerId, challengedUserId),
      dbService.isUserBlocked(challengedUserId, challengerId),
      dbService.isUserInActiveTournament(challengerId),
      dbService.isUserInActiveTournament(challengedUserId)
    ]);

  if (challengerInTournament) {
    return {
      ok: false,
      reason: 'challenger_in_tournament',
      error: 'You cannot start a friendly match while registered in a tournament'
    };
  }

  if (challengedInTournament) {
    return {
      ok: false,
      reason: 'challenged_in_tournament',
      error: 'This user is currently participating in a tournament'
    };
  }

  if (blockedByChallenger) {
    return {
      ok: false,
      reason: 'challenger_blocked_target',
      error: 'You cannot challenge a user you blocked'
    };
  }

  if (blockedByChallenged) {
    return {
      ok: false,
      reason: 'challenged_blocked_challenger',
      error: 'This user has blocked you'
    };
  }

  return { ok: true };
};

/* Diffuse une mise à jour de tournoi à tous les participants (users et guests) */
async function broadcastTournamentUpdate(tournamentId: number, updateType: string, data?: any) {
  try {

    const participants = await dbService.dbAll(`
      SELECT 
        ta.user_id,
        gs.token as guest_token
      FROM tournament_aliases ta
      LEFT JOIN guest_sessions gs 
        ON ta.tournament_id = gs.tournament_id 
        AND ta.player_alias = gs.player_alias
        AND datetime(gs.expires_at) > datetime('now')
      WHERE ta.tournament_id = ?
    `, [tournamentId]);
    
    console.log('[TOURNAMENT] 📡 Broadcasting update:', {
      tournamentId,
      updateType,
      participantsCount: participants.length
    });
    
    for (const participant of participants) {

      if (participant.user_id) {
        sendToUser(participant.user_id, `tournament:${updateType}`, {
          tournamentId,
          ...data,
          timestamp: Date.now()
        });
      }

      else if (participant.guest_token) {
        const userId = await guestTokenService.getUserIdFromToken(participant.guest_token);
        if (userId) {
          sendToUser(userId, `tournament:${updateType}`, {
            tournamentId,
            ...data,
            timestamp: Date.now()
          });
        }
      }
    }
  } catch (error) {
    console.error('[TOURNAMENT] Error broadcasting update:', error);
  }
}

/* Envoie les compteurs de messages non lus à un utilisateur */
const sendUnreadUpdate = async (userId: number) => {
  try {
    const unreadCounts = await dbService.getUnreadMessageCounts(userId);
    const totalUnreadCount = unreadCounts.reduce((sum, item) => sum + item.count, 0);
    
    sendToUser(userId, 'chat:unread_update', {
      totalUnreadCount,
      unreadCounts
    });
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error sending unread update:');
  }
};

/* Envoie un message système dans le chat global pour annoncer un événement de tournoi */
async function sendTournamentChatMessage(message: string): Promise<void> {
  try {
    console.log('[TOURNAMENT] 💬 Sending optimized chat message:', message);
    

    let systemUserId = 1;
    const systemUser = await dbService.getUserById(systemUserId);
    if (!systemUser) {
      const firstUser = await dbService.dbGet('SELECT id FROM users ORDER BY id ASC LIMIT 1');
      if (firstUser) {
        systemUserId = firstUser.id;
      } else {
        console.error('[TOURNAMENT] No users found in database, cannot send chat message');
        return;
      }
    }


    const messageId = await dbService.sendMessage(
      1, // conversation_id = 1 (chat global)
      systemUserId,
      message,
      'tournament_announcement',
      undefined,
      false
    );


    const onlineUserIds = Array.from(connectedUsers.keys());
    
    const messageData = {
      id: messageId,
      conversation_id: 1,
      sender_id: systemUserId,
      sender_username: 'Tournament',
      content: message,
      message_type: 'tournament_announcement',
      created_at: new Date().toISOString(),
      conversationType: 'global'
    };


    let sentCount = 0;
    for (const userId of onlineUserIds) {
      try {
        sendToUser(userId, 'chat:global_message', messageData);
        sentCount++;
      } catch (error) {
        console.warn('[TOURNAMENT] Failed to send to user', userId, error);
      }
    }
    
    console.log('[TOURNAMENT] ✅ Chat message broadcasted to', sentCount, 'online users');
  } catch (error) {
    console.error('[TOURNAMENT] Failed to send chat message:', error);
  }
}

app.decorate('broadcastToUser', broadcastToUser);
app.decorate('ensureFriendlyChallengePossible', ensureFriendlyChallengePossible);
app.decorate('broadcastTournamentUpdate', broadcastTournamentUpdate);
app.decorate('sendTournamentChatMessage', sendTournamentChatMessage);
app.decorate('sendToUser', sendToUser);

try { app.register(gameRoutes, { prefix: '/api/games' }); } catch (error) { console.error('[ROUTES] Failed to register game routes:', error); }
try { app.register(tournamentRoutes, { prefix: '/api/tournaments' }); } catch (error) { console.error('[ROUTES] Failed to register tournament routes:', error); }
try { app.register(authRoutes, { prefix: '/api/auth' }); } catch (error) { console.error('[ROUTES] Failed to register auth routes:', error); }
try { app.register(guestRoutes, { prefix: '/api/guest' }); } catch (error) { console.error('[ROUTES] Failed to register guest routes:', error); }
try {
  app.register(chatRoutes, {
    prefix: '/api/chat',
    preHandler: (request: any, _reply: any, done: any) => { (request as any).broadcastToUser = broadcastToUser; done(); }
  });
} catch (error) { console.error('[ROUTES] Failed to register chat routes:', error); }

/* Notifie tous les amis d'un utilisateur de son changement de statut en ligne */
async function notifyFriendsOnlineStatus(userId: number, isOnline: boolean) {
  try {
    const friends = await dbService.getFriends(userId);
    for (const f of friends) sendToUser(f.id, 'friend:status_change', { friendId: userId, isOnline })
  } catch (error) { console.error('Erreur lors de la notification des amis:', error) }
}

/* Gère le forfait d'un joueur dans un tournoi (annulation ou victoire par défaut) */
async function handleTournamentForfeit(
  userId: number, 
  playerAlias: string | null,
  reason: 'declined_invitation' | 'abandoned_game' | 'disconnected'
): Promise<void> {
  try {
    const activeParticipation = await dbService.dbGet(`
      SELECT ta.tournament_id, ta.player_alias, ta.is_owner, ta.user_id, t.status
      FROM tournament_aliases ta
      JOIN tournaments t ON ta.tournament_id = t.id
      WHERE ta.user_id = ? AND t.status IN ('waiting', 'active')
      LIMIT 1
    `, [userId]);

    if (!activeParticipation) {
      console.log('[FORFAIT] User not in active tournament, skipping forfeit');
      return;
    }

  const tournamentId = activeParticipation.tournament_id;
  const alias = playerAlias || activeParticipation.player_alias;
  const isOwner = activeParticipation.is_owner === 1;
  const tournamentStatus = activeParticipation.status as 'waiting' | 'active';

    console.log('[FORFAIT] Processing forfeit (internal):', {
      userId,
      tournamentId,
      alias,
      isOwner,
      reason
    });

    if (isOwner && tournamentStatus === 'waiting') {
      await dbService.dbRun(
        `UPDATE tournaments 
         SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [tournamentId]
      );

      await dbService.dbRun(
        `UPDATE tournament_matches_aliases
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE tournament_id = ? AND status IN ('pending', 'active')`,
        [tournamentId]
      );

      try {
        const participants = await dbService.dbAll(
          `SELECT user_id, player_alias FROM tournament_aliases WHERE tournament_id = ?`,
          [tournamentId]
        );
        for (const p of participants) {
          if (p.user_id && p.user_id < 0) {
            try {
              const sess = await dbService.dbGet(
                `SELECT token FROM guest_sessions WHERE user_id = ? AND tournament_id = ?`,
                [p.user_id, tournamentId]
              );
              if (sess?.token) {
                await guestTokenService.unlinkGuestFromTournament(sess.token);
              }
            } catch {}
          }
        }
      } catch (e) {
        console.warn('[FORFAIT] Guest unlink (owner) failed:', e);
      }

      await broadcastTournamentUpdate(tournamentId, 'cancelled', {
        reason,
        message: 'Tournament cancelled by creator'
      });

      return;
    } else if (isOwner && tournamentStatus === 'active') {
      console.log('[FORFAIT] Owner forfeited after start → treat as normal player forfeit');
    }

    const match = await dbService.dbGet(
      `SELECT id, round, player1_alias, player2_alias, status
       FROM tournament_matches_aliases
       WHERE tournament_id = ? 
         AND (player1_alias = ? OR player2_alias = ?)
         AND status IN ('pending', 'active')
       ORDER BY round DESC, id DESC
       LIMIT 1`,
      [tournamentId, alias, alias]
    );

    if (!match) {
      console.log('[FORFAIT] No active/pending match found for alias (skipping):', { tournamentId, alias });
      return;
    }

    const winnerAlias = match.player1_alias === alias ? match.player2_alias : match.player1_alias;

    await dbService.dbRun(
      `UPDATE tournament_matches_aliases
       SET winner_alias = ?, score1 = 0, score2 = 0, status = 'finished', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [winnerAlias, match.id]
    );

    try {
      const forfeiter = await dbService.dbGet(
        `SELECT user_id FROM tournament_aliases WHERE tournament_id = ? AND player_alias = ?`,
        [tournamentId, alias]
      );
      if (forfeiter?.user_id && forfeiter.user_id < 0) {
        const sess = await dbService.dbGet(
          `SELECT token FROM guest_sessions WHERE user_id = ? AND tournament_id = ?`,
          [forfeiter.user_id, tournamentId]
        );
        if (sess?.token) {
          await guestTokenService.unlinkGuestFromTournament(sess.token);
        }
      }
    } catch (e) {
      console.warn('[FORFAIT] Guest unlink (player) failed:', e);
    }

    await broadcastTournamentUpdate(tournamentId, 'match_forfeited', {
      matchId: match.id,
      round: match.round,
      winnerAlias,
      reason
    });

    try {
      const gameId = `tournament_${tournamentId}_${match.id}`;
      const state = gameEngine.getGameState(gameId);
      if (state) {

        try {
          let winnerUserId: number | null = null;
          const winnerRow = await dbService.dbGet(
            `SELECT user_id FROM tournament_aliases WHERE tournament_id = ? AND player_alias = ?`,
            [tournamentId, winnerAlias]
          );
          winnerUserId = winnerRow?.user_id ?? null;
          if (winnerUserId === null) {
            const sess = await dbService.dbGet(
              `SELECT token FROM guest_sessions WHERE tournament_id = ? AND player_alias = ? AND datetime(expires_at) > datetime('now')`,
              [tournamentId, winnerAlias]
            );
            if (sess?.token) {
              const uid = await guestTokenService.getUserIdFromToken(sess.token);
              if (uid) winnerUserId = uid;
            }
          }
          if (typeof winnerUserId === 'number') {
            if (state.players.player1?.id === winnerUserId) state.winnerSide = 'player1' as any;
            else if (state.players.player2?.id === winnerUserId) state.winnerSide = 'player2' as any;
          }
        } catch {}
        gameEngine.endGame(gameId);
      }
    } catch (e) {
      console.warn('[FORFAIT] Could not stop running game for forfeited match:', e);
    }

    sendToUser(userId, 'tournament:player_eliminated', {
      tournamentId,
      reason,
      message: 'You have been eliminated from the tournament'
    });

    try {
      const pendingCountRow = await dbService.dbGet(
        `SELECT COUNT(*) as count
         FROM tournament_matches_aliases
         WHERE tournament_id = ? AND round = ? AND status IN ('pending', 'active')`,
        [tournamentId, match.round]
      );
      const pendingCount = pendingCountRow?.count || 0;
      if (pendingCount === 0) {
        await generateNextRound(tournamentId, match.round);
      }
    } catch (e) {
      console.error('[FORFAIT] Failed to generate next round after forfeit:', e);
    }

  } catch (error) {
    console.error('[FORFAIT] Error handling tournament forfeit:', error);
  }
}

/* Extrait le tournamentId et matchId depuis un gameId de format tournament_X_Y */
async function getTournamentMatchByGameId(gameId: string): Promise<{ tournamentId: number; matchId: number } | null> {
  try {
    if (gameId.startsWith('tournament_')) {
      const parts = gameId.split('_');
      if (parts.length === 3) {
        const tournamentId = parseInt(parts[1], 10);
        const matchId = parseInt(parts[2], 10);
        
        if (!isNaN(tournamentId) && !isNaN(matchId)) {
          console.log('[TOURNAMENT] Game detected as tournament match:', { gameId, tournamentId, matchId });
          return { tournamentId, matchId };
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[TOURNAMENT] Error checking tournament match:', error);
    return null;
  }
}

/* Enregistre automatiquement le résultat d'un match de tournoi et génère le round suivant si nécessaire */
async function autoSaveTournamentMatchResult(
  tournamentId: number, 
  matchId: number, 
  summary: any,
  gameState: any
): Promise<void> {
  try {
    console.log('[TOURNAMENT] Auto-saving tournament match result:', {
      tournamentId,
      matchId,
      winner: summary?.winner?.username,
      winnerId: summary?.winner?.id,
      score1: summary?.score1,
      score2: summary?.score2
    });

    const tournament = await dbService.getTournament(tournamentId);
    if (!tournament) {
      console.error('[TOURNAMENT] Tournament not found:', tournamentId);
      return;
    }
    const currentRound = tournament.current_round;

    let pendingCount = 0;

    await dbService.dbRun('BEGIN TRANSACTION');

    try {
      const participants = await dbService.dbAll(`
        SELECT player_alias, user_id 
        FROM tournament_aliases 
        WHERE tournament_id = ?
      `, [tournamentId]);

      const matches = await dbService.getTournamentMatchesAliases(tournamentId);
      const match = matches.find(m => m.id === matchId);

      if (!match) {
        console.error('[TOURNAMENT] Match not found:', { tournamentId, matchId });
        return;
      }

      const winnerId = summary.winner.id;
      const winnerParticipant = participants.find((p: any) => p.user_id === winnerId);
      
      if (!winnerParticipant) {
        console.error('[TOURNAMENT] Winner participant not found:', { winnerId, tournamentId, participants });
        return;
      }

      const winnerAlias = winnerParticipant.player_alias;

      console.log('[TOURNAMENT] Saving match result to database:', {
        matchId,
        winnerAlias,
        winnerId,
        score1: summary.score1,
        score2: summary.score2
      });

      await dbService.updateTournamentMatchAlias(
        matchId,
        winnerAlias,
        summary.score1,
        summary.score2
      );

      console.log('[TOURNAMENT] ✅ Match result saved successfully');

      // Vérification dans la transaction
      const pendingCountResult = await dbService.dbGet(
        `SELECT COUNT(*) as count 
         FROM tournament_matches_aliases
         WHERE tournament_id = ? AND round = ? AND status IN ('pending', 'active')`,
        [tournamentId, currentRound]
      );

      pendingCount = pendingCountResult?.count || 0;

      await dbService.dbRun('COMMIT');

      console.log('[TOURNAMENT] Round status:', {
        tournamentId,
        currentRound,
        pendingMatches: pendingCount
      });

    } catch (error) {
      await dbService.dbRun('ROLLBACK');
      throw error;
    }

    const matchRoundResult = await dbService.dbGet(`
      SELECT round FROM tournament_matches_aliases WHERE id = ?
    `, [matchId]);
    const matchRound = matchRoundResult?.round;
    const isFinalRound = matchRound === 2;

    console.log('[TOURNAMENT] 🔔 Notifying players of finished match:', {
      tournamentId,
      matchId,
      isFinalRound,
      matchRound
    });

    const eventData = {
      tournamentId,
      matchId,
      winner: false,
      score: `${summary.score1}-${summary.score2}`,
      message: 'Your match is complete - returning to tournament',
      nextAction: 'return_to_tournament'
    };

    if (isFinalRound) {
      console.log('[TOURNAMENT] 📡 Broadcasting match_finished to ALL participants (final round)');
      broadcastTournamentUpdate(tournamentId, 'match_finished', {
        ...eventData
      });
    } else {
      console.log('[TOURNAMENT] 🔔 Sending match_finished to 2 players only');

      const matchPlayers = await dbService.dbAll(`
        SELECT 
          tma.player1_alias,
          tma.player2_alias,
          ta1.user_id as p1_user_id,
          ta2.user_id as p2_user_id,
          gs1.token as p1_guest_token,
          gs2.token as p2_guest_token
        FROM tournament_matches_aliases tma
        LEFT JOIN tournament_aliases ta1 ON tma.tournament_id = ta1.tournament_id AND tma.player1_alias = ta1.player_alias
        LEFT JOIN tournament_aliases ta2 ON tma.tournament_id = ta2.tournament_id AND tma.player2_alias = ta2.player_alias
        LEFT JOIN guest_sessions gs1 ON tma.tournament_id = gs1.tournament_id AND tma.player1_alias = gs1.player_alias AND datetime(gs1.expires_at) > datetime('now')
        LEFT JOIN guest_sessions gs2 ON tma.tournament_id = gs2.tournament_id AND tma.player2_alias = gs2.player_alias AND datetime(gs2.expires_at) > datetime('now')
        WHERE tma.id = ?
      `, [matchId]);

      if (matchPlayers.length > 0) {
        const match = matchPlayers[0];
        
        if (match.p1_user_id) {
          const isWinner = (match.p1_user_id === summary.winner.id);
          sendToUser(match.p1_user_id, 'tournament:match_finished', {
            ...eventData,
            winner: isWinner
          });
          console.log('[TOURNAMENT] ✅ Notification sent to player1:', match.p1_user_id, match.player1_alias);
        } else if (match.p1_guest_token) {
          const userId = await guestTokenService.getUserIdFromToken(match.p1_guest_token);
          if (userId) {
            const isWinner = (userId === summary.winner.id);
            sendToUser(userId, 'tournament:match_finished', {
              ...eventData,
              winner: isWinner
            });
            console.log('[TOURNAMENT] ✅ Notification sent to guest player1:', userId, match.player1_alias);
          }
        }

        if (match.p2_user_id) {
          const isWinner = (match.p2_user_id === summary.winner.id);
          sendToUser(match.p2_user_id, 'tournament:match_finished', {
            ...eventData,
            winner: isWinner
          });
          console.log('[TOURNAMENT] ✅ Notification sent to player2:', match.p2_user_id, match.player2_alias);
        } else if (match.p2_guest_token) {
          const userId = await guestTokenService.getUserIdFromToken(match.p2_guest_token);
          if (userId) {
            const isWinner = (userId === summary.winner.id);
            sendToUser(userId, 'tournament:match_finished', {
              ...eventData,
              winner: isWinner
            });
            console.log('[TOURNAMENT] ✅ Notification sent to guest player2:', userId, match.player2_alias);
          }
        }

        console.log('[TOURNAMENT] ✅ Notified only the 2 players of this match');
      } else {
        console.error('[TOURNAMENT] ❌ Could not find match players for matchId:', matchId);
      }
    }

    if (pendingCount === 0) {
      console.log('[TOURNAMENT] ✅ All matches finished in round! Generating next round...');
      await generateNextRound(tournamentId, currentRound);
    } else {
      console.log('[TOURNAMENT] ⏳ Waiting for other matches to finish:', {
        tournamentId,
        currentRound, 
        pendingMatches: pendingCount
      });
    }

  } catch (error) {
    console.error('[TOURNAMENT] Error auto-saving tournament result:', error);
  }
}

const tournamentLocks = new Map<number, Promise<void>>();

/* Génère les matchs du round suivant avec les gagnants du round actuel */
async function generateNextRound(tournamentId: number, currentRound: number): Promise<void> {
  const existingMatches = await dbService.dbGet(`
    SELECT COUNT(*) as count 
    FROM tournament_matches_aliases
    WHERE tournament_id = ? AND round = ?
  `, [tournamentId, currentRound + 1]);
  
  if (existingMatches.count > 0) {
    console.log('[TOURNAMENT] Round already generated, skipping');
    return;
  }

  if (tournamentLocks.has(tournamentId)) {
    console.log('[TOURNAMENT] Waiting for existing lock on tournament', tournamentId);
    await tournamentLocks.get(tournamentId);
    
    const existingMatchesAfterLock = await dbService.dbGet(`
      SELECT COUNT(*) as count 
      FROM tournament_matches_aliases
      WHERE tournament_id = ? AND round = ?
    `, [tournamentId, currentRound + 1]);
    
    if (existingMatchesAfterLock.count > 0) {
      console.log('[TOURNAMENT] Round already generated by another thread, skipping');
      return;
    }
  }

  const lockPromise = (async () => {
    try {
      console.log('[TOURNAMENT] 🎯 generateNextRound called:', { tournamentId, currentRound });

      const currentRoundMatches = await dbService.dbAll(`
        SELECT id, status, winner_alias 
        FROM tournament_matches_aliases 
        WHERE tournament_id = ? AND round = ?
      `, [tournamentId, currentRound]);

      console.log('[TOURNAMENT] 🔍 Checking round completion:', {
        tournamentId,
        currentRound,
        totalMatches: currentRoundMatches.length,
        finishedMatches: currentRoundMatches.filter(m => m.status === 'finished').length
      });

      const allMatchesFinished = currentRoundMatches.length > 0 && 
                               currentRoundMatches.every(m => m.status === 'finished');

      if (!allMatchesFinished) {
        console.log('[TOURNAMENT] ⏳ Round not complete yet, waiting for other matches:', {
          tournamentId,
          currentRound,
          finished: currentRoundMatches.filter(m => m.status === 'finished').length,
          total: currentRoundMatches.length
        });
        return;
      }

      const winners = await dbService.getRoundWinners(tournamentId, currentRound);
      
      console.log('[TOURNAMENT] 🏆 Round complete, winners:', {
        tournamentId,
        currentRound,
        winners,
        winnersCount: winners.length
      });

      if (winners.length === 1) {
        console.log('[TOURNAMENT] 🎉 Tournament finished! Champion:', winners[0]);
        
        await dbService.updateTournament(tournamentId, {
          status: 'finished',
          ended_at: new Date().toISOString()
        });

        await dbService.saveTournamentResultAlias(tournamentId, winners[0], 1);
        
        console.log('[TOURNAMENT] Tournament marked as finished');

        await broadcastTournamentUpdate(tournamentId, 'finished', {
          champion: winners[0]
        });
        
      } else if (winners.length === 2) {
        const nextRound = currentRound + 1;
        console.log('[TOURNAMENT] 🏆 Generating final round:', { tournamentId, nextRound });

        await dbService.createTournamentMatchAlias(
          tournamentId,
          nextRound,
          winners[0],
          winners[1],
          'pending'
        );

        await dbService.dbRun(
          `UPDATE tournament_matches_aliases
           SET p1_ready = 0, p2_ready = 0, ready_deadline = datetime('now', '+20 seconds')
           WHERE tournament_id = ? AND round = ?`,
          [tournamentId, nextRound]
        );

        await dbService.updateTournament(tournamentId, {
          current_round: nextRound
        });

        console.log('[TOURNAMENT] Final round generated (round', nextRound, ')');
        
        const chatMessage = `🏆 Upcoming matches: ${winners[0]} vs ${winners[1]}`;
        await sendTournamentChatMessage(chatMessage);

        await broadcastTournamentUpdate(tournamentId, 'round_complete', {
          completedRound: currentRound,
          nextRound
        });

      } else if (winners.length === 3 && currentRound === 1) {

        const nextRound = currentRound + 1;
        console.log('[TOURNAMENT] ⚖️ Handling 3 winners after round 1 (double forfeit case):', { tournamentId, winners });

        await dbService.createTournamentMatchAlias(
          tournamentId,
          nextRound,
          winners[0],
          winners[1],
          'pending'
        );

        await dbService.createTournamentMatchAlias(
          tournamentId,
          nextRound,
          winners[2],
          winners[2],
          'pending'
        );

        await dbService.dbRun(
          `UPDATE tournament_matches_aliases
             SET status = 'finished',
                 winner_alias = ?,
                 p1_ready = 1,
                 p2_ready = 1,
                 updated_at = CURRENT_TIMESTAMP
           WHERE tournament_id = ?
             AND round = ?
             AND player1_alias = ?
             AND player2_alias = ?
             AND status = 'pending'`,
          [winners[2], tournamentId, nextRound, winners[2], winners[2]]
        );

        await dbService.dbRun(
          `UPDATE tournament_matches_aliases
             SET p1_ready = 0,
                 p2_ready = 0,
                 ready_deadline = datetime('now', '+20 seconds')
           WHERE tournament_id = ?
             AND round = ?
             AND status = 'pending'`,
          [tournamentId, nextRound]
        );

        await dbService.updateTournament(tournamentId, {
          current_round: nextRound
        });

        console.log('[TOURNAMENT] ✅ Semi-final  BYE generated (round', nextRound, ')');

        const chatMessage = `🏆 Upcoming matches: ${winners[0]} vs ${winners[1]} (one player advances by bye)`;
        await sendTournamentChatMessage(chatMessage);

        await broadcastTournamentUpdate(tournamentId, 'round_complete', {
          completedRound: currentRound,
          nextRound,
          note: 'double_forfeit_adjustment'
        });
        
      } else if (winners.length === 4) {
        const nextRound = currentRound + 1;
        console.log('[TOURNAMENT] 🏆 Generating semi-finals:', { tournamentId, nextRound });

        await dbService.createTournamentMatchAlias(
          tournamentId,
          nextRound,
          winners[0],
          winners[1],
          'pending'
        );
        
        await dbService.createTournamentMatchAlias(
          tournamentId,
          nextRound,
          winners[2],
          winners[3],
          'pending'
        );

        await dbService.dbRun(
          `UPDATE tournament_matches_aliases
           SET p1_ready = 0, p2_ready = 0, ready_deadline = datetime('now', '+20 seconds')
           WHERE tournament_id = ? AND round = ?`,
          [tournamentId, nextRound]
        );

        await dbService.updateTournament(tournamentId, {
          current_round: nextRound
        });

        console.log('[TOURNAMENT] Semi-finals generated (round', nextRound, ')');
        
        const chatMessage = `🏆 Upcoming matches: ${winners[0]} vs ${winners[1]}, ${winners[2]} vs ${winners[3]}`;
        await sendTournamentChatMessage(chatMessage);

        await broadcastTournamentUpdate(tournamentId, 'round_complete', {
          completedRound: currentRound,
          nextRound
        });
        
      } else {
        console.error('[TOURNAMENT] ❌ Invalid number of winners:', winners.length);

        await dbService.updateTournament(tournamentId, {
          status: 'cancelled',
          ended_at: new Date().toISOString()
        });
      
        console.log('[TOURNAMENT] Tournament cancelled due to invalid winner count');
        
        const chatMessage = `Tournament cancelled`;
        await sendTournamentChatMessage(chatMessage);
        
        await broadcastTournamentUpdate(tournamentId, 'cancelled', {
          reason: 'invalid_winner_count',
          winnerCount: winners.length
        });
      }
      
    } finally {
      tournamentLocks.delete(tournamentId);
    }
  })();

  tournamentLocks.set(tournamentId, lockPromise);
  await lockPromise;
}

app.decorate('generateNextRound', generateNextRound);

/* Vérifie et traite les matchs de tournoi dont le délai de préparation est expiré */
async function checkExpiredDeadlines(): Promise<void> {
  try {
    // Récupérer tous les matchs pending avec deadline expirée
    const expiredMatches = await dbService.dbAll(
        `SELECT id, tournament_id, round, player1_alias, player2_alias, 
                p1_ready, p2_ready, ready_deadline
         FROM tournament_matches_aliases
         WHERE status = 'pending'
           AND ready_deadline IS NOT NULL
           AND ready_deadline <= datetime('now')`,
    );

    if (expiredMatches.length > 0) {
      console.log(`[DEADLINE-JOB] 🕐 Found ${expiredMatches.length} expired match(es)`);

      const expiredByTournament = new Map<string, typeof expiredMatches>();

      for (const match of expiredMatches) {
        const key = `${match.tournament_id}-${match.round}`;
        if (!expiredByTournament.has(key)) {
          expiredByTournament.set(key, []);
        }
        expiredByTournament.get(key)!.push(match);
      }

      console.log(`[DEADLINE-JOB] 🎯 Processing ${expiredByTournament.size} tournament/round group(s)`);

      for (const [key, matches] of expiredByTournament) {
        const [tournamentId, round] = key.split('-').map(Number);
        
        console.log(`[DEADLINE-JOB] 📋 Processing tournament ${tournamentId}, round ${round} (${matches.length} match(es))`);

        const broadcastsToSend: Array<{ type: string; data: any }> = [];

        const transactionTimeout = 8000; // 8 secondes max
        let transactionCompleted = false;

        const transactionPromise = (async () => {

          await dbService.dbRun('BEGIN DEFERRED');

          try {

            for (const match of matches) {
              const { id: matchId, p1_ready, p2_ready, player1_alias, player2_alias } = match;

              let winnerAlias: string | null = null;
              let forfeitReason: string | null = null;
              let newStatus: string = 'cancelled';

              if (p1_ready === 1 && p2_ready !== 1) {
                winnerAlias = player1_alias;
                forfeitReason = `${player2_alias} failed to ready in time`;
                newStatus = 'finished';
              } else if (p1_ready !== 1 && p2_ready === 1) {
                winnerAlias = player2_alias;
                forfeitReason = `${player1_alias} failed to ready in time`;
                newStatus = 'finished';
              } else if (p1_ready !== 1 && p2_ready !== 1) {
                forfeitReason = 'Both players failed to ready';
                newStatus = 'finished';
                winnerAlias = null;
              }

              await dbService.dbRun(
                  `UPDATE tournament_matches_aliases
                  SET status = ?, winner_alias = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                  [newStatus, winnerAlias, matchId]
              );

              console.log(`[DEADLINE-JOB] ✅ Match ${matchId}: ${newStatus} - Winner: ${winnerAlias || 'NONE'}`);

              if (winnerAlias) {
                broadcastsToSend.push({
                  type: 'match_forfeited',
                  data: { matchId, winnerAlias, reason: 'deadline_expired', round }
                });
              } else {
                broadcastsToSend.push({
                  type: 'match_cancelled',
                  data: { matchId, reason: 'both_players_not_ready', round }
                });
              }
            }

            const pendingCountResult = await dbService.dbGet(
                `SELECT COUNT(*) as count 
                FROM tournament_matches_aliases
                WHERE tournament_id = ? AND round = ? AND status IN ('pending', 'active')`,
                [tournamentId, round]
            );

            const pendingCount = pendingCountResult?.count || 0;

            await dbService.dbRun('COMMIT');
            transactionCompleted = true;

            console.log(`[DEADLINE-JOB] 📡 Broadcasting ${broadcastsToSend.length} update(s) for tournament ${tournamentId}`);
            
            for (const broadcast of broadcastsToSend) {
              broadcastTournamentUpdate(tournamentId, broadcast.type, broadcast.data);
            }

            if (pendingCount === 0) {
              console.log(`[DEADLINE-JOB] 🏆 Round ${round} complete, generating next round`);
              await generateNextRound(tournamentId, round);
            } else {
              console.log(`[DEADLINE-JOB] ⏳ Round ${round} not complete (${pendingCount} pending)`);
            }

          } catch (error) {
            await dbService.dbRun('ROLLBACK');
            console.error(`[DEADLINE-JOB] ❌ Transaction failed for tournament ${tournamentId}:`, error);
            throw error;
          }
        })();


        try {
          await Promise.race([
            transactionPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Transaction timeout after ${transactionTimeout}ms`)), transactionTimeout)
            )
          ]);
        } catch (timeoutError) {
          if (!transactionCompleted) {
            console.error(`[DEADLINE-JOB] ⚠️ Transaction timeout for tournament ${tournamentId}, skipping...`);
            continue; 
          }
        }
      }
    }

    try {
      const readyActive = await dbService.dbAll(
        `SELECT id, tournament_id, round, player1_alias, player2_alias
         FROM tournament_matches_aliases
         WHERE status = 'active'
           AND ready_deadline IS NOT NULL
           AND ready_deadline <= datetime('now')
           AND COALESCE(p1_ready,0) = 1
           AND COALESCE(p2_ready,0) = 1`,
      );

      if (readyActive.length > 0) {
        console.log(`[DEADLINE-JOB] ▶️ Found ${readyActive.length} ready active match(es) to start`);
      }

      for (const m of readyActive) {
        try {
          await startTournamentMatch(m.tournament_id, m.id);
        } catch (e) {
          console.error('[DEADLINE-JOB] Failed to start ready match', { matchId: m.id, tournamentId: m.tournament_id, error: (e as any)?.message });
        }
      }
    } catch (e) {
      console.error('[DEADLINE-JOB] ❌ Error while starting ready active matches:', e);
    }

  } catch (error) {
    console.error('[DEADLINE-JOB] ❌ Error checking deadlines:', error);
  }
}

const DEADLINE_CHECK_INTERVAL = 5000; // 5 secondes
setInterval(() => {
  checkExpiredDeadlines().catch(err => 
    console.error('[DEADLINE-JOB] Unhandled error:', err)
  );
}, DEADLINE_CHECK_INTERVAL);

console.log(`[DEADLINE-JOB] 🚀 Started with interval: ${DEADLINE_CHECK_INTERVAL}ms`);

/* Démarre une partie de tournoi côté serveur quand les deux joueurs sont prêts */
async function startTournamentMatch(tournamentId: number, matchId: number): Promise<void> {
  try {

    const gameId = `tournament_${tournamentId}_${matchId}`;
    const existing = gameEngine.getGameState(gameId);

    const match = await dbService.dbGet(
      `SELECT id, round, player1_alias, player2_alias
       FROM tournament_matches_aliases
       WHERE id = ? AND tournament_id = ?`,
      [matchId, tournamentId]
    );

    if (!match) {
      console.warn('[TOURNAMENT] startTournamentMatch: match not found', { tournamentId, matchId });
      return;
    }

    const round = match.round;
    const p1Alias = match.player1_alias as string;
    const p2Alias = match.player2_alias as string;

    const p1 = await dbService.dbGet(
      `SELECT user_id FROM tournament_aliases WHERE tournament_id = ? AND player_alias = ?`,
      [tournamentId, p1Alias]
    );
    const p2 = await dbService.dbGet(
      `SELECT user_id FROM tournament_aliases WHERE tournament_id = ? AND player_alias = ?`,
      [tournamentId, p2Alias]
    );

    let p1Id: number | null = p1?.user_id ?? null;
    let p2Id: number | null = p2?.user_id ?? null;

    if (p1Id === null) {
      const s1 = await dbService.dbGet(
        `SELECT token FROM guest_sessions WHERE tournament_id = ? AND player_alias = ? AND datetime(expires_at) > datetime('now')`,
        [tournamentId, p1Alias]
      );
      if (s1?.token) {
        const uid = await guestTokenService.getUserIdFromToken(s1.token);
        if (uid) p1Id = uid;
      }
    }
    if (p2Id === null) {
      const s2 = await dbService.dbGet(
        `SELECT token FROM guest_sessions WHERE tournament_id = ? AND player_alias = ? AND datetime(expires_at) > datetime('now')`,
        [tournamentId, p2Alias]
      );
      if (s2?.token) {
        const uid = await guestTokenService.getUserIdFromToken(s2.token);
        if (uid) p2Id = uid;
      }
    }

    if (typeof p1Id !== 'number' || typeof p2Id !== 'number') {
      console.warn('[TOURNAMENT] Cannot start match: missing user ids', { tournamentId, matchId, p1Id, p2Id });
      return;
    }

    const p1Conn = getOneConn(p1Id);
    const p2Conn = getOneConn(p2Id);
    if (!p1Conn || !p2Conn) {
      console.warn('[TOURNAMENT] Not starting match (a player is offline)', { matchId, tournamentId, p1Online: !!p1Conn, p2Online: !!p2Conn });
      return;
    }

    let p1Name = p1Conn.username || p1Alias;
    let p2Name = p2Conn.username || p2Alias;
    let p1Avatar = '';
    let p2Avatar = '';
    try {
      if (p1Id > 0) {
        const u1 = await dbService.getUserById(p1Id);
        if (u1) { p1Name = u1.username || p1Alias; p1Avatar = u1.avatar_url || ''; }
      }
      if (p2Id > 0) {
        const u2 = await dbService.getUserById(p2Id);
        if (u2) { p2Name = u2.username || p2Alias; p2Avatar = u2.avatar_url || ''; }
      }
    } catch {}

    if (!existing) {
      gameEngine.createGameWithId(
        gameId,
        p1Id, p1Name, p1Avatar,
        p2Id, p2Name, p2Avatar
      );
      gameEngine.updatePlayerConnection(gameId, p1Id, true);
      gameEngine.updatePlayerConnection(gameId, p2Id, true);
      const started = gameEngine.startGame(gameId);
      console.log('[TOURNAMENT] ✅ Server-started game for match', { tournamentId, matchId, started });
    } else {
      console.log('[TOURNAMENT] ▶️ Game already exists for match, re-notifying players', { tournamentId, matchId });
    }

    const state = gameEngine.getGameState(gameId);
    if (!state) {
      console.warn('[TOURNAMENT] startTournamentMatch: state not found after start', { gameId });
      return;
    }

    const startedData = {
      gameId,
      gameState: state,
      message: 'Game started!',
      isTournamentMatch: true,
      tournamentId,
      matchId
    };
    sendToUser(p1Id, 'game:started', startedData);
    sendToUser(p2Id, 'game:started', startedData);

    try {
      await broadcastTournamentUpdate(tournamentId, 'match_started', {
        matchId,
        round,
        player1Alias: p1Alias,
        player2Alias: p2Alias
      });
    } catch (e) {
      console.error('[TOURNAMENT] Failed to broadcast match_started:', e);
    }

  } catch (error) {
    console.error('[TOURNAMENT] Error in startTournamentMatch:', error);
  }
}

/* Gestionnaire principal WebSocket pour toutes les connexions et messages des clients */
function wsHandler(instance: FastifyInstance) {
  return async (connection: any, req: FastifyRequest) => {
    const socket = connection.socket;
    let currentUser: WSUser | null = null;

    const leaveCurrentGame = async (
      reason: 'manual_leave' | 'accepted_other_game' | 'auto_cleanup',
      notifySelf: boolean = false
    ): Promise<boolean> => {
      if (!currentUser || !currentUser.currentGameId) {
        return false;
      }

      const gameId = currentUser.currentGameId;
      console.log('[SERVER] 🔚 Leaving current game', { userId: currentUser.userId, gameId, reason });

      try {
        const gameState = gameEngine.getGameState(gameId);

        if (gameState) {
          gameEngine.updatePlayerConnection(gameId, currentUser.userId, false);

          const otherPlayerId =
            gameState.players.player1?.id === currentUser.userId
              ? gameState.players.player2?.id
              : gameState.players.player1?.id;

          if (otherPlayerId) {
            sendToUser(otherPlayerId, 'game:player_disconnected', {
              disconnectedPlayerId: currentUser.userId,
              gameId,
              reason
            });
          }
        }

        if (notifySelf) {
          send(socket, 'game:left', {
            message: 'Left game successfully',
            reason
          });
        }
      } catch (error) {
        console.error('[SERVER] Error while leaving current game:', error);
      } finally {
        currentUser.currentGameId = null;
      }

      return true;
    };

    const autoLeaveFinishedGameIfNeeded = async (reason: 'accepted_other_game' | 'auto_cleanup') => {
      if (!currentUser || !currentUser.currentGameId) {
        return;
      }

      try {
        const gameState = gameEngine.getGameState(currentUser.currentGameId);
        const finishedOrMissing = !gameState || gameState.gameStatus === 'finished';

        if (finishedOrMissing) {
          console.log('[SERVER] 🔁 Auto-clearing finished game before new action', {
            userId: currentUser.userId,
            gameId: currentUser.currentGameId,
            reason
          });
          await leaveCurrentGame(reason, false);
        }
      } catch (error) {
        console.error('[SERVER] Failed to auto-leave finished game:', error);
      }
    };

    console.log('[WS] New WebSocket connection attempt');

    try {
      const url = new URL((req as any).url || '/', 'http://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        console.warn('[WS] Missing token in WebSocket handshake');
        sendErr(socket, 'auth:error', 'Missing token');
        socket.close(4401, 'Missing token');
        return;
      }

      /* Vérifier la limite d'utilisateurs connectés */
      const currentConnectedCount = getConnectedUsersCount();
      if (currentConnectedCount >= LIMITS.USER.MAX_CONCURRENT_USERS) {
        console.warn(`[WS] Server full: ${currentConnectedCount}/${LIMITS.USER.MAX_CONCURRENT_USERS} users connected`);
        sendErr(socket, 'auth:error', 'Server is full. Please try again later.');
        socket.close(4503, 'Server full');
        return;
      }
      
      // Vérifier si c'est un guest token
      if (token.startsWith('guest_')) {
        console.log('[WS] Guest token detected, validating...');
        
        try {
          const isValid = await guestTokenService.validateGuestToken(token);
          
          if (!isValid) {
            console.warn('[WS] Invalid or expired guest token');
            sendErr(socket, 'auth:error', 'Invalid or expired guest token');
            socket.close(4401, 'Invalid guest token');
            return;
          }
          
          const session = await guestTokenService.getGuestSession(token);
          
          if (!session) {
            console.warn('[WS] Guest session not found');
            sendErr(socket, 'auth:error', 'Guest session not found');
            socket.close(4401, 'Guest session not found');
            return;
          }
          
          const guestId = session.user_id;
          
          if (!guestId) {
            console.error('[WS] Guest session missing user_id');
            sendErr(socket, 'auth:error', 'Invalid guest session');
            socket.close(4401, 'Invalid guest session');
            return;
          }
          
          const guestUsername = session.player_alias || 'Guest';
          
          currentUser = { 
            socket, 
            userId: guestId,
            username: guestUsername, 
            tournamentId: session.tournament_id,
            guestToken: token,
            isGuest: true,
            currentGameId: null
          };
          
          const first = addConn(currentUser);
          
          send(socket, 'user:authenticated', { 
            userId: guestId, 
            username: guestUsername,
            isGuest: true,
            tournamentId: session.tournament_id
          });
          send(socket, 'presence:list', { users: listOnlineUsers() });
          
          if (first) {
            sendAll('presence:update', { 
              user: { 
                id: guestId, 
                username: guestUsername, 
                is_online: true,
                isGuest: true
              } 
            });
          }
          
          instance.log.info(`Guest ${guestUsername} (${token.substring(0, 20)}...) connected via WebSocket`);
        } catch (error) {
          console.error('[WS] Error validating guest token:', error);
          sendErr(socket, 'auth:error', 'Failed to validate guest token');
          socket.close(4401, 'Authentication failed');
          return;
        }
      } else {

        const payload = (instance as any).jwt.verify(token) as { id: number; username: string; twofa_stage?: string };
        
        if (payload?.twofa_stage === 'pending') {
          console.warn('[WS] 2FA required for WebSocket connection');
          sendErr(socket, 'auth:error', '2FA required');
          socket.close(4401, '2FA required');
          return;
        }
        
        if (!payload.id || !payload.username) {
          console.error('[WS] Invalid user data in JWT:', payload);
          sendErr(socket, 'auth:error', 'Invalid user data');
          socket.close(4401, 'Invalid user data');
          return;
        }
        
        if (hasActiveSession(payload.id)) {
          console.warn('[WS] Rejecting WebSocket connection: user already connected', { userId: payload.id });
          send(socket, 'auth_error', { error: 'User already connected elsewhere', code: 'ALREADY_CONNECTED' });
          socket.close(4409, 'Already connected');
          return;
        }

        await dbService.updateLastLogin(payload.id);
        currentUser = { 
          socket, 
          userId: payload.id, 
          username: payload.username, 
          tournamentId: null,
          isGuest: false,
          currentGameId: null
        };
        const first = addConn(currentUser);
        
        send(socket, 'user:authenticated', { userId: payload.id, username: payload.username, isGuest: false });
        send(socket, 'presence:list', { users: listOnlineUsers() });
        
        if (first) {
          sendAll('presence:update', { user: { id: payload.id, username: payload.username, is_online: true } });
          await notifyFriendsOnlineStatus(payload.id, true);

          try {
            const notifications = await dbService.getUserNotifications(payload.id, 10, true);
            const unreadCount = await dbService.getUnreadNotificationCount(payload.id);
            send(socket, 'notifications:update', { notifications, unreadCount });
          } catch (e: any) { instance.log.error({ error: e.message }, 'Failed to load notifications on connect:'); }
        }
        
        instance.log.info(`User ${payload.username} (${payload.id}) connected via WebSocket`);
      }
      
    } catch (e: any) {
      instance.log.warn({ error: e.message }, '[WS] handshake auth failed');
      sendErr(socket, 'auth:error', 'Invalid token');
      socket.close(4401, 'Invalid token');
      return;
    }

    send(socket, 'connection', { message: 'Connected to ft_transcendence server' });

    socket.on('message', async (message: Buffer) => {
      try {
        let data: WSMessage;
        try { data = JSON.parse(message.toString()) } catch { sendErr(socket, 'error', 'Invalid message JSON'); return }
        
        if (!data || typeof data !== 'object' || !data.type) {
          sendErr(socket, 'error', 'Invalid message format');
          return;
        }
        
        switch (data.type) {
          case 'user:online': break;

          case 'game:challenge': {
            if (!currentUser) {
              sendErr(socket, 'game:error', 'Not authenticated');
              break;
            }

            const challengeData: GameChallengeRequest = data.data || {};
            const { challengedUserId, tournamentId, matchId } = challengeData;

            console.log('[SERVER] 🏆 game:challenge received:', {
              challenger: currentUser.userId,
              challengerIsGuest: currentUser.isGuest,
              challenged: challengedUserId,
              tournamentId,
              matchId,
              hasTournamentContext: !!(tournamentId !== undefined && matchId !== undefined)
            });

            if (!challengedUserId) {
              sendErr(socket, 'game:error', 'Missing challengedUserId');
              break;
            }

            try {
              await autoLeaveFinishedGameIfNeeded('accepted_other_game');
              const isTournamentMatch = !!(tournamentId !== undefined && matchId !== undefined);

              if (isTournamentMatch) {
                const challengerActiveGame = findActiveGameForUser(currentUser.userId);
                if (challengerActiveGame) {
                  console.warn('[SERVER] ❌ Challenge blocked - challenger already in game (tournament)', {
                    challengerId: currentUser.userId,
                    gameId: challengerActiveGame.gameId
                  });
                  sendErr(socket, 'game:error', 'You are already in an active game');
                  break;
                }

                const challengedActiveGame = findActiveGameForUser(challengedUserId);
                if (challengedActiveGame) {
                  console.warn('[SERVER] ❌ Challenge blocked - challenged user already in game (tournament):', {
                    challengedUserId,
                    gameId: challengedActiveGame.gameId
                  });
                  sendErr(socket, 'game:error', 'This user is already playing another game');
                  break;
                }
              } else {
                const validation = await ensureFriendlyChallengePossible(currentUser.userId, challengedUserId);
                if (!validation.ok) {
                  const failure = isFriendlyChallengeValidationError(validation) ? validation : null;
                  console.warn('[SERVER] ❌ Challenge blocked - friendly guard failed', {
                    challengerId: currentUser.userId,
                    challengedUserId,
                    reason: failure?.reason
                  });
                  sendErr(socket, 'game:error', failure?.error || 'Challenge is not allowed at the moment');
                  break;
                }
              }

              // Chercher le challenged user (qui peut être un guest avec ID négatif)
              const challengedConnection = getOneConn(challengedUserId);
              
              if (!challengedConnection) {
                console.warn('[SERVER] ⚠️ Challenged user not connected:', challengedUserId);
                send(socket, 'game:challenge_sent', {
                  challengedId: challengedUserId,
                  challengedName: 'Unknown',
                  tournamentId,
                  matchId,
                  isTournamentMatch,
                  offline: true
                });
                break;
              }

              // Envoyer le challenge
              sendToUser(challengedUserId, 'game:challenge_received', {
                challengerId: currentUser.userId,
                challengerName: currentUser.username,
                challengerIsGuest: currentUser.isGuest,
                tournamentId,
                matchId,
                isTournamentMatch
              });

              send(socket, 'game:challenge_sent', {
                challengedId: challengedUserId,
                challengedName: challengedConnection.username,
                tournamentId,
                matchId,
                isTournamentMatch
              });

              if (!isTournamentMatch) {
                setPendingFriendlyChallenge(currentUser.userId, challengedUserId);
              }

              console.log('[SERVER] ✅ Challenge sent successfully:', {
                challenger: currentUser.username,
                challengerIsGuest: currentUser.isGuest,
                challenged: challengedConnection.username,
                challengedIsGuest: challengedConnection.isGuest,
                isTournamentMatch,
                tournamentId,
                matchId
              });

            } catch (error) {
              console.error('[SERVER] Error handling game challenge:', error);
              sendErr(socket, 'game:error', 'Failed to create game challenge');
            }
            break;
          }
          
          // NOUVEAU HANDLER: game:challenge_cancel
          case 'game:challenge_cancel': {
            if (!currentUser) {
              sendErr(socket, 'game:error', 'Not authenticated');
              break;
            }

            const cancelData: GameChallengeCancelRequest = data.data || {};
            const { challengedUserId } = cancelData;

            console.log('[SERVER] ❌ game:challenge_cancel received:', {
              challenger: currentUser.userId,
              challengerName: currentUser.username,
              challenged: challengedUserId
            });

            if (!challengedUserId) {
              sendErr(socket, 'game:error', 'Missing challengedUserId');
              break;
            }

            try {
              const pendingTarget = pendingFriendlyChallenges.get(currentUser.userId);
              if (pendingTarget !== challengedUserId) {
                console.warn('[SERVER] ❌ Challenge cancel rejected - no pending challenge for target', {
                  challengerId: currentUser.userId,
                  challengedUserId,
                  pendingTarget
                });
                sendErr(socket, 'game:error', 'No pending challenge found for this user');
                break;
              }

              sendToUser(challengedUserId, 'game:challenge_cancelled', {
                challengerId: currentUser.userId,
                challengerName: currentUser.username,
                reason: 'timeout'
              });

              console.log('[SERVER] ✅ Challenge cancellation sent to:', challengedUserId);

              clearPendingFriendlyChallenge(currentUser.userId, challengedUserId);
            } catch (error) {
              console.error('[SERVER] Error handling challenge cancel:', error);
            }
            break;
          }

          case 'game:challenge_declined': {
            if (!currentUser) {
              sendErr(socket, 'game:error', 'Not authenticated');
              break;
            }

            const declineData = data.data || {};
            const { challengerId } = declineData;

            if (!challengerId) {
              sendErr(socket, 'game:error', 'Missing challengerId');
              break;
            }

            const pendingChallenger = pendingFriendlyTargets.get(currentUser.userId);
            if (pendingChallenger !== challengerId) {
              console.warn('[SERVER] ❌ Challenge decline rejected - no pending challenge from challenger', {
                challengerId,
                declinerId: currentUser.userId,
                pendingChallenger
              });
              sendErr(socket, 'game:error', 'No pending challenge from this user');
              break;
            }

            console.log('[SERVER] ❌ game:challenge_declined received:', {
              challengerId,
              declinerId: currentUser.userId
            });

            clearPendingFriendlyChallenge(challengerId, currentUser.userId);
            sendToUser(challengerId, 'game:challenge_declined', {
              declinerId: currentUser.userId
            });
            break;
          }

          case 'game:create': {
            if (!currentUser) {
              sendErr(socket, 'game:error', 'Not authenticated');
              break;
            }

            const createData: GameCreateRequest = data.data || {};
            const { opponentId, gameMode = 'classic', tournamentId, matchId } = createData;

            const isTournamentMatch = !!(tournamentId !== undefined && matchId !== undefined);

            console.log('[SERVER] 🏆 game:create received:', {
              creator: currentUser.userId,
              opponent: opponentId,
              gameMode,
              isTournamentMatch,
              tournamentId,
              matchId
            });

            if (!opponentId) {
              sendErr(socket, 'game:error', 'Missing opponentId');
              break;
            }

            try {
              await autoLeaveFinishedGameIfNeeded('accepted_other_game');
              const creatorActiveGame = findActiveGameForUser(currentUser.userId);
              if (creatorActiveGame) {
                console.warn('[SERVER] ❌ Cannot create game - creator already in game:', {
                  creatorId: currentUser.userId,
                  gameId: creatorActiveGame.gameId
                });
                sendErr(socket, 'game:error', 'You are already participating in another game');
                break;
              }

              const opponentActiveGame = findActiveGameForUser(opponentId);
              if (opponentActiveGame) {
                console.warn('[SERVER] ❌ Cannot create game - opponent already in game:', {
                  opponentId,
                  gameId: opponentActiveGame.gameId
                });
                sendErr(socket, 'game:error', 'Opponent is already participating in another game');
                break;
              }

              if (!isTournamentMatch) {
                const previousTarget = pendingFriendlyChallenges.get(currentUser.userId);
                if (previousTarget && previousTarget !== opponentId) {
                  console.log('[SERVER] ❌ Cancelling previous pending challenge for creator before starting new match', {
                    creatorId: currentUser.userId,
                    previousTarget
                  });
                  cancelPendingFriendlyChallenge(currentUser.userId, 'superseded');
                }

                const pendingTarget = pendingFriendlyChallenges.get(opponentId);
                if (pendingTarget !== currentUser.userId) {
                  console.warn('[SERVER] ❌ Cannot create game - no pending friendly challenge found for this opponent', {
                    opponentId,
                    currentUser: currentUser.userId,
                    pendingTarget
                  });
                  sendErr(socket, 'game:error', 'This challenge is no longer available');
                  break;
                }

                const [creatorInTournament, opponentInTournament] = await Promise.all([
                  dbService.isUserInActiveTournament(currentUser.userId),
                  dbService.isUserInActiveTournament(opponentId)
                ]);

                if (creatorInTournament) {
                  console.warn('[SERVER] ❌ Cannot create game - creator in active tournament:', {
                    creatorId: currentUser.userId
                  });
                  sendErr(socket, 'game:error', 'You cannot start a friendly match while registered in a tournament');
                  break;
                }

                if (opponentInTournament) {
                  console.warn('[SERVER] ❌ Cannot create game - opponent in active tournament:', {
                    opponentId
                  });
                  sendErr(socket, 'game:error', 'Opponent is currently participating in a tournament');
                  break;
                }
              }

              let opponentUser: any = null;
              let opponentAvatar = '';
              let opponentUsername = 'Opponent';
              let opponentConnected = false;

              if (isTournamentMatch) {
                const matchRow = await dbService.dbGet(
                  `SELECT id, status FROM tournament_matches_aliases WHERE id = ? AND tournament_id = ?`,
                  [matchId, tournamentId]
                );
                if (!matchRow) {
                  sendErr(socket, 'game:error', 'Tournament match not found');
                  break;
                }
                if (matchRow.status !== 'active') {
                  sendErr(socket, 'game:error', `Match is ${matchRow.status}, cannot start`);
                  break;
                }
              }
              
              if (opponentId < 0) {
                const opponentConn = getOneConn(opponentId);
                if (!opponentConn) {
                  sendErr(socket, 'game:error', 'Guest opponent not connected');
                  break;
                }
                opponentUsername = opponentConn.username;
                opponentAvatar = '';
                console.log('[SERVER] 🏆 Guest opponent found:', opponentUsername);
                opponentConnected = true;
              } else {
                opponentUser = await dbService.getUserById(opponentId);
                if (!opponentUser) {
                  sendErr(socket, 'game:error', 'Opponent not found');
                  break;
                }
                opponentUsername = opponentUser.username;
                opponentAvatar = opponentUser.avatar_url || '';

                opponentConnected = !!getOneConn(opponentId);
                if (isTournamentMatch && !opponentConnected) {
                  sendErr(socket, 'game:error', 'Opponent is not connected');
                  break;
                }
              }

              let creatorAvatar = '';
              let creatorUsername = currentUser.username;
              
              if (currentUser.userId < 0) {
                creatorAvatar = '';
                creatorUsername = currentUser.username;
              } else {
                const creatorData = await dbService.getUserById(currentUser.userId);
                creatorAvatar = creatorData?.avatar_url || '';
                creatorUsername = creatorData?.username || currentUser.username;
              }

              let gameId: string;
              if (isTournamentMatch) {
                gameId = `tournament_${tournamentId}_${matchId}`;
                console.log('[SERVER] 🏆 Generated tournament gameId:', gameId);
              } else {
                gameId = gameEngine.createGame(
                  currentUser.userId,
                  creatorUsername,
                  creatorAvatar,
                  opponentId,
                  opponentUsername,
                  opponentAvatar
                );
                console.log('[SERVER] ✅ Generated standard gameId:', gameId);
              }

              if (isTournamentMatch) {
                gameEngine.createGameWithId(
                  gameId,
                  currentUser.userId,
                  creatorUsername,
                  creatorAvatar,
                  opponentId,
                  opponentUsername,
                  opponentAvatar
                );
              }
              
              console.log('[SERVER] ✅ Game created in engine:', gameId);

              gameEngine.updatePlayerConnection(gameId, currentUser.userId, true);
              // Ne pas marquer l'adversaire comme connecté s'il ne l'est pas réellement
              gameEngine.updatePlayerConnection(gameId, opponentId, opponentConnected);
              
              console.log('[SERVER] ✅ Players marked as connected');

              const started = gameEngine.startGame(gameId);
              console.log('[SERVER] ✅ Game started:', started);

              const gameState = gameEngine.getGameState(gameId);
              
              if (!gameState) {
                sendErr(socket, 'game:error', 'Failed to get game state');
                break;
              }

              currentUser.currentGameId = gameId;

              const startedData = {
                gameId,
                gameState,
                message: 'Game started!',
                isTournamentMatch,
                tournamentId: isTournamentMatch ? tournamentId : undefined,
                matchId: isTournamentMatch ? matchId : undefined
              };
              
              send(socket, 'game:started', startedData);
              sendToUser(opponentId, 'game:started', startedData);

              if (!isTournamentMatch) {
                clearPendingFriendlyChallenge(opponentId, currentUser.userId);
              }

              console.log('[SERVER] ✅ Game started and sent to both players:', {
                gameId,
                creator: creatorUsername,
                opponent: opponentUsername,
                isTournamentMatch,
                tournamentId,
                matchId
              });

            } catch (error) {
              console.error('[SERVER] Error creating game:', error);
              sendErr(socket, 'game:error', 'Failed to create game');
            }
            break;
          }

          case 'game:join': {
            if (!currentUser) {
              sendErr(socket, 'game:error', 'Not authenticated');
              break;
            }

            const joinData: GameJoinRequest = data.data || {};
            const { gameId } = joinData;

            console.log('[SERVER] game:join received:', {
              userId: currentUser.userId,
              gameId
            });

            if (!gameId) {
              sendErr(socket, 'game:error', 'Missing gameId');
              break;
            }

            try {
              await autoLeaveFinishedGameIfNeeded('accepted_other_game');
              const gameState = gameEngine.getGameState(gameId);
              
              if (!gameState) {
                sendErr(socket, 'game:error', 'Game not found');
                break;
              }

              gameEngine.updatePlayerConnection(gameId, currentUser.userId, true);
              currentUser.currentGameId = gameId;

              const tournamentMatch = await getTournamentMatchByGameId(gameId);

              send(socket, 'game:joined', {
                gameId,
                gameState,
                message: 'Joined game successfully',
                isTournamentMatch: !!tournamentMatch,
                tournamentId: tournamentMatch?.tournamentId,
                matchId: tournamentMatch?.matchId
              });

              console.log('[SERVER] Player joined game:', {
                gameId,
                userId: currentUser.userId,
                username: currentUser.username,
                isTournamentMatch: !!tournamentMatch
              });

            } catch (error) {
              console.error('[SERVER] Error joining game:', error);
              sendErr(socket, 'game:error', 'Failed to join game');
            }
            break;
          }

          case 'game:start': {
            if (!currentUser) {
              sendErr(socket, 'game:error', 'Not authenticated');
              break;
            }

            const startData: GameStartRequest = data.data || {};
            const { gameId } = startData;

            console.log('[SERVER] game:start (rematch) received:', {
              userId: currentUser.userId,
              gameId
            });

            if (!gameId) {
              sendErr(socket, 'game:error', 'Missing gameId');
              break;
            }

            try {
              const gameState = gameEngine.getGameState(gameId);
              
              if (!gameState) {
                sendErr(socket, 'game:error', 'Game not found');
                break;
              }

              if (gameState.gameStatus !== 'finished') {
                sendErr(socket, 'game:error', 'Game is not finished');
                break;
              }

              const resetSuccess = gameEngine.resetFinishedGame(gameId);
              
              if (!resetSuccess) {
                sendErr(socket, 'game:error', 'Failed to reset game');
                break;
              }

              const p1Id = gameState.players.player1?.id;
              const p2Id = gameState.players.player2?.id;

              if (p1Id) gameEngine.updatePlayerConnection(gameId, p1Id, true);
              if (p2Id) gameEngine.updatePlayerConnection(gameId, p2Id, true);

              const started = gameEngine.startGame(gameId);
              console.log('[SERVER] Game restarted:', started);

              const newGameState = gameEngine.getGameState(gameId);
              
              if (!newGameState) {
                sendErr(socket, 'game:error', 'Failed to get new game state');
                break;
              }

              const tournamentMatch = await getTournamentMatchByGameId(gameId);

              const startedData = {
                gameId,
                gameState: newGameState,
                message: 'Game restarted!',
                isTournamentMatch: !!tournamentMatch,
                tournamentId: tournamentMatch?.tournamentId,
                matchId: tournamentMatch?.matchId
              };

              if (p1Id) sendToUser(p1Id, 'game:started', startedData);
              if (p2Id) sendToUser(p2Id, 'game:started', startedData);

              console.log('[SERVER] Rematch started for both players:', {
                gameId,
                player1: p1Id,
                player2: p2Id
              });

            } catch (error) {
              console.error('[SERVER] Error starting rematch:', error);
              sendErr(socket, 'game:error', 'Failed to start rematch');
            }
            break;
          }

          case 'game:input': {
            if (!currentUser || !currentUser.currentGameId) {
              break;
            }

            const inputData: GameInputRequest = data.data || {};
            const { gameId, action } = inputData;

            if (!gameId || !action) {
              break;
            }

            try {
              const input: PlayerInput = {
                userId: currentUser.userId,
                action,
                timestamp: Date.now()
              };

              gameEngine.processPlayerInput(gameId, input);

            } catch (error) {
              console.error('[SERVER] Error processing game input:', error);
            }
            break;
          }

          case 'guest:update_alias': {
            if (!currentUser || !currentUser.isGuest) {
              sendErr(socket, 'error', 'Not a guest user');
              break;
            }

            const newAlias = (data.data || {}).alias;
            if (!newAlias || typeof newAlias !== 'string') {
              sendErr(socket, 'error', 'Invalid alias');
              break;
            }

            console.log('[SERVER] 🔄 Guest updating alias:', {
              guestId: currentUser.userId,
              oldAlias: currentUser.username,
              newAlias: newAlias
            });


            currentUser.username = newAlias;


            if (currentUser.guestToken) {
              try {
                await guestTokenService.updateGuestAlias(currentUser.guestToken, newAlias);
                console.log('[SERVER] ✅ Guest alias updated in DB');
              } catch (error) {
                console.error('[SERVER] Failed to update guest alias in DB:', error);
              }
            }

            send(socket, 'guest:alias_updated', { alias: newAlias });
            break;
          }

          case 'game:leave': {
            if (!currentUser || !currentUser.currentGameId) {
              break;
            }

            console.log('[SERVER] game:leave received:', {
              userId: currentUser.userId,
              gameId: currentUser.currentGameId
            });

            const gameIdToCancel = currentUser.currentGameId;
            await leaveCurrentGame('manual_leave', true);
            try {
              if (gameIdToCancel) {
                console.log('[SERVER] game:leave -> cancelling server game state', { gameId: gameIdToCancel });
                gameEngine.cancelGame(gameIdToCancel);
              }
            } catch (error) {
              console.error('[SERVER] Failed to cancel game on leave:', error);
            }
            break;
          }

          case 'chat:global_message': {
            if (!currentUser) break;

            if (currentUser.isGuest) {
              break;
            }
            const { content, messageType = 'text', metadata }: ChatGlobalMessage = data.data || {};

            if (!content || content.trim().length === 0) {
              sendErr(socket, 'chat:error', 'Message content cannot be empty');
              break;
            }
            if (content.length > MAX_CHAT_CHARS) {
              sendErr(socket, 'chat:error', `Global chat message too long (max ${MAX_CHAT_CHARS} characters)`);
              break;
            }


            if (messageType === 'tournament_invite' && currentUser.isGuest) {
              sendErr(socket, 'chat:error', 'Guests cannot send tournament invitations');
              console.log('[SERVER] Blocked tournament invitation from guest:', {
                username: currentUser.username,
                userId: currentUser.userId
              });
              break;
            }

            try {

              if (messageType !== 'tournament_invite') {
                const lastMessage = await dbService.getLastUserMessage(currentUser.userId, 1);
                if (lastMessage && (Date.now() - new Date(lastMessage.created_at).getTime()) < 1000) {
                  sendErr(socket, 'chat:error', 'Please wait before sending another message');
                  break;
                }
              }

              const onlineUsers = await dbService.getOnlineUsers();
              let sentWhileBlocked = false;

              for (const user of onlineUsers) {
                if (user.id !== currentUser.userId) {
                  const isBlocked = await dbService.isUserBlocked(user.id, currentUser.userId);
                  if (isBlocked) {
                    sentWhileBlocked = true;
                    break;
                  }
                }
              }

              const messageId = await dbService.sendMessage(
                1,
                currentUser.userId,
                content.trim(),
                messageType,
                metadata,
                sentWhileBlocked
              );

              const sender = await dbService.getUserById(currentUser.userId);

              const messageData: any = {
                id: messageId,
                conversation_id: 1,
                sender_id: currentUser.userId,
                sender_username: sender?.username || currentUser.username,
                content: content.trim(),
                message_type: messageType,
                created_at: new Date().toISOString(),
                conversationType: 'global'
              };


              if (metadata) {
                messageData.metadata = metadata;

                if (messageType === 'tournament_invite') {
                  try {
                    const parsedMetadata = JSON.parse(metadata);
                    messageData.tournament_id = parsedMetadata.tournament_id;
                  } catch (e) {
                    console.error('[SERVER] Failed to parse tournament metadata:', e);
                  }
                }
              }


              const eventType = messageType === 'tournament_invite' ? 'chat:tournament_invitation' : 'chat:global_message';


              for (const user of onlineUsers) {
                // Pour les invitations au tournoi, envoyer aussi au créateur
                const shouldSendToCreator = messageType === 'tournament_invite';
                if (user.id !== currentUser.userId || shouldSendToCreator) {
                  const isBlocked = await dbService.isUserBlocked(user.id, currentUser.userId);
                  if (!isBlocked) {
                    sendToUser(user.id, eventType, messageData);
                  }
                }
              }


              send(socket, eventType, messageData);

              console.log(`[SERVER] ${messageType === 'tournament_invite' ? 'Tournament invitation' : 'Global message'} sent:`, {
                from: currentUser.username,
                content: content.substring(0, 50),
                messageType,
                sentWhileBlocked
              });
            } catch (error: any) {
              instance.log.error({ error: error.message }, 'Error sending global message:');
              sendErr(socket, 'chat:error', 'Failed to send global message');
            }
            break;
          }

          case 'chat:private_message': {
            if (!currentUser) {
              sendErr(socket, 'chat:error', 'Not authenticated');
              break;
            }

            const { recipientId, content, messageType = 'text', metadata }: ChatPrivateMessage = data.data || {};

            console.log('[SERVER] chat:private_message received:', {
              from: currentUser.userId,
              to: recipientId,
              contentLength: content?.length
            });

            if (!recipientId) {
              sendErr(socket, 'chat:error', 'Recipient ID is required');
              break;
            }

            if (!content || content.trim().length === 0) {
              sendErr(socket, 'chat:error', 'Message content cannot be empty');
              break;
            }

            if (content.length > MAX_CHAT_CHARS) {
              sendErr(socket, 'chat:error', `Message too long (max ${MAX_CHAT_CHARS} characters)`);
              break;
            }

            try {
              const recipient = await dbService.getUserById(recipientId);
              if (!recipient) {
                sendErr(socket, 'chat:error', 'Recipient not found');
                break;
              }

              const isBlocked = await dbService.isUserBlocked(recipientId, currentUser.userId);
              
              const conversationId = await dbService.getOrCreatePrivateConversation(
                currentUser.userId, 
                recipientId
              );

              const lastMessage = await dbService.getLastUserMessage(currentUser.userId, conversationId);
              if (lastMessage && (Date.now() - new Date(lastMessage.created_at).getTime()) < 1000) {
                sendErr(socket, 'chat:error', 'Please wait before sending another message');
                break;
              }

              const messageId = await dbService.sendMessage(
                conversationId, 
                currentUser.userId, 
                content.trim(), 
                messageType, 
                metadata,
                isBlocked
              );

              const sender = await dbService.getUserById(currentUser.userId);
              
              const messageData = {
                id: messageId,
                conversation_id: conversationId,
                sender_id: currentUser.userId,
                sender_username: sender?.username || currentUser.username,
                recipient_id: recipientId,
                content: content.trim(),
                message_type: messageType,
                ...(metadata ? { metadata } : {}),
                created_at: new Date().toISOString(),
                conversationType: 'private'
              };

              send(socket, 'chat:private_message', messageData);
              
              if (!isBlocked) {
                sendToUser(recipientId, 'chat:private_message', messageData);
                
                await dbService.createNotification(
                  recipientId,
                  'message',
                  'New message',
                  `${sender?.username} sent you a message`,
                  JSON.stringify({ senderId: currentUser.userId, conversationId, messageId })
                );
                
                await sendUnreadUpdate(recipientId);
              }

              console.log('[SERVER] Private message sent:', {
                from: currentUser.username,
                to: recipient.username,
                messageId,
                conversationId,
                sentWhileBlocked: isBlocked
              });

            } catch (error) {
              console.error('[SERVER] Error sending private message:', error);
              sendErr(socket, 'chat:error', 'Failed to send private message');
            }
            break;
          }

          case 'presence:list': {
            if (!currentUser) { 
              sendErr(socket, 'auth:error', 'Not authenticated'); 
              break; 
            }
            send(socket, 'presence:list', { users: listOnlineUsers() });
            break;
          }
          
          default: {
            if (message.toString().includes('ping')) { 
              send(socket, 'pong'); 
            } 
          }
        }
      } catch (err: any) {
        instance.log.error({ error: err.message }, 'WebSocket message error:');
        sendErr(socket, 'error', 'Invalid message format')
      }
    });

    socket.on('close', async (code: any, reason: any) => {
      try { 
        (instance as any).log.warn('[WS] [FORFAIT] CLOSE', { 
          uid: currentUser?.userId, 
          code, 
          reason: reason?.toString?.(),
          hadGameId: !!currentUser?.currentGameId,
          tournamentId: currentUser?.tournamentId
        }) 
      } catch { }
      
      if (!currentUser) return;

      clearPendingFriendlyChallenge(currentUser.userId);
      clearPendingFriendlyChallenge(undefined, currentUser.userId);

      if (currentUser.currentGameId) {
        const tournamentMatch = await getTournamentMatchByGameId(currentUser.currentGameId);
        if (tournamentMatch) {
          console.log('[FORFAIT] Player disconnected during tournament match');
          await handleTournamentForfeit(currentUser.userId, null, 'disconnected');
        }
        
        try {
          const st = gameEngine.getGameState(currentUser.currentGameId);
          if (st) {
            const otherId = st.players.player1?.id === currentUser.userId 
              ? st.players.player2?.id 
              : st.players.player1?.id;
            
            sendToUser(otherId, 'game:player_disconnected', { 
              disconnectedPlayerId: currentUser.userId, 
              gameId: currentUser.currentGameId 
            });

          }
        } catch { }
      } else {
        
        try {
          const pendingMatch = await dbService.dbGet(
            `SELECT 
               m.id                AS match_id,
               m.tournament_id     AS tournament_id,
               m.round             AS round,
               m.player1_alias     AS player1_alias,
               m.player2_alias     AS player2_alias,
               m.p1_ready          AS p1_ready,
               m.p2_ready          AS p2_ready,
               m.ready_deadline    AS ready_deadline,
               ta.player_alias     AS user_alias
             FROM tournament_matches_aliases m
             JOIN tournaments t 
               ON t.id = m.tournament_id 
              AND t.status = 'active'
             JOIN tournament_aliases ta 
               ON ta.tournament_id = m.tournament_id
              AND (ta.player_alias = m.player1_alias OR ta.player_alias = m.player2_alias)
            WHERE ta.user_id = ?
              AND m.status = 'pending'
              AND m.ready_deadline IS NOT NULL
              AND m.ready_deadline > datetime('now')
            ORDER BY m.round DESC, m.id DESC
            LIMIT 1`,
            [currentUser.userId]
          );

          if (pendingMatch && pendingMatch.match_id) {
           
            (instance as any).log.warn('[FORFAIT][COUNTDOWN] Disconnect during pending match → declaring forfeit now', {
              userId: currentUser.userId,
              matchId: pendingMatch.match_id,
              tournamentId: pendingMatch.tournament_id
            });
            try {
              await handleTournamentForfeit(currentUser.userId, null, 'disconnected');
            } catch (err) {
              (instance as any).log.error('[FORFAIT][COUNTDOWN] Failed to trigger forfeit', err);
            }
          }

      
          if (!pendingMatch) {
            const activeMatch = await dbService.dbGet(
              `SELECT m.id AS match_id, m.tournament_id AS tournament_id
               FROM tournament_matches_aliases m
               JOIN tournaments t ON t.id = m.tournament_id AND t.status = 'active'
               JOIN tournament_aliases ta 
                 ON ta.tournament_id = m.tournament_id
                AND (ta.player_alias = m.player1_alias OR ta.player_alias = m.player2_alias)
              WHERE ta.user_id = ?
                AND m.status = 'active'
              ORDER BY m.id DESC
              LIMIT 1`,
              [currentUser.userId]
            );

            if (activeMatch && activeMatch.match_id) {
              (instance as any).log.warn('[FORFAIT][ACTIVE] Disconnect during active pre-game window, triggering forfeit', {
                userId: currentUser.userId,
                matchId: activeMatch.match_id,
                tournamentId: activeMatch.tournament_id
              });
              try {
                await handleTournamentForfeit(currentUser.userId, null, 'disconnected');
              } catch (err) {
                (instance as any).log.error('[FORFAIT][ACTIVE] Failed to trigger forfeit', err);
              }
            }
          }
        } catch (e) {
          (instance as any).log.error('[FORFAIT][COUNTDOWN] Failed to process disconnect during pending match', e);
        }
      }
      
      const last = removeConn(currentUser);
      if (last) {
        sendAll('presence:update', { user: { id: currentUser.userId, username: currentUser.username, is_online: false } });
        try { await dbService.setUserOffline(currentUser.userId) } catch { };
        await notifyFriendsOnlineStatus(currentUser.userId, false)
      }
      
      (instance as any).log.info(`User ${currentUser.username} disconnected`);
    });

    socket.on('error', (err) => { (instance as any).log.error('WebSocket error:', err) });
  };
}

app.register(async function (instance: FastifyInstance) {
  instance.get('/ws', { websocket: true }, wsHandler(instance));

  function broadcastGameState(gameId: string) {
    try {
      const gs = gameEngine.getGameState(gameId);
      if (!gs) return;
      const update = { gameId, ball: gs.ball, paddle1: gs.paddle1, paddle2: gs.paddle2, gameStatus: gs.gameStatus, players: gs.players, timestamp: Date.now() };
      if (gs.players.player1?.id) sendToUser(gs.players.player1.id, 'game:state_update', update);
      if (gs.players.player2?.id) sendToUser(gs.players.player2.id, 'game:state_update', update);
    } catch (e) { (instance as any).log.error('[GAME] broadcastGameState failed', e) }
  }

  setInterval(() => {
    try {
      gameEngine.getActiveGames().forEach(id => {
        const st = gameEngine.getGameState(id);
        if (st && st.gameStatus !== 'finished') broadcastGameState(id)
      })
    } catch (e) { (instance as any).log.error('[GAME] active loop failed', e) }
  }, 1000 / 60);

  setInterval(async () => {
    try {
      for (const { gameId, state, summary } of gameEngine.drainFinishedSummaries()) {
        broadcastGameState(gameId);
        
        const tournamentMatch = await getTournamentMatchByGameId(gameId);
        
        if (tournamentMatch) {
          console.log('[TOURNAMENT] ✅ Tournament match finished, auto-saving result:', {
            gameId,
            tournamentId: tournamentMatch.tournamentId,
            matchId: tournamentMatch.matchId,
            winner: summary.winner.username,
            score: `${summary.score1}-${summary.score2}`
          });

          await autoSaveTournamentMatchResult(
            tournamentMatch.tournamentId,
            tournamentMatch.matchId,
            summary,
            state
          );
          
        } else {
          try {
            const p1 = state.players.player1?.id;
            const p2 = state.players.player2?.id;
            if (typeof p1 === 'number' && typeof p2 === 'number') {
              await dbService.createGame(p1, p2, summary.score1, summary.score2, 'vs');
              console.log('[GAME] 1v1 match saved:', { gameId, p1, p2, score: `${summary.score1}-${summary.score2}` });
            } else { 
              (instance as any).log.warn(`VS not persisted (missing player ids) for game ${gameId}`); 
            }
          } catch (err) { 
            (instance as any).log.error('Failed to persist finished VS game:', err) 
          }
        }
        
        const data = {
          gameId, 
          gameState: { 
            gameId, 
            ball: state.ball, 
            paddle1: state.paddle1, 
            paddle2: state.paddle2, 
            gameStatus: 'finished', 
            players: state.players 
          },
          summary, 
          timestamp: Date.now()
        };
        
        sendToUser(state.players.player1?.id, 'game:finished', data);
        sendToUser(state.players.player2?.id, 'game:finished', data);
        if (state.players.player1?.id) clearCurrentGameForUser(state.players.player1.id, gameId);
        if (state.players.player2?.id) clearCurrentGameForUser(state.players.player2.id, gameId);
        
        (instance as any).log.info(`Broadcast game:finished ${gameId} -> ${summary.winner.username} (${summary.score1}-${summary.score2})`);
      }
    } catch (e) { 
      (instance as any).log.error('[GAME] drainFinishedSummaries loop failed', e) 
    }
  }, 100);

  setInterval(() => {
    try { gameEngine.cleanup(); } catch (e) { (instance as any).log.error('[GAME] cleanup failed', e) }
  }, 5 * 60 * 1000);
});

app.get('/health', async () => {
  try {
    const userCount = await dbService.getUserCount();
    const wsSockets = Array.from(connectedUsers.values()).reduce((acc, set) => acc + set.size, 0);
    
    return {
      status: 'healthy', 
      timestamp: ts(), 
      uptime: process.uptime(),
      services: { 
        database: 'connected', 
        users_count: userCount, 
        websocket_connections: wsSockets, 
        tournament_mode: 'REST_API + WEBSOCKET_SYNC',
        chat_mode: 'WEBSOCKET' 
      }
    };
  } catch (error) {
    const wsSockets = Array.from(connectedUsers.values()).reduce((acc, set) => acc + set.size, 0);
    console.error('[HEALTH] Database check failed:', error);
    return {
      status: 'degraded', 
      timestamp: ts(), 
      uptime: process.uptime(),
      services: { 
        database: 'error', 
        error: 'Database connection failed', 
        websocket_connections: wsSockets, 
        tournament_mode: 'REST_API + WEBSOCKET_SYNC',
        chat_mode: 'WEBSOCKET'
      }
    };
  }
});

app.setErrorHandler(async (error, request, reply) => {
  console.error('[ERROR] Global error handler:', error);
  
  if (error.statusCode === 401) return reply.code(401).send({ error: 'Unauthorized' });
  if (error.statusCode === 400) return reply.code(400).send({ error: error.message || 'Bad Request' });
  
  return reply.code(500).send({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

/* Initialise et démarre le serveur Fastify avec toutes ses routes et services */
const start = async () => {
  try {
    console.log('Initializing database...');
    await dbService.initialize();
    
    try {
      await dbService.dbRun('PRAGMA journal_mode = WAL');
      await dbService.dbRun('PRAGMA busy_timeout = 5000');
      await dbService.dbRun('PRAGMA synchronous = NORMAL');
      console.log('✅ SQLite optimizations applied (WAL mode)');
    } catch (e) {
      console.warn('⚠️ Could not apply SQLite optimizations:', e);
    }
    
    console.log('Database initialization complete');
    
    const PORT = process.env.PORT || 8080;
    await app.listen({ port: PORT as number, host: '0.0.0.0' });
    
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('[SERVER] 🏆 Tournament match system enabled with auto-save');
    console.log('[SERVER] 🔔 Tournament match notifications enabled (IMMEDIATE)');
    console.log('[SERVER] 📡 Tournament WebSocket sync enabled (REAL-TIME)');
    console.log('[SERVER] 💬 Tournament chat announcements OPTIMIZED');
    console.log('[SERVER] Challenge system enabled');
    console.log('[SERVER] Game creation with ServerGameEngine enabled');
    console.log('[SERVER] Rematch (game:start) enabled');
    console.log('[SERVER] Game join (game:join) enabled');
    console.log('[SERVER] Chat global via WebSocket enabled');
    console.log('[SERVER] Chat privé via WebSocket enabled');
    console.log('Server startup complete');
  } catch (err: any) {
    app.log.error({ error: err.message }, 'Failed to start server:');
    process.exit(1)
  }
};

/* Ferme proprement le serveur et toutes les connexions lors d'un arrêt */
const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  try {
    console.log('Closing WebSocket connections...');
    for (const set of connectedUsers.values()) {
      for (const u of set) { try { u.socket.close() } catch { } }
    }
    connectedUsers.clear();
    
    console.log('Closing database connection...');
    await dbService.close();
    
    console.log('Closing server...');
    await app.close();
    
    console.log('Server shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1)
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => { console.error('Uncaught Exception:', error) });
process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection at:', promise, 'reason:', reason) });

start();
