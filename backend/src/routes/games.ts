// backend/src/routes/games.ts

import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import sqlite3 from 'sqlite3';
import path from 'path';

interface StartTournamentMatchBody { tournamentId: number; matchId: number }
interface ReportGameResultBody { tournamentId: number; matchId: number; winnerId: number; score1: number; score2: number }

const dbPath = path.join(process.cwd(), 'database', 'pong.db');

/* Routes de jeux (tournois & matchs) */
export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {
  // ==== Helpers compacts ====
  const ok = (reply: FastifyReply, payload: any) => reply.send(payload);
  const bad = (reply: FastifyReply, code: number, message: string) => reply.code(code).send({ error: message });
  const err500 = (reply: FastifyReply, e: any, tag: string) => { fastify.log.error(tag, e); reply.code(500).send({ error: 'Internal server error' }) };
  const dbGet = (sql: string, params: any[]) => new Promise<any>((resolve, reject) => { const db = new sqlite3.Database(dbPath); db.get(sql, params, (err, row) => { db.close(); err ? reject(err) : resolve(row) }) });

  /* GET /status — Retourne le statut général du serveur de jeu */
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => ok(reply, { status: 'Game server is running', timestamp: new Date().toISOString(), endpoints: ['GET /api/games/status','POST /api/games/tournament-match/start','POST /api/games/tournament-match/report','GET /api/games/tournament-match/:tournamentId/:matchId'] }));

  /* POST /tournament-match/start — Démarre un match de tournoi spécifique */
  fastify.post('/tournament-match/start', async (request: FastifyRequest<{ Body: StartTournamentMatchBody }>, reply: FastifyReply) => {
    const { tournamentId, matchId } = request.body; if (!tournamentId || !matchId) return bad(reply,400,'tournamentId and matchId are required');
    try {
      // Vérifier que le match existe et est en attente
      const match = await dbGet(`SELECT m.*, t.status as tournament_status,
                u1.username as player1_name, u2.username as player2_name
         FROM tournament_matches m
         JOIN tournaments t ON t.id = m.tournament_id
         LEFT JOIN users u1 ON u1.id = m.player1_id
         LEFT JOIN users u2 ON u2.id = m.player2_id
         WHERE m.tournament_id = ? AND m.id = ?`, [tournamentId, matchId]);
      if (!match) return bad(reply,404,'Match not found');
      if (match.tournament_status !== 'active') return bad(reply,400,'Tournament is not active');
      if (match.status !== 'pending') return bad(reply,400,'Match is not pending');
      // Match valide, renvoyer les infos pour le frontend
      return ok(reply,{ success:true, match:{ id:match.id, tournamentId:match.tournament_id, round:match.round, player1:{ id:match.player1_id, name:match.player1_name || 'Player 1' }, player2:{ id:match.player2_id, name:match.player2_name || 'Player 2' }, status:match.status }, message:'Match ready to start' });
    } catch (e:any) { return err500(reply, e, 'Error fetching match:') }
  });

  /* POST /tournament-match/report — Reporte le résultat d'un match de tournoi terminé */
  fastify.post('/tournament-match/report', async (request: FastifyRequest<{ Body: ReportGameResultBody }>, reply: FastifyReply) => {
    const { tournamentId, matchId, winnerId, score1, score2 } = request.body;
    if (!tournamentId || !matchId || !winnerId || score1 === undefined || score2 === undefined) return bad(reply,400,'All fields (tournamentId, matchId, winnerId, score1, score2) are required');
    try {
      // Utiliser l'endpoint de tournoi existant pour reporter le résultat
      const reportResponse = await fetch(`http://localhost:3443/api/tournaments/${tournamentId}/report`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ matchId, winnerId, score1, score2 }) });
      const reportData = await reportResponse.json(); if (!reportResponse.ok) return reply.code(reportResponse.status).send(reportData);
      fastify.log.info(`Match ${matchId} completed: Winner ${winnerId}, Score ${score1}-${score2}`);
      return ok(reply,{ success:true, message:'Match result reported successfully', result:reportData });
    } catch (e:any) { fastify.log.error('Error reporting match result:', e); return bad(reply,500,'Failed to report match result') }
  });

  /* GET /tournament-match/:tournamentId/:matchId — Récupère les détails d'un match spécifique */
  fastify.get('/tournament-match/:tournamentId/:matchId', async (request: FastifyRequest<{ Params: { tournamentId: string; matchId: string } }>, reply: FastifyReply) => {
    const tournamentId = parseInt(request.params.tournamentId, 10); const matchId = parseInt(request.params.matchId, 10);
    if (isNaN(tournamentId) || isNaN(matchId)) return bad(reply,400,'Invalid tournamentId or matchId');
    try {
      const match = await dbGet(`SELECT m.*, t.name as tournament_name, t.status as tournament_status,
                u1.username as player1_name, u2.username as player2_name,
                uw.username as winner_name
         FROM tournament_matches m
         JOIN tournaments t ON t.id = m.tournament_id
         LEFT JOIN users u1 ON u1.id = m.player1_id
         LEFT JOIN users u2 ON u2.id = m.player2_id
         LEFT JOIN users uw ON uw.id = m.winner_id
         WHERE m.tournament_id = ? AND m.id = ?`, [tournamentId, matchId]);
      if (!match) return bad(reply,404,'Match not found');
      return ok(reply,{ match:{ id:match.id, tournamentId:match.tournament_id, tournamentName:match.tournament_name, round:match.round, status:match.status, player1:{ id:match.player1_id, name:match.player1_name || 'Player 1' }, player2:{ id:match.player2_id, name:match.player2_name || 'Player 2' }, winner: match.winner_id ? { id:match.winner_id, name:match.winner_name } : null, score1:match.score1, score2:match.score2 } });
    } catch (e:any) { return err500(reply, e, 'Error fetching match details:') }
  });

  /* POST /cleanup — Nettoie les éléments obsolètes liés aux tournois */
  fastify.post('/cleanup', async (request: FastifyRequest, reply: FastifyReply) => {
    const db = new sqlite3.Database(dbPath);
    return await new Promise<void>((resolve) => {
      db.serialize(() => {
        // Supprimer les tournois en attente depuis plus de 2h
        db.run(`DELETE FROM tournaments 
           WHERE status = 'waiting' 
           AND created_at < datetime('now', '-2 hours')`, (err) => { if (err) fastify.log.error('Error cleaning old tournaments:', err); else fastify.log.info('Cleaned up old waiting tournaments') });
        // Marquer comme abandonnés les tournois actifs sans activité depuis 1h
        db.run(`UPDATE tournaments 
           SET status = 'abandoned' 
           WHERE status = 'active' 
           AND started_at < datetime('now', '-1 hour')
           AND id NOT IN (
             SELECT DISTINCT tournament_id 
             FROM tournament_matches 
             WHERE status = 'finished' 
             AND tournament_id IS NOT NULL
           )`, (err) => { db.close(); if (err) { fastify.log.error('Error marking abandoned tournaments:', err); reply.code(500).send({ error: 'Cleanup failed' }) } else ok(reply,{ success:true, message:'Cleanup completed successfully' }); resolve() });
      });
    });
  });

  fastify.log.info('🎮 Game routes registered');
}
