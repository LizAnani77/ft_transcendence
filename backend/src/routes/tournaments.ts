// backend/src/routes/tournaments.ts

import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import sqlite3 from 'sqlite3';
import path from 'path';
import { GuestTokenService } from '../services/guestTokens';
import { LIMITS } from '../config/limits';

interface CreateTournamentBody { 
  name: string; 
  creatorAlias: string;
  userId?: number;
  guestToken?: string;
}

interface JoinTournamentBody { 
  playerAlias: string;
  userId?: number;
  guestToken?: string;
}

interface StartTournamentBody { creatorAlias: string }

interface ReportMatchResultBody {
  winnerAlias: string;
  score1?: number;
  score2?: number;
}

interface DeclareForfeitBody {
  playerAlias: string;
  reason: 'declined_invitation' | 'abandoned_game' | 'left_tournament' | 'disconnected';
  userId?: number;
}

interface CheckParticipationQuery {
  userId: number;
}

interface TournamentHistoryQuery {
  userId?: number;
  alias?: string;
  limit?: number;
}

const dbPath = path.join(process.cwd(), 'database', 'pong.db');

const dbConnectionPool = new Map<string, sqlite3.Database>();
const MAX_POOL_SIZE = 20;
const CONNECTION_TIMEOUT = 60000;

function getPooledConnection(): sqlite3.Database {
  const poolKey = `conn_${Date.now()}_${Math.random()}`;
  
  if (dbConnectionPool.size >= MAX_POOL_SIZE) {
    const oldestKey = dbConnectionPool.keys().next().value;
    const oldConn = dbConnectionPool.get(oldestKey);
    if (oldConn) {
      try { oldConn.close(); } catch {}
      dbConnectionPool.delete(oldestKey);
    }
  }
  
  const db = new sqlite3.Database(dbPath);
  dbConnectionPool.set(poolKey, db);
  
  setTimeout(() => {
    if (dbConnectionPool.has(poolKey)) {
      try { db.close(); } catch {}
      dbConnectionPool.delete(poolKey);
    }
  }, CONNECTION_TIMEOUT);
  
  return db;
}

setInterval(() => {
  if (dbConnectionPool.size > MAX_POOL_SIZE) {
    const entries = Array.from(dbConnectionPool.entries());
    const toRemove = entries.slice(0, Math.floor(entries.length / 2));
    for (const [key, db] of toRemove) {
      try { db.close(); } catch {}
      dbConnectionPool.delete(key);
    }
  }
}, 60000);

export default async function (fastify: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  const ok = (reply: FastifyReply, payload: any) => {
    try {
      return reply.send(payload);
    } catch (error) {
      fastify.log.error('Response send failed:', error);
      return reply.code(500).send({ error: 'Response failed' });
    }
  };

  const bad = (reply: FastifyReply, code: number, message: string) => {
    try {
      fastify.log.warn(`HTTP ${code}: ${message}`);
      return reply.code(code).send({ error: message });
    } catch (error) {
      fastify.log.error('Error response failed:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  };

  const err500 = (reply: FastifyReply, e: any, tag: string) => { 
    fastify.log.error(tag, e); 
    try {
      return reply.code(500).send({ error: 'Internal server error' });
    } catch (sendError) {
      fastify.log.error('Failed to send error response:', sendError);
    }
  };

  const withDb = <T>(fn: (db: sqlite3.Database) => Promise<T>) => new Promise<T>((resolve, reject) => { 
    let db: sqlite3.Database | null = null;
    let retryCount = 0;
    const maxRetries = 2;
    
    const attempt = () => {
      try {
        db = getPooledConnection();
        
        const timeoutId = setTimeout(() => {
          if (retryCount < maxRetries) {
            retryCount++;
            fastify.log.warn(`[DB] Timeout, retrying (${retryCount}/${maxRetries})...`);
            if (db) { try { db.close(); } catch {} }
            clearTimeout(timeoutId);
            setTimeout(attempt, 1000);
            return;
          }
          
          reject(new Error('Database operation timeout after retries'));
          if (db) { try { db.close(); } catch {} }
        }, 15000);
        
        fn(db).then(result => {
          clearTimeout(timeoutId);
          if (db) { try { db.close(); } catch {} }
          resolve(result);
        }).catch(error => {
          clearTimeout(timeoutId);
          if (db) { try { db.close(); } catch {} }
          
          const canRetry = (
            error.message?.includes('503') || 
            error.message?.includes('SQLITE_BUSY') ||
            error.message?.includes('database is locked')
          );
          
          if (canRetry && retryCount < maxRetries) {
            retryCount++;
            fastify.log.warn(`[DB] Error, retrying (${retryCount}/${maxRetries}):`, error.message);
            setTimeout(attempt, 1000);
          } else {
            reject(error);
          }
        });
        
      } catch (error) {
        if (db) { try { db.close(); } catch {} }
        reject(error);
      }
    };
    
    attempt();
  });

  const dbGet = (db: sqlite3.Database, sql: string, params: any[] = []) => new Promise<any>((resolve, reject) => {
    const startTime = Date.now();
    fastify.log.debug(`DB GET: ${sql.substring(0, 100)}...`, { params: params.length });
    
    db.get(sql, params, (error, result) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        fastify.log.error(`DB GET failed (${duration}ms):`, { sql: sql.substring(0, 100), error: error.message });
        reject(error);
      } else {
        fastify.log.debug(`DB GET success (${duration}ms)`, { hasResult: !!result });
        resolve(result);
      }
    });
  });

  const dbAll = (db: sqlite3.Database, sql: string, params: any[] = []) => new Promise<any[]>((resolve, reject) => {
    const startTime = Date.now();
    fastify.log.debug(`DB ALL: ${sql.substring(0, 100)}...`, { params: params.length });
    
    db.all(sql, params, (error, results) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        fastify.log.error(`DB ALL failed (${duration}ms):`, { sql: sql.substring(0, 100), error: error.message });
        reject(error);
      } else {
        fastify.log.debug(`DB ALL success (${duration}ms)`, { count: results?.length || 0 });
        resolve(results || []);
      }
    });
  });

  const dbRun = (db: sqlite3.Database, sql: string, params: any[] = []) => new Promise<sqlite3.RunResult>((resolve, reject) => {
    const startTime = Date.now();
    fastify.log.debug(`DB RUN: ${sql.substring(0, 100)}...`, { params: params.length });
    
    db.run(sql, params, function(error) {
      const duration = Date.now() - startTime;
      
      if (error) {
        fastify.log.error(`DB RUN failed (${duration}ms):`, { sql: sql.substring(0, 100), error: error.message });
        reject(error);
      } else {
        fastify.log.debug(`DB RUN success (${duration}ms)`, { changes: this.changes, lastID: this.lastID });
        resolve(this);
      }
    });
  });

  fastify.post('/guest/token', async (request, reply) => {
    const startTime = Date.now();
    try {
      const result = await withDb(async db => {
        const guestTokenService = new GuestTokenService(db);
        const token = guestTokenService.generateGuestToken();
        await guestTokenService.createGuestSession(token);
        return { token };
      });
      return ok(reply, { token: result.token, expiresIn: 86400 });
    } catch (error: any) {
      return err500(reply, error, 'Error generating guest token');
    }
  });

  fastify.get('/guest/validate', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader) return bad(reply, 401, 'Authorization header required');
      const token = authHeader.replace('Bearer ', '');
      if (!token.startsWith('guest_')) return bad(reply, 400, 'Invalid guest token format');
      const result = await withDb(async db => {
        const guestTokenService = new GuestTokenService(db);
        const isValid = await guestTokenService.validateGuestToken(token);
        if (!isValid) return { error: 'Token expired or invalid', code: 401 };
        const session = await guestTokenService.getGuestSession(token);
        return {
          valid: true,
          session: session ? {
            tournamentId: session.tournament_id,
            playerAlias: session.player_alias,
            expiresAt: session.expires_at
          } : null
        };
      });
      if (result.error) return bad(reply, result.code, result.error);
      return ok(reply, result);
    } catch (error: any) {
      return err500(reply, error, 'Error validating guest token');
    }
  });

  async function calculateFinalPositions(db: sqlite3.Database, tournamentId: number): Promise<{ [playerAlias: string]: number }> {
    fastify.log.info('[HISTORY] Calculating final positions', { tournamentId });
    
    const positions: { [playerAlias: string]: number } = {};
    
    const finalMatch = await dbGet(db, `
      SELECT winner_alias, player1_alias, player2_alias
      FROM tournament_matches_aliases
      WHERE tournament_id = ? AND round = 2 AND status = 'finished'
      LIMIT 1
    `, [tournamentId]);
    
    if (finalMatch && finalMatch.winner_alias) {
      positions[finalMatch.winner_alias] = 1;
      
      const finalist = finalMatch.player1_alias === finalMatch.winner_alias 
        ? finalMatch.player2_alias 
        : finalMatch.player1_alias;
      positions[finalist] = 2;
      
      fastify.log.info('[HISTORY] Final positions determined', {
        champion: finalMatch.winner_alias,
        runnerUp: finalist
      });
    }
    
    const semiMatches = await dbAll(db, `
      SELECT player1_alias, player2_alias, winner_alias
      FROM tournament_matches_aliases
      WHERE tournament_id = ? AND round = 1 AND status = 'finished'
      ORDER BY id ASC
    `, [tournamentId]);
    
    let position3and4 = 3;
    for (const match of semiMatches) {
      if (match.winner_alias) {
        const loser = match.player1_alias === match.winner_alias 
          ? match.player2_alias 
          : match.player1_alias;
        
        if (!positions[loser]) {
          positions[loser] = position3and4;
          position3and4++;
        }
      }
    }
    
    fastify.log.info('[HISTORY] All positions calculated', { positions });
    return positions;
  }

  async function saveFinalResults(db: sqlite3.Database, tournamentId: number): Promise<void> {
    fastify.log.info('[HISTORY] Saving final results', { tournamentId });
    
    const existing = await dbGet(db, `
      SELECT COUNT(*) as count FROM tournament_results WHERE tournament_id = ?
    `, [tournamentId]);
    
    if (existing && existing.count > 0) {
      fastify.log.info('[HISTORY] Results already saved', { tournamentId });
      return;
    }
    
    const positions = await calculateFinalPositions(db, tournamentId);
    
    for (const [playerAlias, position] of Object.entries(positions)) {
      const participant = await dbGet(db, `
        SELECT user_id FROM tournament_aliases
        WHERE tournament_id = ? AND player_alias = ?
      `, [tournamentId, playerAlias]);
      
      const userId = participant?.user_id || null;
      
      await dbRun(db, `
        INSERT INTO tournament_results (tournament_id, user_id, player_alias, final_position, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [tournamentId, userId, playerAlias, position]);
      
      if (userId) {
        const isWinner = position === 1;
        await dbRun(db, `
          UPDATE user_stats 
          SET tournaments_played = tournaments_played + 1,
              tournaments_won = tournaments_won + ?
          WHERE user_id = ?
        `, [isWinner ? 1 : 0, userId]);
        
        fastify.log.info('[HISTORY] Stats updated', { userId, playerAlias, position, isWinner });
      }
    }
    
    fastify.log.info('[HISTORY] ✅ Final results saved successfully', { tournamentId });
  }

  fastify.get('/', async (_req, reply) => {
    const startTime = Date.now();
    
    try {
      fastify.log.info('Fetching open tournaments');
      
      const rows = await withDb(db => dbAll(db, `
        SELECT 
          t.id,
          t.name,
          t.status,
          t.max_players,
          t.current_round,
          t.created_at,
          t.started_at,
          t.ended_at,
          COUNT(ta.id) AS current_players
        FROM tournaments t
        LEFT JOIN tournament_aliases ta ON t.id = ta.tournament_id
        WHERE t.status = 'waiting'
        GROUP BY t.id, t.name, t.status, t.max_players, t.current_round, t.created_at, t.started_at, t.ended_at
        HAVING COUNT(ta.id) < 4
        ORDER BY t.created_at DESC
        LIMIT 20`, []));

      const duration = Date.now() - startTime;
      fastify.log.info(`Open tournaments fetched successfully (${duration}ms)`, { count: rows.length });
      
      return ok(reply, { tournaments: rows });
    } catch (error: any) { 
      const duration = Date.now() - startTime;
      fastify.log.error(`Failed to fetch tournaments (${duration}ms):`, error);
      return err500(reply, error, 'Erreur lors de la récupération des tournois');
    }
  });

  fastify.get('/history', async (
    request: FastifyRequest<{ Querystring: TournamentHistoryQuery }>, 
    reply
  ) => {
    const startTime = Date.now();
    
    try {
      const { userId, alias, limit = 10 } = request.query as any;
      
      fastify.log.info('[HISTORY] Fetching tournament history', { 
        userId: userId || 'none', 
        alias: alias || 'none',
        limit 
      });

      const result = await withDb(async db => {
        let query = `
          SELECT DISTINCT
            t.id,
            t.name,
            t.status,
            t.created_at,
            t.started_at,
            t.ended_at,
            (SELECT tr.player_alias FROM tournament_results tr 
             WHERE tr.tournament_id = t.id AND tr.final_position = 1 
             LIMIT 1) as winner_alias,
            (SELECT tr.user_id FROM tournament_results tr 
             WHERE tr.tournament_id = t.id AND tr.final_position = 1 
             LIMIT 1) as winner_user_id
          FROM tournaments t
          WHERE t.status IN ('finished', 'cancelled')
        `;
        
        const params: any[] = [];
        
        if (userId && Number.isInteger(Number(userId)) && Number(userId) > 0) {
          query += ` AND EXISTS (
            SELECT 1 FROM tournament_aliases ta 
            WHERE ta.tournament_id = t.id AND ta.user_id = ?
          )`;
          params.push(Number(userId));
        }
        
        if (alias && typeof alias === 'string' && alias.trim().length > 0 && !userId) {
          query += ` AND EXISTS (
            SELECT 1 FROM tournament_aliases ta 
            WHERE ta.tournament_id = t.id AND ta.player_alias = ?
          )`;
          params.push(alias.trim());
        }
        
        query += ` ORDER BY t.ended_at DESC, t.created_at DESC LIMIT ?`;
        params.push(Number(limit) || 10);
        
        const tournaments = await dbAll(db, query, params);
        
        fastify.log.info('[HISTORY] History fetched', { 
          count: tournaments.length,
          userId: userId || 'none',
          alias: alias || 'none'
        });
        
        return {
          success: true,
          tournaments: tournaments.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            createdAt: t.created_at,
            startedAt: t.started_at,
            endedAt: t.ended_at,
            winner: t.winner_alias ? {
              alias: t.winner_alias,
              userId: t.winner_user_id
            } : null
          }))
        };
      });

      const duration = Date.now() - startTime;
      
      fastify.log.info(`[HISTORY] ✅ Tournament history fetched successfully (${duration}ms)`, {
        count: result.tournaments.length
      });

      return ok(reply, result);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`[HISTORY] Error fetching history (${duration}ms):`, error);
      return err500(reply, error, 'Error fetching tournament history');
    }
  });

  fastify.post('/:id/quit', async (
    request: FastifyRequest<{ Params: { id: string }, Body: { playerAlias: string } }>, 
    reply
  ) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      const { playerAlias } = request.body || ({} as any);
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'Invalid tournament ID');
      }
      
      if (!playerAlias || typeof playerAlias !== 'string' || playerAlias.trim().length === 0) {
        return bad(reply, 400, 'Player alias is required');
      }
      
      fastify.log.info('[QUIT] Processing quit request', {
        tournamentId,
        playerAlias: playerAlias.trim()
      });

      const result = await withDb(async db => {
        const tournament = await dbGet(db, `
          SELECT id, name, status FROM tournaments WHERE id = ?
        `, [tournamentId]);
        
        if (!tournament) {
          return { error: 'Tournament not found', code: 404 };
        }
        
        if (tournament.status !== 'finished' && tournament.status !== 'cancelled') {
          return { error: 'Can only quit finished or cancelled tournaments', code: 400 };
        }
        
        const participant = await dbGet(db, `
          SELECT player_alias, user_id FROM tournament_aliases
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, playerAlias.trim()]);
        
        if (!participant) {
          return { error: 'Player not in tournament', code: 404 };
        }
        
        if (tournament.status === 'finished') {
          const existing = await dbGet(db, `
            SELECT COUNT(*) as count FROM tournament_results WHERE tournament_id = ?
          `, [tournamentId]);
          
          if (!existing || existing.count === 0) {
            fastify.log.info('[QUIT] Saving final results before quit', { tournamentId });
            await saveFinalResults(db, tournamentId);
          }
        }
        
        // Si c'est un guest, libérer son alias pour qu'il soit réutilisable
        if (participant.user_id && participant.user_id < 0) {
          try {
            const guestTokenService = new GuestTokenService(db);
            const guestSession = await new Promise<any>((resolve, reject) => {
              db.get(
                `SELECT token FROM guest_sessions WHERE user_id = ? AND tournament_id = ?`,
                [participant.user_id, tournamentId],
                (err, row) => err ? reject(err) : resolve(row)
              );
            });
            
            if (guestSession?.token) {
              await guestTokenService.unlinkGuestFromTournament(guestSession.token);
              fastify.log.info('[QUIT] ✅ Guest alias freed for reuse', {
                userId: participant.user_id,
                alias: participant.player_alias,
                tournamentId
              });
            }
          } catch (error) {
            fastify.log.warn('[QUIT] Failed to unlink guest from tournament', {
              userId: participant.user_id,
              error
            });
          }
        }
        
        fastify.log.info('[QUIT] Player quit processed', {
          tournamentId,
          playerAlias: playerAlias.trim(),
          status: tournament.status
        });
        
        return {
          success: true,
          message: 'Successfully quit tournament',
          tournamentId,
          status: tournament.status
        };
      });

      const duration = Date.now() - startTime;

      if (result.error) {
        fastify.log.warn(`[QUIT] Quit failed (${duration}ms)`, { 
          tournamentId,
          playerAlias: playerAlias.trim(),
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }

      fastify.log.info(`[QUIT] ✅ Player quit successfully (${duration}ms)`, {
        tournamentId,
        playerAlias: playerAlias.trim()
      });

      return ok(reply, result);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`[QUIT] Error processing quit (${duration}ms):`, error);
      return err500(reply, error, 'Error quitting tournament');
    }
  });

  fastify.post('/', async (request: FastifyRequest<{ Body: CreateTournamentBody }>, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const { name, creatorAlias, userId, guestToken } = request.body || ({} as any);
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return bad(reply, 400, 'Le nom du tournoi est requis et ne peut pas être vide');
      }
      
      if (!creatorAlias || typeof creatorAlias !== 'string' || creatorAlias.trim().length === 0) {
        return bad(reply, 400, "L'alias du créateur est requis");
      }
      
      if (name.length > 100) {
        return bad(reply, 400, 'Le nom du tournoi ne peut pas dépasser 100 caractères');
      }

      if (creatorAlias.length > 50) {
        return bad(reply, 400, "L'alias ne peut pas dépasser 50 caractères");
      }
      
      const trimmedName = name.trim();
      const trimmedAlias = creatorAlias.trim();

      const nameRegex = /^[a-zA-Z0-9\s\-_\.]+$/;
      const aliasRegex = /^[a-zA-Z0-9\-_\.]+$/;

      if (!nameRegex.test(trimmedName)) {
        return bad(reply, 400, 'Le nom du tournoi contient des caractères non autorisés');
      }

      if (!aliasRegex.test(trimmedAlias)) {
        return bad(reply, 400, "L'alias contient des caractères non autorisés (seuls les lettres, chiffres, -, _, . sont autorisés)");
      }

      if (userId !== undefined && userId !== null) {
        // Accepter les userId négatifs (guests)
        if (!Number.isInteger(userId) || userId === 0) {
          return bad(reply, 400, 'Invalid user ID');
        }
      }

      fastify.log.info('Creating tournament', { 
        name: trimmedName, 
        creatorAlias: trimmedAlias,
        userId: userId || 'guest'
      });

      const result = await withDb(async db => {
        const guestTokenService = new GuestTokenService(db);

        if (guestToken) {
          const isValid = await guestTokenService.validateGuestToken(guestToken);
          if (!isValid) {
            throw new Error('Invalid or expired guest token');
          }
        }

        /* Vérifier la limite de tournois actifs simultanés */
        const activeTournamentsCount = await dbGet(db, `
          SELECT COUNT(*) as count FROM tournaments
          WHERE status IN ('waiting', 'active')
        `, []);

        if (activeTournamentsCount && activeTournamentsCount.count >= LIMITS.TOURNAMENT.MAX_CONCURRENT_TOURNAMENTS) {
          const err: any = new Error(`Active tournament limit reached (${LIMITS.TOURNAMENT.MAX_CONCURRENT_TOURNAMENTS} maximum). Please try again later.`);
          err.statusCode = 403;
          throw err;
        }

        const existing = await dbGet(db, `
          SELECT id FROM tournaments
          WHERE name = ? AND created_at > datetime('now', '-1 hour')
        `, [trimmedName]);

        if (existing) {
          throw new Error('A tournament with this name was recently created');
        }

        if (userId !== undefined && userId !== null) {
          const activeParticipation = await dbGet(db, `
            SELECT ta.tournament_id 
            FROM tournament_aliases ta
            JOIN tournaments t ON ta.tournament_id = t.id
            WHERE ta.user_id = ? AND t.status IN ('waiting', 'active')
          `, [userId]);

          if (activeParticipation) {
            const err: any = new Error('You are already registered in another active tournament');
            err.statusCode = 409;
            throw err;
          }
        }
        
        const tournamentResult = await dbRun(db, `
          INSERT INTO tournaments (name, max_players, status, current_round, created_at, updated_at) 
          VALUES (?, 4, 'waiting', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [trimmedName]);
        
        const tournamentId = tournamentResult.lastID;
        fastify.log.info(`Tournament created with ID: ${tournamentId}`);
        
        await dbRun(db, `
          INSERT INTO tournament_aliases (tournament_id, user_id, player_alias, is_owner, joined_at) 
          VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
        `, [tournamentId, userId || null, trimmedAlias]);
        
        if (guestToken && tournamentId) {
          await guestTokenService.linkGuestToTournament(guestToken, tournamentId, trimmedAlias);
        }
        
        fastify.log.info(`Creator ${trimmedAlias} added as owner to tournament ${tournamentId}`, {
          userId: userId || 'guest',
          mode: userId ? 'authenticated' : 'guest'
        });
        
        return await dbGet(db, `
          SELECT 
            t.*,
            COUNT(ta.id) as current_players
          FROM tournaments t
          LEFT JOIN tournament_aliases ta ON t.id = ta.tournament_id
          WHERE t.id = ?
          GROUP BY t.id
        `, [tournamentId]);
      });

      const duration = Date.now() - startTime;
      fastify.log.info(`Tournament created successfully (${duration}ms)`, { 
        id: result.id, 
        name: trimmedName, 
        creatorAlias: trimmedAlias,
        userId: userId || 'guest',
        status: result.status,
        currentPlayers: result.current_players
      });

      // Broadcast WebSocket aux participants
      try {
        const broadcastFn = (fastify as any).broadcastTournamentUpdate;
        if (broadcastFn) {
          broadcastFn(result.id, 'player_joined', {
            playerAlias: trimmedAlias,
            currentPlayers: result.current_players,
            maxPlayers: 4,
            tournamentName: trimmedName
          });
        }
      } catch (broadcastError) {
        fastify.log.error('Failed to broadcast tournament creation:', broadcastError);
      }
      
      return reply.code(201).send({ tournament: result });
    } catch (error: any) { 
      const duration = Date.now() - startTime;
      
      if (error?.statusCode === 409) {
        fastify.log.warn(`Tournament creation blocked (${duration}ms):`, { message: error.message });
        return bad(reply, 409, error.message);
      }
      
      if (error.message === 'A tournament with this name was recently created') {
        fastify.log.warn(`Duplicate tournament name rejected (${duration}ms)`);
        return bad(reply, 409, error.message);
      }
      
      fastify.log.error(`Failed to create tournament (${duration}ms):`, error);
      return err500(reply, error, 'Erreur lors de la création du tournoi');
    }
  });

  fastify.post('/:id/join', async (request: FastifyRequest<{ Params: { id: string }, Body: JoinTournamentBody }>, reply) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      const { playerAlias, userId, guestToken } = request.body || ({} as any);
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'ID de tournoi invalide');
      }
      
      if (!playerAlias || typeof playerAlias !== 'string' || playerAlias.trim().length === 0) {
        return bad(reply, 400, "L'alias du joueur est requis et ne peut pas être vide");
      }
      
      if (playerAlias.length > 50) {
        return bad(reply, 400, "L'alias ne peut pas dépasser 50 caractères");
      }
      
      const trimmedPlayerAlias = playerAlias.trim();
      
      const aliasRegex = /^[a-zA-Z0-9\-_\.]+$/;
      if (!aliasRegex.test(trimmedPlayerAlias)) {
        return bad(reply, 400, "L'alias contient des caractères non autorisés (seuls les lettres, chiffres, -, _, . sont autorisés)");
      }
      
      if (userId !== undefined && userId !== null) {
        // ✅ CORRECTION: Accepter les userId négatifs (guests)
        if (!Number.isInteger(userId) || userId === 0) {
          return bad(reply, 400, 'Invalid user ID');
        }
      }
      
      fastify.log.info('Player joining tournament', {
        tournamentId,
        playerAlias: trimmedPlayerAlias,
        userId: userId || 'guest'
      });

      const result = await withDb(async db => {
        const guestTokenService = new GuestTokenService(db);

        if (guestToken) {
          const isValid = await guestTokenService.validateGuestToken(guestToken);
          if (!isValid) {
            return { error: 'Invalid or expired guest token', code: 401 };
          }
        }

        const tournament = await dbGet(db, `
          SELECT id, name, status, max_players FROM tournaments WHERE id = ?
        `, [tournamentId]);

        if (!tournament) {
          return { error: 'Tournament not found', code: 404 };
        }

        if (tournament.status === 'finished') {
          return { error: 'This tournament has already finished', code: 400 };
        }

        if (tournament.status === 'cancelled') {
          return { error: 'This tournament has been cancelled', code: 400 };
        }

        if (tournament.status === 'in_progress') {
          return { error: 'This tournament has already started', code: 400 };
        }

        if (tournament.status !== 'waiting') {
          return { error: 'Tournament is not available', code: 400 };
        }
        
        const participantCount = await dbGet(db, `
          SELECT COUNT(*) AS count FROM tournament_aliases WHERE tournament_id = ?
        `, [tournamentId]);
        
        if (participantCount.count >= 4) {
          return { error: 'Tournament is full (4/4 players)', code: 400 };
        }
        
        const existingAlias = await dbGet(db, `
          SELECT id FROM tournament_aliases 
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, trimmedPlayerAlias]);
        
        if (existingAlias) {
          return { error: 'This alias is already taken in this tournament', code: 409 };
        }
        
        if (userId !== undefined && userId !== null) {
          const activeParticipation = await dbGet(db, `
            SELECT ta.tournament_id 
            FROM tournament_aliases ta
            JOIN tournaments t ON ta.tournament_id = t.id
            WHERE ta.user_id = ? AND t.status IN ('waiting', 'active')
          `, [userId]);

          if (activeParticipation && activeParticipation.tournament_id !== tournamentId) {
            return { error: 'You are already in another active tournament', code: 409 };
          }
        }
        
        await dbRun(db, `
          INSERT INTO tournament_aliases (tournament_id, user_id, player_alias, is_owner, joined_at) 
          VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
        `, [tournamentId, userId || null, trimmedPlayerAlias]);
        
        if (guestToken) {
          await guestTokenService.linkGuestToTournament(guestToken, tournamentId, trimmedPlayerAlias);
        }
        
        const newCount = await dbGet(db, `
          SELECT COUNT(*) AS count FROM tournament_aliases WHERE tournament_id = ?
        `, [tournamentId]);
        
        fastify.log.info(`Player ${trimmedPlayerAlias} joined tournament ${tournamentId}. New count: ${newCount.count}/4`, {
          userId: userId || 'guest',
          mode: userId ? 'authenticated' : 'guest'
        });
        
        return {
          success: true,
          message: 'Successfully joined tournament',
          playerCount: newCount.count,
          maxPlayers: 4,
          tournamentName: tournament.name,
          isFull: newCount.count === 4
        };
      });

      const duration = Date.now() - startTime;
      
      if (result.error) {
        fastify.log.warn(`Join tournament failed (${duration}ms)`, { 
          tournamentId, 
          playerAlias: trimmedPlayerAlias, 
          userId: userId || 'guest',
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }
      
      fastify.log.info(`Player joined tournament successfully (${duration}ms)`, {
        tournamentId,
        playerAlias: trimmedPlayerAlias,
        userId: userId || 'guest',
        playerCount: result.playerCount,
        maxPlayers: result.maxPlayers,
        isFull: result.isFull
      });

      // Broadcast WebSocket aux participants
      try {
        const broadcastFn = (fastify as any).broadcastTournamentUpdate;
        if (broadcastFn) {
          broadcastFn(tournamentId, 'player_joined', {
            playerAlias: trimmedPlayerAlias,
            currentPlayers: result.playerCount,
            maxPlayers: 4,
            isFull: result.isFull,
            tournamentName: result.tournamentName
          });
        }
      } catch (broadcastError) {
        fastify.log.error('Failed to broadcast player joined:', broadcastError);
      }
      
      return ok(reply, result);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`Error joining tournament (${duration}ms):`, error);
      return err500(reply, error, 'Error joining tournament');
    }
  });

  fastify.post('/:id/forfeit', async (
    request: FastifyRequest<{ Params: { id: string }, Body: DeclareForfeitBody }>, 
    reply
  ) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      const { playerAlias, reason, userId } = request.body || ({} as any);
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'Invalid tournament ID');
      }
      
      if (!playerAlias || typeof playerAlias !== 'string' || playerAlias.trim().length === 0) {
        return bad(reply, 400, 'Player alias is required');
      }
      
      const validReasons = ['declined_invitation', 'abandoned_game', 'left_tournament', 'disconnected'];
      if (!reason || !validReasons.includes(reason)) {
        return bad(reply, 400, 'Invalid forfeit reason');
      }
      
      fastify.log.info('[FORFAIT] Processing forfeit', {
        tournamentId,
        playerAlias: playerAlias.trim(),
        reason,
        userId: userId || 'guest'
      });

      const result = await withDb(async db => {
        const tournament = await dbGet(db, `
          SELECT id, name, status, max_players FROM tournaments WHERE id = ?
        `, [tournamentId]);
        
        const trimmedAlias = playerAlias.trim();
        
        if (!tournament) {
          return { error: 'Tournament not found', code: 404 };
        }
        
        if (tournament.status === 'finished' || tournament.status === 'cancelled') {
          return { error: 'Tournament already finished or cancelled', code: 400 };
        }
        
        const participant = await dbGet(db, `
          SELECT player_alias, is_owner FROM tournament_aliases
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, playerAlias.trim()]);
        
        if (!participant) {
          return { error: 'Player not in tournament', code: 404 };
        }
        
        const isOwner = participant.is_owner === 1;
        const statusAtForfeit = tournament.status as 'waiting' | 'active' | 'finished' | 'cancelled';

        if (isOwner && statusAtForfeit === 'waiting') {
          fastify.log.info('[FORFAIT] Owner forfeited before start - cancelling tournament', {
            tournamentId,
            playerAlias: trimmedAlias,
            statusAtForfeit
          });
          
          await dbRun(db, `
            UPDATE tournaments 
            SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [tournamentId]);
          
          await dbRun(db, `
            UPDATE tournament_matches_aliases
            SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
            WHERE tournament_id = ? AND status IN ('pending', 'active')
          `, [tournamentId]);
          
          const participants = await dbAll(db, `
            SELECT user_id, player_alias FROM tournament_aliases WHERE tournament_id = ?
          `, [tournamentId]);
          
          // ✅ NOUVEAU: Libérer les alias de tous les guests du tournoi annulé
          const guestTokenService = new GuestTokenService(db);
          const guestParticipants = participants.filter((p: any) => p.user_id && p.user_id < 0);
          
          for (const guest of guestParticipants) {
            try {
              const guestSession = await new Promise<any>((resolve, reject) => {
                db.get(
                  `SELECT token FROM guest_sessions WHERE user_id = ? AND tournament_id = ?`,
                  [guest.user_id, tournamentId],
                  (err, row) => err ? reject(err) : resolve(row)
                );
              });
              
              if (guestSession?.token) {
                await guestTokenService.unlinkGuestFromTournament(guestSession.token);
                fastify.log.info('[FORFAIT] ✅ Guest alias freed (tournament cancelled)', {
                  userId: guest.user_id,
                  alias: guest.player_alias
                });
              }
            } catch (error) {
              fastify.log.warn('[FORFAIT] Failed to unlink guest', { userId: guest.user_id, error });
            }
          }
          
          return {
            success: true,
            tournamentCancelled: true,
            message: 'Tournament cancelled by creator',
            participants: participants,
            reason
          };
        } else if (isOwner) {
          fastify.log.info('[FORFAIT] Owner forfeited after start - treating as regular player', {
            tournamentId,
            playerAlias: trimmedAlias,
            statusAtForfeit
          });
        }
        
        const match = await dbGet(db, `
          SELECT id, round, player1_alias, player2_alias, status
          FROM tournament_matches_aliases
          WHERE tournament_id = ? 
            AND (player1_alias = ? OR player2_alias = ?)
            AND status IN ('pending', 'active')
          ORDER BY round DESC, id DESC
          LIMIT 1
        `, [tournamentId, playerAlias.trim(), playerAlias.trim()]);
        
        if (!match) {
          // Si le tournoi est en phase d'attente (matchmaking) -> supprimer le participant
          if (tournament.status === 'waiting') {
            fastify.log.info('[FORFAIT] Removing player from tournament during matchmaking', {
              tournamentId,
              playerAlias: trimmedAlias
            });

            // transaction simple pour atomicité
            await dbRun(db, `BEGIN TRANSACTION`);
            try {
              await dbRun(db, `
                DELETE FROM tournament_aliases
                WHERE tournament_id = ? AND player_alias = ?
              `, [tournamentId, trimmedAlias]);

              // Si c'est un guest, libérer son alias
              const removedPlayer = await dbGet(db, `
                SELECT user_id FROM tournament_aliases 
                WHERE tournament_id = ? AND player_alias = ?
              `, [tournamentId, trimmedAlias]);
              
              // Le joueur a été supprimé, mais on a besoin de récupérer son userId avant suppression
              // Cherchons dans guest_sessions directement
              if (!removedPlayer || (removedPlayer.user_id && removedPlayer.user_id < 0)) {
                try {
                  const guestTokenService = new GuestTokenService(db);
                  const guestSession = await new Promise<any>((resolve, reject) => {
                    db.get(
                      `SELECT token, user_id FROM guest_sessions WHERE tournament_id = ? AND player_alias = ?`,
                      [tournamentId, trimmedAlias],
                      (err, row) => err ? reject(err) : resolve(row)
                    );
                  });
                  
                  if (guestSession?.token) {
                    await guestTokenService.unlinkGuestFromTournament(guestSession.token);
                    fastify.log.info('[FORFAIT] ✅ Guest alias freed (removed during waiting)', {
                      userId: guestSession.user_id,
                      alias: trimmedAlias
                    });
                  }
                } catch (error) {
                  fastify.log.warn('[FORFAIT] Failed to unlink guest', { alias: trimmedAlias, error });
                }
              }

              const participants = await dbAll(db, `
                SELECT user_id, player_alias FROM tournament_aliases
                WHERE tournament_id = ?
                ORDER BY is_owner DESC, joined_at ASC
              `, [tournamentId]);

              await dbRun(db, `COMMIT`);

              return {
                success: true,
                matchFound: false,
                playerRemoved: true,
                participants,
                currentPlayers: participants.length,
                tournamentName: tournament.name,
                maxPlayers: tournament.max_players || 4,
                message: 'Player removed from tournament during matchmaking',
                reason
              };
            } catch (e) {
              await dbRun(db, `ROLLBACK`);
              throw e;
            }
          }

          fastify.log.warn('[FORFAIT] No active match found for player', {
            tournamentId,
            playerAlias: trimmedAlias
          });
          return {
            success: true,
            matchFound: false,
            message: 'No active match found - player eliminated',
            reason
          };
        }
        
        const winnerAlias = match.player1_alias === playerAlias.trim() 
          ? match.player2_alias 
          : match.player1_alias;
        
        if (!winnerAlias) {
          return { error: 'No opponent found in match', code: 400 };
        }
        
        fastify.log.info('[FORFAIT] Declaring opponent as winner by forfeit', {
          matchId: match.id,
          forfeitingPlayer: playerAlias.trim(),
          winner: winnerAlias,
          reason
        });
        
        await dbRun(db, `
          UPDATE tournament_matches_aliases
          SET winner_alias = ?, score1 = 0, score2 = 0, status = 'finished', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [winnerAlias, match.id]);
        
        // Si le joueur qui forfeit est un guest, libérer son alias
        const forfeitingPlayer = await dbGet(db, `
          SELECT user_id FROM tournament_aliases
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, playerAlias.trim()]);
        
        const opponentPlayer = await dbGet(db, `
          SELECT user_id FROM tournament_aliases
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, winnerAlias]);
        
        if (forfeitingPlayer?.user_id && forfeitingPlayer.user_id < 0) {
          try {
            const guestTokenService = new GuestTokenService(db);
            const guestSession = await new Promise<any>((resolve, reject) => {
              db.get(
                `SELECT token FROM guest_sessions WHERE user_id = ? AND tournament_id = ?`,
                [forfeitingPlayer.user_id, tournamentId],
                (err, row) => err ? reject(err) : resolve(row)
              );
            });
            
            if (guestSession?.token) {
              await guestTokenService.unlinkGuestFromTournament(guestSession.token);
              fastify.log.info('[FORFAIT] ✅ Guest alias freed (forfeit during match)', {
                userId: forfeitingPlayer.user_id,
                alias: playerAlias.trim()
              });
            }
          } catch (error) {
            fastify.log.warn('[FORFAIT] Failed to unlink guest', {
              userId: forfeitingPlayer.user_id,
              error
            });
          }
        }
        
        // Vérifier si tous les matchs du round sont terminés pour éventuellement générer le round suivant
        let roundCompleted = false;
        try {
          const pendingCountRow = await dbGet(db, `
            SELECT COUNT(*) as count
            FROM tournament_matches_aliases
            WHERE tournament_id = ? AND round = ? AND status IN ('pending', 'active')
          `, [tournamentId, match.round]);
          const pendingCount = pendingCountRow?.count || 0;
          roundCompleted = pendingCount === 0;
        } catch (e) {
          fastify.log.warn('[FORFAIT] Failed to compute pending count after forfeit', e);
        }

        return {
          success: true,
          matchFound: true,
          tournamentCancelled: false,
          matchId: match.id,
          round: match.round,
          winnerAlias,
          forfeitingAlias: playerAlias.trim(),
          message: 'Opponent declared winner by forfeit',
          reason,
          roundCompleted,
          forfeitingUserId: forfeitingPlayer?.user_id ?? null,
          opponentUserId: opponentPlayer?.user_id ?? null,
          gameId: `tournament_${tournamentId}_${match.id}`
        };
      });

      const duration = Date.now() - startTime;

      if (result.error) {
        fastify.log.warn(`Forfeit failed (${duration}ms)`, { 
          tournamentId,
          playerAlias: playerAlias.trim(),
          reason,
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }

      fastify.log.info(`[FORFAIT] ✅ Forfeit processed successfully (${duration}ms)`, {
        tournamentId,
        playerAlias: playerAlias.trim(),
        reason,
        tournamentCancelled: result.tournamentCancelled,
        matchFound: result.matchFound
      });

      try {
        const sendToUserFn = (fastify as any).sendToUser;
        if (
          typeof sendToUserFn === 'function' &&
          result.matchFound &&
          result.opponentUserId &&
          result.gameId
        ) {
          sendToUserFn(result.opponentUserId, 'game:player_disconnected', {
            disconnectedPlayerId: result.forfeitingUserId || undefined,
            gameId: result.gameId
          });
        }
      } catch (notifyErr) {
        fastify.log.warn('[FORFAIT] Failed to notify opponent about disconnect:', notifyErr);
      }

      // Broadcast WebSocket
      try {
        const broadcastFn = (fastify as any).broadcastTournamentUpdate;
        if (broadcastFn) {
          if (result.tournamentCancelled) {
            broadcastFn(tournamentId, 'cancelled', {
              reason,
              message: 'Tournament cancelled by creator'
            });
          } else if (result.playerRemoved) {
            // player removed during waiting -> inform participants with updated list
            broadcastFn(tournamentId, 'player_left', {
              playerAlias: playerAlias.trim(),
              participants: result.participants,
              currentPlayers: result.currentPlayers,
              maxPlayers: result.maxPlayers,
              tournamentName: result.tournamentName,
              reason
            });
          } else if (result.matchFound) {
            broadcastFn(tournamentId, 'match_forfeited', {
              matchId: result.matchId,
              winnerAlias: result.winnerAlias,
              reason,
              round: result.round
            });
          }
        }
      } catch (broadcastError) {
        fastify.log.error('Failed to broadcast forfeit/participant update:', broadcastError);
      }

      // Si le round est complété par ce forfeit, générer le round suivant immédiatement
      try {
        if (result.matchFound && result.roundCompleted) {
          const gen = (fastify as any).generateNextRound;
          if (typeof gen === 'function') {
            await gen(tournamentId, result.round);
          } else {
            fastify.log.warn('[FORFAIT] generateNextRound not available on fastify instance');
          }
        }
      } catch (genErr) {
        fastify.log.error('[FORFAIT] Failed to generate next round after forfeit:', genErr);
      }

      return ok(reply, result);

    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`[FORFAIT] Error processing forfeit (${duration}ms):`, error);
      return err500(reply, error, 'Error processing forfeit');
    }
  });

  fastify.get('/:id/check-participation', async (
    request: FastifyRequest<{ Params: { id: string }, Querystring: CheckParticipationQuery }>, 
    reply
  ) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      const { userId } = request.query as any;
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'Invalid tournament ID');
      }
      
      // Accepter les userId négatifs (guests)
      if (!userId || !Number.isInteger(Number(userId)) || Number(userId) === 0) {
        return bad(reply, 400, 'Invalid user ID');
      }
      
      const numericUserId = Number(userId);
      
      fastify.log.info('Checking participation', { tournamentId, userId: numericUserId });

      const result = await withDb(async db => {
        const participation = await dbGet(db, `
          SELECT ta.tournament_id, t.name, t.status
          FROM tournament_aliases ta
          JOIN tournaments t ON ta.tournament_id = t.id
          WHERE ta.user_id = ? AND t.status IN ('waiting', 'active')
        `, [numericUserId]);
        
        if (!participation) {
          return {
            isInActiveTournament: false,
            canJoin: true
          };
        }
        
        if (participation.tournament_id === tournamentId) {
          return {
            isInActiveTournament: true,
            canJoin: true,
            currentTournament: {
              id: participation.tournament_id,
              name: participation.name,
              status: participation.status,
              isSameTournament: true
            }
          };
        }
        
        return {
          isInActiveTournament: true,
          canJoin: false,
          currentTournament: {
            id: participation.tournament_id,
            name: participation.name,
            status: participation.status,
            isSameTournament: false
          }
        };
      });

      const duration = Date.now() - startTime;
      
      fastify.log.info(`Participation check completed (${duration}ms)`, {
        tournamentId,
        userId: numericUserId,
        isInActiveTournament: result.isInActiveTournament,
        canJoin: result.canJoin
      });

      return ok(reply, result);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`Error checking participation (${duration}ms):`, error);
      return err500(reply, error, 'Error checking participation');
    }
  });

  fastify.post('/:id/start', async (request: FastifyRequest<{ Params: { id: string }, Body: StartTournamentBody }>, reply) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      const { creatorAlias } = request.body || ({} as any);
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'Invalid tournament ID');
      }

      if (!creatorAlias || typeof creatorAlias !== 'string' || creatorAlias.trim().length === 0) {
        return bad(reply, 400, 'Creator alias is required');
      }
      
      fastify.log.info('Starting tournament', { tournamentId, creatorAlias: creatorAlias.trim() });

      const result = await withDb(async db => {
        const tournament = await dbGet(db, `
          SELECT id, name, status, max_players FROM tournaments WHERE id = ?
        `, [tournamentId]);
        
        if (!tournament) {
          return { error: 'Tournament not found', code: 404 };
        }
        
        if (tournament.status !== 'waiting') {
          return { error: 'Tournament already started or finished', code: 400 };
        }
        
        const ownerCheck = await dbGet(db, `
          SELECT player_alias FROM tournament_aliases 
          WHERE tournament_id = ? AND is_owner = 1
        `, [tournamentId]);
        
        if (!ownerCheck || ownerCheck.player_alias !== creatorAlias.trim()) {
          fastify.log.warn(`Unauthorized start attempt`, {
            tournamentId,
            requestedBy: creatorAlias.trim(),
            actualOwner: ownerCheck?.player_alias || 'none'
          });
          return { error: 'Only the tournament creator can start the tournament', code: 403 };
        }
        
        const participantCount = await dbGet(db, `
          SELECT COUNT(*) AS count FROM tournament_aliases WHERE tournament_id = ?
        `, [tournamentId]);
        
        if (participantCount.count !== 4) {
          return { error: 'Tournament must have exactly 4 players to start', code: 400 };
        }
        
        const players = await dbAll(db, `
          SELECT player_alias 
          FROM tournament_aliases 
          WHERE tournament_id = ? 
          ORDER BY is_owner DESC, joined_at ASC
        `, [tournamentId]);
        
        if (players.length !== 4) {
          return { error: 'Exactly 4 players required', code: 400 };
        }
        
        fastify.log.info(`Starting tournament ${tournamentId} with 4 players:`, 
          players.map(p => p.player_alias));
        
        await dbRun(db, `
          UPDATE tournaments 
          SET status='active', started_at=CURRENT_TIMESTAMP, current_round=1, updated_at=CURRENT_TIMESTAMP 
          WHERE id=?
        `, [tournamentId]);
        
        await dbRun(db, `
          INSERT INTO tournament_matches_aliases 
            (tournament_id, round, player1_alias, player2_alias, status, created_at, updated_at)
          VALUES (?, 1, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [tournamentId, players[0].player_alias, players[1].player_alias]);
        
        await dbRun(db, `
          INSERT INTO tournament_matches_aliases 
            (tournament_id, round, player1_alias, player2_alias, status, created_at, updated_at)
          VALUES (?, 1, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [tournamentId, players[2].player_alias, players[3].player_alias]);

        await dbRun(db, `
          UPDATE tournament_matches_aliases
          SET p1_ready = 0, p2_ready = 0, ready_deadline = datetime('now', '+20 seconds')
          WHERE tournament_id = ? AND round = 1
        `, [tournamentId]);
        
        fastify.log.info(`✅ Round 1 matches created for tournament ${tournamentId}`);

        // VÉRIFIER que les pairings sont bien en base AVANT de broadcaster
        const verifyPairings = await dbAll(db, `
          SELECT id, player1_alias, player2_alias, ready_deadline
          FROM tournament_matches_aliases
          WHERE tournament_id = ? AND round = 1
        `, [tournamentId]);

        if (verifyPairings.length === 0) {
          throw new Error('Failed to create pairings');
        }

        fastify.log.info(`✅ Verified ${verifyPairings.length} pairings created with deadlines`)
        
        const updatedTournament = await dbGet(db, `
          SELECT * FROM tournaments WHERE id=?
        `, [tournamentId]);
        
        return {
          success: true,
          tournament: updatedTournament,
          participantCount: participantCount.count,
          matchesCreated: 2,
          players: players.map(p => p.player_alias)
        };
      });

      const duration = Date.now() - startTime;

      if (result.error) {
        fastify.log.warn(`Start tournament failed (${duration}ms)`, { 
          tournamentId, 
          creatorAlias: creatorAlias.trim(),
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }

      fastify.log.info(`✅ Tournament started successfully (${duration}ms)`, {
        tournamentId,
        creatorAlias: creatorAlias.trim(),
        participantCount: result.participantCount,
        matchesCreated: result.matchesCreated,
        newStatus: result.tournament.status
      });

      // BROADCASTER SEULEMENT APRÈS que les pairings soient vérifiés
      try {
        const broadcastFn = (fastify as any).broadcastTournamentUpdate;
        if (broadcastFn) {
          broadcastFn(tournamentId, 'started', {
            currentRound: 1,
            status: 'active',
            matchesCreated: result.matchesCreated,
            // Timestamp pour debugging
            startedAt: new Date().toISOString()
          });
        }
        
        // Message chat global
        const sendChatFn = (fastify as any).sendTournamentChatMessage;
        if (sendChatFn && result.players && result.players.length === 4) {
          const chatMessage = `🏆 Upcoming matches: ${result.players[0]} vs ${result.players[1]}, ${result.players[2]} vs ${result.players[3]}`;
          await sendChatFn(chatMessage);
          fastify.log.info(`✅ Tournament start chat message sent: ${chatMessage}`);
        }
      } catch (broadcastError) {
        fastify.log.error('Failed to broadcast tournament start:', broadcastError);
      }

      return ok(reply, {
        message: 'Tournament started successfully',
        tournament: result.tournament,
        matchesCreated: result.matchesCreated
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`Error starting tournament (${duration}ms):`, error);
      return err500(reply, error, 'Error starting tournament');
    }
  });

  fastify.get('/:id/bracket', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'Invalid tournament ID');
      }
      
      fastify.log.info('Fetching tournament bracket', { tournamentId });

      const result = await withDb(async db => {
        const tournament = await dbGet(db, `
          SELECT id, name, status, max_players, current_round, created_at, started_at, ended_at 
          FROM tournaments WHERE id = ?
        `, [tournamentId]);
        
        if (!tournament) {
          return { error: 'Tournament not found', code: 404 };
        }
        
        const participants = await dbAll(db, `
          SELECT tournament_id, user_id, player_alias, is_owner, joined_at
          FROM tournament_aliases
          WHERE tournament_id = ?
          ORDER BY is_owner DESC, joined_at ASC
        `, [tournamentId]);

        let champion: string | null = null;
        if (tournament.status === 'finished') {
			// Chercher le champion dans tournament_results au lieu de round 2
			const result = await dbGet(db, `
				SELECT player_alias 
				FROM tournament_results
				WHERE tournament_id = ? AND final_position = 1
				LIMIT 1
			`, [tournamentId]);
			
			champion = result?.player_alias || null;
          
          fastify.log.info('[BRACKET] Tournament finished, champion retrieved', {
            tournamentId,
            champion
          });

          // Libérer les alias des guests pour qu'ils soient réutilisables
          const guestTokenService = new GuestTokenService(db);
          const guestParticipants = participants.filter((p: any) => p.user_id && p.user_id < 0);
          
          for (const guest of guestParticipants) {
            try {
              // Récupérer le token du guest
              const guestSession = await new Promise<any>((resolve, reject) => {
                db.get(
                  `SELECT token FROM guest_sessions WHERE user_id = ? AND tournament_id = ?`,
                  [guest.user_id, tournamentId],
                  (err, row) => err ? reject(err) : resolve(row)
                );
              });
              
              if (guestSession?.token) {
                await guestTokenService.unlinkGuestFromTournament(guestSession.token);
                fastify.log.info('[BRACKET] ✅ Guest alias freed for reuse', {
                  userId: guest.user_id,
                  alias: guest.player_alias,
                  tournamentId
                });
              }
            } catch (error) {
              fastify.log.warn('[BRACKET] Failed to unlink guest from tournament', {
                userId: guest.user_id,
                error
              });
            }
          }
        }
        
        fastify.log.info(`Bracket data retrieved`, {
          tournamentId,
          tournamentStatus: tournament.status,
          participantsCount: participants.length,
          authenticatedPlayers: participants.filter((p: any) => p.user_id).length,
          guestPlayers: participants.filter((p: any) => !p.user_id).length,
          champion
        });
        
        return {
          success: true,
          tournament,
          participants,
          matches: [],
          champion
        };
      });

      const duration = Date.now() - startTime;

      if (result.error) {
        fastify.log.warn(`Fetch bracket failed (${duration}ms)`, { 
          tournamentId, 
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }

      fastify.log.info(`Tournament bracket fetched successfully (${duration}ms)`, {
        tournamentId,
        participantCount: result.participants.length,
        champion: result.champion
      });

      return ok(reply, {
        tournament: result.tournament,
        participants: result.participants,
        matches: result.matches,
        champion: result.champion
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`Error fetching bracket (${duration}ms):`, error);
      return err500(reply, error, 'Error fetching bracket');
    }
  });

  fastify.get('/:id/pairings', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const startTime = Date.now();
    
    try {
      const tournamentId = parseInt(request.params.id, 10);
      
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        return bad(reply, 400, 'Invalid tournament ID');
      }
      
      fastify.log.info('Fetching tournament pairings', { tournamentId });

      const result = await withDb(async db => {
        const tournament = await dbGet(db, `
          SELECT id, name, status, current_round FROM tournaments WHERE id = ?
        `, [tournamentId]);
        
        if (!tournament) {
          return { error: 'Tournament not found', code: 404 };
        }
        
        if (tournament.status !== 'active') {
          fastify.log.warn('Tournament not active', { 
            tournamentId, 
            status: tournament.status 
          });
          return {
            success: true,
            currentRound: tournament.current_round,
            matches: []
          };
        }

        // Relire les matchs du round courant, en exposant l’état "ready" + deadline
        const matches = await dbAll(db, `
          SELECT 
            tma.id AS matchId,
            tma.player1_alias,
            tma.player2_alias,
            tma.status,
            tma.winner_alias,
            tma.score1,
            tma.score2,
            COALESCE(tma.p1_ready, 0) AS p1_ready,
            COALESCE(tma.p2_ready, 0) AS p2_ready,
            tma.ready_deadline,
            ta1.user_id AS player1UserId,
            ta2.user_id AS player2UserId,
            gs1.token as player1GuestToken,
            gs2.token as player2GuestToken
          FROM tournament_matches_aliases tma
          LEFT JOIN tournament_aliases ta1 
            ON tma.tournament_id = ta1.tournament_id 
          AND tma.player1_alias = ta1.player_alias
          LEFT JOIN tournament_aliases ta2 
            ON tma.tournament_id = ta2.tournament_id 
            AND tma.player2_alias = ta2.player_alias
          LEFT JOIN guest_sessions gs1
            ON ta1.tournament_id = gs1.tournament_id
            AND ta1.player_alias = gs1.player_alias
            AND datetime(gs1.expires_at) > datetime('now')
          LEFT JOIN guest_sessions gs2
            ON ta2.tournament_id = gs2.tournament_id
            AND ta2.player_alias = gs2.player_alias
            AND datetime(gs2.expires_at) > datetime('now')
          WHERE tma.tournament_id = ? AND tma.round = ?
          ORDER BY tma.id ASC
        `, [tournamentId, tournament.current_round]);
        
        fastify.log.info('Pairings retrieved', {
          tournamentId,
          currentRound: tournament.current_round,
          matchesCount: matches.length
        });
        
        // Fonction helper pour calculer un guestId à partir d'un guestToken
        const getGuestId = (guestToken: string | null): number | null => {
          if (!guestToken) return null;
          // Utiliser le même algorithme que dans server.ts
          const hash = Math.abs(guestToken.split('_')[1].substring(0, 8).split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0));
          return -hash;  // Négatif pour les guests
        };
        
        return {
          success: true,
          currentRound: tournament.current_round,
          matches: matches.map(m => ({
            matchId: m.matchId,
            player1Alias: m.player1_alias,
            player2Alias: m.player2_alias,
            player1UserId: m.player1UserId || getGuestId(m.player1GuestToken),
            player2UserId: m.player2UserId || getGuestId(m.player2GuestToken),
            player1GuestToken: m.player1GuestToken || null,
            player2GuestToken: m.player2GuestToken || null,
            status: m.status,
            winnerAlias: m.winner_alias || null,
            score1: m.score1 ?? 0,
            score2: m.score2 ?? 0,
            p1Ready: !!m.p1_ready,
            p2Ready: !!m.p2_ready,
            readyDeadline: m.ready_deadline
          }))
        };
      });

      const duration = Date.now() - startTime;

      if (result.error) {
        fastify.log.warn(`Fetch pairings failed (${duration}ms)`, { 
          tournamentId, 
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }

      fastify.log.info(`Pairings fetched successfully (${duration}ms)`, {
        tournamentId,
        currentRound: result.currentRound,
        matchesCount: result.matches.length
      });

      return ok(reply, {
        currentRound: result.currentRound,
        matches: result.matches
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`Error fetching pairings (${duration}ms):`, error);
      return err500(reply, error, 'Error fetching pairings');
    }
  });

  // N'envoie PLUS de messages chat ici - c'est fait dans server.ts via generateNextRound()
  fastify.post('/match/:matchId/result', async (
    request: FastifyRequest<{ Params: { matchId: string }, Body: ReportMatchResultBody }>, 
    reply
  ) => {                                                  
    const startTime = Date.now();
    
    try {
      const matchId = parseInt(request.params.matchId, 10);
      const { winnerAlias, score1, score2 } = request.body || ({} as any);
      
      if (!Number.isInteger(matchId) || matchId <= 0) {
        return bad(reply, 400, 'Invalid match ID');
      }
      
      if (!winnerAlias || typeof winnerAlias !== 'string' || winnerAlias.trim().length === 0) {
        return bad(reply, 400, 'Winner alias is required');
      }
      
      fastify.log.info('Recording match result', {
        matchId,
        winnerAlias,
        score1: score1 || 0,
        score2: score2 || 0
      });

      const result = await withDb(async db => {
        const match = await dbGet(db, `
          SELECT id, tournament_id, round, player1_alias, player2_alias, status
          FROM tournament_matches_aliases
          WHERE id = ?
        `, [matchId]);
        
        if (!match) {
          return { error: 'Match not found', code: 404 };
        }
        
        if (match.status === 'finished') {
          return { error: 'Match already finished', code: 400 };
        }
        
        const tournamentId = match.tournament_id;
        const currentRound = match.round;
        
        await dbRun(db, `
          UPDATE tournament_matches_aliases
          SET winner_alias = ?, score1 = ?, score2 = ?, status = 'finished', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [winnerAlias.trim(), score1 || 0, score2 || 0, matchId]);
        
        fastify.log.info('✅ Match result saved', {
          matchId,
          tournamentId,
          round: currentRound,
          winner: winnerAlias
        });
        
        const player1UserId = await dbGet(db, `
          SELECT user_id FROM tournament_aliases 
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, match.player1_alias]);
        
        const player2UserId = await dbGet(db, `
          SELECT user_id FROM tournament_aliases 
          WHERE tournament_id = ? AND player_alias = ?
        `, [tournamentId, match.player2_alias]);
        
        if (player1UserId?.user_id) {
          const won = winnerAlias.trim() === match.player1_alias ? 1 : 0;
          await dbRun(db, `
            UPDATE user_stats 
            SET games_played = games_played + 1,
                games_won = games_won + ?,
                games_lost = games_lost + ?,
                total_points_scored = total_points_scored + ?,
                total_points_conceded = total_points_conceded + ?
            WHERE user_id = ?
          `, [won, 1 - won, score1 || 0, score2 || 0, player1UserId.user_id]);
        }
        
        if (player2UserId?.user_id) {
          const won = winnerAlias.trim() === match.player2_alias ? 1 : 0;
          await dbRun(db, `
            UPDATE user_stats 
            SET games_played = games_played + 1,
                games_won = games_won + ?,
                games_lost = games_lost + ?,
                total_points_scored = total_points_scored + ?,
                total_points_conceded = total_points_conceded + ?
            WHERE user_id = ?
          `, [won, 1 - won, score2 || 0, score1 || 0, player2UserId.user_id]);
        }
        
        // Cette route ne fait PLUS la génération de rounds - c'est géré par server.ts
        
        return {
          success: true,
          matchId,
          tournamentId,
          round: currentRound,
          winnerAlias: winnerAlias.trim()
        };
      });

      const duration = Date.now() - startTime;

      if (result.error) {
        fastify.log.warn(`Record result failed (${duration}ms)`, { 
          matchId,
          error: result.error 
        });
        return bad(reply, result.code, result.error);
      }

      fastify.log.info(`✅ Match result recorded successfully (${duration}ms)`, {
        matchId,
        tournamentId: result.tournamentId,
        winner: result.winnerAlias
      });

      // Broadcast WebSocket seulement
      try {
        const broadcastFn = (fastify as any).broadcastTournamentUpdate;
        if (broadcastFn) {
          broadcastFn(result.tournamentId, 'match_finished', {
            matchId: result.matchId,
            round: result.round,
            winnerAlias: result.winnerAlias
          });
        }
      } catch (broadcastError) {
        fastify.log.error('Failed to broadcast match result:', broadcastError);
      }

      return ok(reply, {
        message: 'Match result recorded successfully',
        matchId: result.matchId,
        tournamentId: result.tournamentId,
        round: result.round,
        winnerAlias: result.winnerAlias
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      fastify.log.error(`Error recording match result (${duration}ms):`, error);
      return err500(reply, error, 'Error recording match result');
    }
  });

  fastify.post<{ Params: { id: string; matchId: string } }>('/:id/match/:matchId/ready',async (request, reply) => {
		const tournamentId = parseInt(request.params.id, 10);
		const matchId = parseInt(request.params.matchId, 10);

		if (isNaN(tournamentId) || isNaN(matchId)) {
		return bad(reply, 400, 'Invalid IDs');
		}

		const { playerAlias } = request.body as { playerAlias: string };

		if (!playerAlias || typeof playerAlias !== 'string') {
		return bad(reply, 400, 'Player alias is required');
		}

		const db = getPooledConnection();

		try {
		// Récupérer le match
		const match = await dbGet(db, 
			`SELECT id, tournament_id, round, player1_alias, player2_alias, status, p1_ready, p2_ready, ready_deadline
			FROM tournament_matches_aliases
			WHERE id = ? AND tournament_id = ?`,
			[matchId, tournamentId]
		);

		if (!match) {
			return bad(reply, 404, 'Match not found');
		}

		if (match.status !== 'pending') {
			return bad(reply, 400, `Match is ${match.status}, cannot mark ready`);
		}

		// Vérifier que le joueur appartient bien à ce match
		const isPlayer1 = match.player1_alias === playerAlias.trim();
		const isPlayer2 = match.player2_alias === playerAlias.trim();

		if (!isPlayer1 && !isPlayer2) {
			return bad(reply, 403, 'You are not a participant in this match');
		}

		// Mettre à jour le flag ready
		const column = isPlayer1 ? 'p1_ready' : 'p2_ready';
		await dbRun(db, 
			`UPDATE tournament_matches_aliases 
			SET ${column} = 1, updated_at = CURRENT_TIMESTAMP 
			WHERE id = ?`,
			[matchId]
		);

		fastify.log.info('[READY] Player marked ready', {
			matchId,
			tournamentId,
			playerAlias,
			column
		});

		// Vérifier si les deux sont ready
		const updatedMatch = await dbGet(db, 
			`SELECT p1_ready, p2_ready FROM tournament_matches_aliases WHERE id = ?`,
			[matchId]
		);

		const bothReady = updatedMatch.p1_ready === 1 && updatedMatch.p2_ready === 1;

		if (bothReady) {
			// Les deux sont ready → Passer à 'active'
			await dbRun(db, 
			`UPDATE tournament_matches_aliases 
			SET status = 'active', updated_at = CURRENT_TIMESTAMP 
			WHERE id = ?`,
			[matchId]
			);

			fastify.log.info('[READY] Both players ready - match active', { matchId });

			try {
				const broadcastFn = (fastify as any).broadcastTournamentUpdate;
				if (broadcastFn) {
					broadcastFn(tournamentId, 'match_ready', {
						matchId,
						status: 'active',
						bothReady: true,
						round: match.round
					});
				}
			} catch (e) {
				fastify.log.error('[READY] Broadcast failed:', e);
			}

			return ok(reply, { 
			success: true, 
			matchId, 
			status: 'active', 
			bothReady: true 
			});
		}

		// Un seul ready → Attendre l'autre (ou deadline)
		return ok(reply, { 
			success: true, 
			matchId, 
			status: 'pending', 
			bothReady: false 
		});

		} catch (err: any) {
		fastify.log.error('[READY] Error:', err);
		return err500(reply, err, 'Error marking ready');
		}
	}
  );

  fastify.addHook('onClose', async () => {
    fastify.log.info('Cleaning up database connection pool');
    for (const [key, db] of dbConnectionPool) {
      try {
        db.close();
        fastify.log.debug(`Closed database connection: ${key}`);
      } catch (error) {
        fastify.log.warn(`Failed to close database connection ${key}:`, error);
      }
    }
    dbConnectionPool.clear();
    fastify.log.info('Database connection pool cleanup completed');
  });
}
