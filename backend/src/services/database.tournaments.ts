// backend/src/services/database.tournaments.ts

import sqlite3 from 'sqlite3';
import { Tournament, TournamentAlias, TournamentMatchAlias } from './database.types';

export class TournamentOperations {
	constructor(private db: sqlite3.Database) {}

	/* Exécute une requête de lecture et retourne la première ligne résultante */
	private dbGet(query: string, params: any[] = []): Promise<any> { 
		return new Promise((resolve, reject) => { 
			this.db.get(query, params, (err, row) => {
				if (err) reject(new Error(`Database query failed: ${err.message}`));
				else resolve(row);
			});
		});
	}

	/* Exécute une requête d'écriture et retourne l'ID et le nombre de modifications */
	private dbRun(query: string, params: any[] = []): Promise<{ lastID: number; changes: number }> { 
		return new Promise((resolve, reject) => { 
			this.db.run(query, params, function (err) { 
				if (err) reject(new Error(`Database operation failed: ${err.message}`));
				else resolve({ lastID: this.lastID, changes: this.changes });
			});
		});
	}

	/* Exécute une requête de lecture et retourne toutes les lignes résultantes */
	private dbAll(query: string, params: any[] = []): Promise<any[]> { 
		return new Promise((resolve, reject) => { 
			this.db.all(query, params, (err, rows) => {
				if (err) reject(new Error(`Database query failed: ${err.message}`));
				else resolve(rows || []);
			});
		});
	}

	/* Vérifie si un utilisateur est dans un tournoi actif */
	async isUserInActiveTournament(userId: number): Promise<boolean> {
		try {
			if (!Number.isInteger(userId) || userId <= 0) {
				return false;
			}

			const result = await this.dbGet(`
				SELECT 1 
				FROM tournament_aliases ta
				JOIN tournaments t ON ta.tournament_id = t.id
				WHERE ta.user_id = ? AND t.status IN ('waiting', 'active')
				LIMIT 1
			`, [userId]);

			return !!result;
		} catch (e) {
			console.error('[DB] ⚠️ isUserInActiveTournament error:', e);
			return false;
		}
	}

	/* Annule complètement un tournoi */
	async cancelTournament(tournamentId: number): Promise<void> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}

			console.log('[DB] [FORFAIT] Cancelling tournament:', tournamentId);

			// Marquer le tournoi comme annulé
			await this.dbRun(`
				UPDATE tournaments 
				SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, [tournamentId]);

			// Annuler tous les matchs non terminés
			await this.dbRun(`
				UPDATE tournament_matches_aliases
				SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
				WHERE tournament_id = ? AND status IN ('pending', 'active')
			`, [tournamentId]);

			console.log('[DB] [FORFAIT] ✅ Tournament cancelled successfully');
		} catch (e) {
			console.error('[DB] ⚠️ cancelTournament error:', e);
			throw e;
		}
	}

	/* Récupère les participants d'un tournoi */
	// async getTournamentParticipants(tournamentId: number): Promise<Array<{ user_id: number | null; player_alias: string }>> {
	// 	try {
	// 		return await this.dbAll(`
	// 			SELECT user_id, player_alias
	// 			FROM tournament_aliases
	// 			WHERE tournament_id = ?
	// 		`, [tournamentId]);
	// 	} catch (e) {
	// 		console.error('[DB] ⚠️ getTournamentParticipants error:', e);
	// 		return [];
	// 	}
	// }

	/* Vérifie si un alias est le créateur */
	async isOwnerAlias(tournamentId: number, playerAlias: string): Promise<boolean> {
		try {
			const result = await this.dbGet(`
				SELECT 1 
				FROM tournament_aliases
				WHERE tournament_id = ? AND player_alias = ? AND is_owner = 1
			`, [tournamentId, playerAlias.trim()]);

			return !!result;
		} catch (e) {
			console.error('[DB] ⚠️ isOwnerAlias error:', e);
			return false;
		}
	}

	/* Trouve le match actuel d'un joueur */
	async findCurrentMatch(tournamentId: number, playerAlias: string): Promise<TournamentMatchAlias | null> {
		try {
			const result = await this.dbGet(`
				SELECT *
				FROM tournament_matches_aliases
				WHERE tournament_id = ? 
				  AND (player1_alias = ? OR player2_alias = ?)
				  AND status IN ('pending', 'active')
				ORDER BY round DESC, id DESC
				LIMIT 1
			`, [tournamentId, playerAlias.trim(), playerAlias.trim()]);

			return result || null;
		} catch (e) {
			console.error('[DB] ⚠️ findCurrentMatch error:', e);
			return null;
		}
	}

	/* Déclare un forfait et détermine le gagnant */
	async declareForfeit(tournamentId: number, forfeitingAlias: string): Promise<{ winnerAlias: string | null; wasOwner: boolean }> {
		try {
			console.log('[DB] [FORFAIT] Declaring forfeit:', { tournamentId, forfeitingAlias });

			// Vérifier si c'est le créateur
			const isOwner = await this.isOwnerAlias(tournamentId, forfeitingAlias);
			
			if (isOwner) {
				console.log('[DB] [FORFAIT] Owner forfeited - cancelling entire tournament');
				await this.cancelTournament(tournamentId);
				return { winnerAlias: null, wasOwner: true };
			}

			// Trouver le match actuel
			const match = await this.findCurrentMatch(tournamentId, forfeitingAlias);
			
			if (!match) {
				console.warn('[DB] [FORFAIT] No active match found for player');
				return { winnerAlias: null, wasOwner: false };
			}

			// Déterminer le gagnant (l'adversaire)
			const winnerAlias = match.player1_alias === forfeitingAlias.trim() 
				? match.player2_alias 
				: match.player1_alias;

			if (!winnerAlias) {
				console.warn('[DB] [FORFAIT] No opponent found in match');
				return { winnerAlias: null, wasOwner: false };
			}

			console.log('[DB] [FORFAIT] Declaring opponent as winner:', winnerAlias);

			// Mettre à jour le match avec le gagnant par forfait
			await this.updateTournamentMatchAlias(match.id, winnerAlias, 0, 0);

			return { winnerAlias, wasOwner: false };
		} catch (e) {
			console.error('[DB] ⚠️ declareForfeit error:', e);
			throw e;
		}
	}

	/* Retire un joueur du tournoi (waiting uniquement) */
	// async removePlayerFromTournament(tournamentId: number, playerAlias: string): Promise<void> {
	// 	try {
	// 		const tournament = await this.getTournament(tournamentId);
	//
	// 		if (!tournament) {
	// 			throw new Error('Tournament not found');
	// 		}

	// 		if (tournament.status !== 'waiting') {
	// 			throw new Error('Cannot leave tournament that has already started');
	// 		}

	// 		// Vérifier si c'est le créateur
	// 		const isOwner = await this.isOwnerAlias(tournamentId, playerAlias);
	//
	// 		if (isOwner) {
	// 			// Si le créateur quitte, annuler le tournoi
	// 			console.log('[DB] [LEAVE] Owner leaving - cancelling tournament');
	// 			await this.cancelTournament(tournamentId);
	// 			return;
	// 		}

	// 		// Supprimer le joueur
	// 		await this.dbRun(`
	// 			DELETE FROM tournament_aliases
	// 			WHERE tournament_id = ? AND player_alias = ?
	// 		`, [tournamentId, playerAlias.trim()]);

	// 		console.log('[DB] [LEAVE] ✅ Player removed from tournament');
	// 	} catch (e) {
	// 		console.error('[DB] ⚠️ removePlayerFromTournament error:', e);
	// 		throw e;
	// 	}
	// }

	/* Crée un nouveau tournoi avec validation du nom, statut et nombre de joueurs */
	async createTournament(name: string, status: string = 'waiting', maxPlayers: number = 4): Promise<number> {
		console.log(`[DB] Creating tournament: ${name} (status: ${status}, maxPlayers: ${maxPlayers})`);
		
		try {
			if (!name || typeof name !== 'string') {
				throw new Error('Tournament name must be a non-empty string');
			}

			const trimmedName = name.trim();
			if (trimmedName.length === 0) {
				throw new Error('Tournament name cannot be empty after trimming');
			}
			if (trimmedName.length > 100) {
				throw new Error('Tournament name too long (max 100 characters)');
			}
			if (maxPlayers !== 4) {
				throw new Error('Only 4-player tournaments are supported');
			}
			if (!['waiting', 'active', 'finished', 'cancelled'].includes(status)) {
				throw new Error('Invalid tournament status');
			}

			const nameRegex = /^[a-zA-Z0-9\s\-_\.]+$/;
			if (!nameRegex.test(trimmedName)) {
				throw new Error('Tournament name contains invalid characters');
			}

			const existingRecent = await this.dbGet(`SELECT id FROM tournaments WHERE LOWER(TRIM(name)) = LOWER(?) AND created_at > datetime('now', '-1 hour')`, [trimmedName]);
			if (existingRecent) {
				throw new Error('A tournament with this name was created recently');
			}

			const result = await this.dbRun(`INSERT INTO tournaments (name, status, max_players, current_round, created_at, updated_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [trimmedName, status, maxPlayers]);
			
			console.log(`[DB] ✅ Tournament created:`, { id: result.lastID, name: trimmedName });
			return result.lastID;
		} catch (error: any) {
			console.error('[DB] ⚠️ createTournament failed:', error.message);
			throw new Error(`Failed to create tournament: ${error.message}`);
		}
	}

	/* Récupère les informations complètes d'un tournoi par son ID */
	async getTournament(tournamentId: number): Promise<Tournament | null> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}
			return (await this.dbGet('SELECT * FROM tournaments WHERE id = ?', [tournamentId])) || null;
		} catch (e) {
			console.error('[DB] ⚠️ getTournament error:', e);
			return null;
		}
	}

	/* Met à jour les propriétés d'un tournoi (status, round, dates) */
	async updateTournament(tournamentId: number, updates: Partial<Tournament>): Promise<void> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}

			const allowed = ['status', 'current_round', 'started_at', 'ended_at'];
			const fields = Object.keys(updates).filter(k => allowed.includes(k));
			
			if (!fields.length) return;

			if (updates.status && !['waiting', 'active', 'finished', 'cancelled'].includes(updates.status)) {
				throw new Error('Invalid tournament status');
			}
			if (updates.current_round && (!Number.isInteger(updates.current_round) || updates.current_round < 1)) {
				throw new Error('Invalid current round');
			}
			
			const setClause = fields.map(f => `${f} = ?`).join(', ');
			const values = fields.map(f => (updates as any)[f]);
			values.push(tournamentId);
			
			const result = await this.dbRun(`UPDATE tournaments SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
			
			if (result.changes === 0) {
				throw new Error('Tournament not found');
			}
		} catch (e) {
			console.error('[DB] ⚠️ updateTournament error:', e);
			throw e;
		}
	}

	/* Récupère la liste des tournois en attente avec places disponibles */
	async getOpenTournaments(limit: number = 20): Promise<Array<Tournament & { current_players: number }>> {
		try {
			if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
				limit = 20;
			}

			return await this.dbAll(`
				SELECT 
					t.id, t.name, t.status, t.max_players, t.current_round, t.created_at, t.started_at, t.ended_at, t.updated_at,
					COALESCE(COUNT(ta.id), 0) AS current_players
				FROM tournaments t
				LEFT JOIN tournament_aliases ta ON t.id = ta.tournament_id
				WHERE t.status = 'waiting'
				GROUP BY t.id
				HAVING current_players < t.max_players
				ORDER BY t.created_at DESC
				LIMIT ?
			`, [limit]);
		} catch (e) {
			console.error('[DB] ⚠️ getOpenTournaments error:', e);
			return [];
		}
	}

	/* Ajoute un joueur au tournoi avec son alias, vérifie les contraintes et la disponibilité */
	async addTournamentAlias(tournamentId: number, playerAlias: string, isOwner: boolean = false, userId?: number | null): Promise<void> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}
			if (!playerAlias || typeof playerAlias !== 'string') {
				throw new Error('Player alias must be a non-empty string');
			}

			const trimmedPlayerAlias = playerAlias.trim();
			if (trimmedPlayerAlias.length === 0 || trimmedPlayerAlias.length > 50) {
				throw new Error('Invalid player alias length');
			}
			
			const aliasRegex = /^[a-zA-Z0-9\-_\.]+$/;
			if (!aliasRegex.test(trimmedPlayerAlias)) {
				throw new Error('Player alias contains invalid characters');
			}

			const tournament = await this.getTournament(tournamentId);
			if (!tournament) {
				throw new Error('Tournament not found');
			}
			if (tournament.status !== 'waiting') {
				throw new Error('Cannot join tournament that is not waiting');
			}

			const existingAlias = await this.aliasExistsInTournament(tournamentId, trimmedPlayerAlias);
			if (existingAlias) {
				throw new Error('This alias is already taken in this tournament');
			}

			const currentCount = await this.getTournamentAliasCount(tournamentId);
			if (currentCount >= 4) {
				throw new Error('Tournament is full (4/4 players)');
			}
			if (currentCount === 0 && !isOwner) {
				throw new Error('First participant must be the owner');
			}
			if (currentCount > 0 && isOwner) {
				throw new Error('Only the first participant can be the owner');
			}

			if (userId !== undefined && userId !== null) {
				if (!Number.isInteger(userId) || userId <= 0) {
					throw new Error('Invalid user ID');
				}

				const userExists = await this.dbGet('SELECT id FROM users WHERE id = ?', [userId]);
				if (!userExists) {
					throw new Error('User not found');
				}

				// Vérifier participation active
				const activeParticipation = await this.isUserInActiveTournament(userId);
				if (activeParticipation) {
					throw new Error('You are already in another active tournament');
				}
			}

			await this.dbRun(`
				INSERT INTO tournament_aliases (tournament_id, user_id, player_alias, is_owner, joined_at) 
				VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
			`, [tournamentId, userId || null, trimmedPlayerAlias, isOwner ? 1 : 0]);
			
			console.log(`[DB] ✅ Tournament alias added:`, { 
				tournamentId, 
				alias: trimmedPlayerAlias, 
				isOwner,
				userId: userId || 'guest',
				mode: userId ? 'authenticated' : 'guest'
			});
		} catch (e) {
			console.error('[DB] ⚠️ addTournamentAlias error:', e);
			throw e;
		}
	}

	/* Récupère tous les alias (pseudonymes) des participants d'un tournoi */
	async getTournamentAliases(tournamentId: number): Promise<TournamentAlias[]> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}

			return await this.dbAll(`
				SELECT tournament_id, user_id, player_alias, is_owner, joined_at
				FROM tournament_aliases
				WHERE tournament_id = ?
				ORDER BY is_owner DESC, joined_at ASC
			`, [tournamentId]);
		} catch (e) {
			console.error('[DB] ⚠️ getTournamentAliases error:', e);
			return [];
		}
	}

	/* Compte le nombre de participants inscrits dans un tournoi */
	async getTournamentAliasCount(tournamentId: number): Promise<number> {
		try {
			const result = await this.dbGet(`SELECT COUNT(*) as count FROM tournament_aliases WHERE tournament_id = ?`, [tournamentId]);
			return result?.count || 0;
		} catch (e) {
			console.error('[DB] ⚠️ getTournamentAliasCount error:', e);
			return 0;
		}
	}

	/* Vérifie si un alias existe déjà dans un tournoi donné */
	async aliasExistsInTournament(tournamentId: number, playerAlias: string): Promise<boolean> {
		try {
			const result = await this.dbGet(`SELECT id FROM tournament_aliases WHERE tournament_id = ? AND player_alias = ?`, [tournamentId, playerAlias.trim()]);
			return !!result;
		} catch (e) {
			return false;
		}
	}

	/* Récupère l'ID utilisateur associé à un alias dans un tournoi spécifique */
	async getUserIdByAlias(tournamentId: number, playerAlias: string): Promise<number | null> {
		try {
			const result = await this.dbGet(`
				SELECT user_id 
				FROM tournament_aliases 
				WHERE tournament_id = ? AND player_alias = ?
			`, [tournamentId, playerAlias.trim()]);
			return result?.user_id || null;
		} catch (e) {
			console.error('[DB] ⚠️ getUserIdByAlias error:', e);
			return null;
		}
	}

	/* Crée un nouveau match de tournoi avec les alias des joueurs */
	async createTournamentMatchAlias(tournamentId: number, round: number, player1Alias: string, player2Alias?: string, status: string = 'pending'): Promise<number> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}
			if (!Number.isInteger(round) || round < 1) {
				throw new Error('Invalid round number');
			}
			if (!player1Alias || player1Alias.trim().length === 0) {
				throw new Error('Player 1 alias cannot be empty');
			}
			if (!['pending', 'active', 'finished', 'cancelled'].includes(status)) {
				throw new Error('Invalid match status');
			}

			const result = await this.dbRun(`
				INSERT INTO tournament_matches_aliases (tournament_id, round, player1_alias, player2_alias, status, created_at, updated_at) 
				VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			`, [tournamentId, round, player1Alias.trim(), player2Alias?.trim() || null, status]);
			
			console.log(`[DB] ✅ Tournament match created:`, {
				matchId: result.lastID,
				tournamentId,
				round,
				player1: player1Alias.trim(),
				player2: player2Alias?.trim() || 'TBD'
			});
			
			return result.lastID;
		} catch (e) {
			console.error('[DB] ⚠️ createTournamentMatchAlias error:', e);
			throw e;
		}
	}

	/* Met à jour un match avec le gagnant et les scores, enregistre dans games et user_stats */
	async updateTournamentMatchAlias(matchId: number, winnerAlias: string, score1?: number, score2?: number): Promise<{ tournamentId: number; round: number }> {
		try {
			if (!Number.isInteger(matchId) || matchId <= 0) {
				throw new Error('Invalid match ID');
			}
			if (!winnerAlias || winnerAlias.trim().length === 0) {
				throw new Error('Winner alias cannot be empty');
			}

			console.log(`[DB] Updating match ${matchId} with winner: ${winnerAlias}`);

			const match = await this.dbGet(`
				SELECT tournament_id, round, player1_alias, player2_alias 
				FROM tournament_matches_aliases 
				WHERE id = ?
			`, [matchId]);

			if (!match) {
				throw new Error('Match not found');
			}

			const tournamentId = match.tournament_id;
			const round = match.round;

			let query = `UPDATE tournament_matches_aliases SET winner_alias = ?, status = 'finished', updated_at = CURRENT_TIMESTAMP`;
			const params: any[] = [winnerAlias.trim()];
			
			if (typeof score1 === 'number' && typeof score2 === 'number') {
				if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0) {
					throw new Error('Scores must be non-negative integers');
				}
				query += `, score1 = ?, score2 = ?`;
				params.push(score1, score2);
			}
			
			query += ` WHERE id = ?`;
			params.push(matchId);
			
			const result = await this.dbRun(query, params);
			if (result.changes === 0) {
				throw new Error('Match not found');
			}

			const player1Alias = match.player1_alias;
			const player2Alias = match.player2_alias;

			const player1UserId = await this.getUserIdByAlias(tournamentId, player1Alias);
			const player2UserId = await this.getUserIdByAlias(tournamentId, player2Alias);

			// N'enregistrer le match dans 'games' QUE si les DEUX joueurs sont des users (pas de guests)
			if (player1UserId && player2UserId) {
				const winnerId = winnerAlias.trim() === player1Alias ? player1UserId : player2UserId;
				
				await this.dbRun(`
					INSERT INTO games (player1_id, player2_id, winner_id, player1_score, player2_score, game_mode, tournament_match_id, created_at)
					VALUES (?, ?, ?, ?, ?, 'tournament', ?, CURRENT_TIMESTAMP)
				`, [
					player1UserId,
					player2UserId,
					winnerId,
					score1 || 0,
					score2 || 0,
					matchId
				]);

				console.log(`[DB] ✅ Game recorded for tournament match ${matchId}`);
			} else {
				console.log(`[DB] ⚠️ Match ${matchId} involves guest(s), skipping games table insert`);
			}

			if (player1UserId) {
				const won = winnerAlias.trim() === player1Alias ? 1 : 0;
				const lost = won ? 0 : 1;
				await this.dbRun(`
					UPDATE user_stats 
					SET games_played = games_played + 1,
					    games_won = games_won + ?,
					    games_lost = games_lost + ?,
					    total_points_scored = total_points_scored + ?,
					    total_points_conceded = total_points_conceded + ?
					WHERE user_id = ?
				`, [won, lost, score1 || 0, score2 || 0, player1UserId]);
			}

			if (player2UserId) {
				const won = winnerAlias.trim() === player2Alias ? 1 : 0;
				const lost = won ? 0 : 1;
				await this.dbRun(`
					UPDATE user_stats 
					SET games_played = games_played + 1,
					    games_won = games_won + ?,
					    games_lost = games_lost + ?,
					    total_points_scored = total_points_scored + ?,
					    total_points_conceded = total_points_conceded + ?
					WHERE user_id = ?
				`, [won, lost, score2 || 0, score1 || 0, player2UserId]);
			}

			return { tournamentId, round };

		} catch (e) {
			console.error('[DB] ⚠️ updateTournamentMatchAlias error:', e);
			throw e;
		}
	}

	/* Récupère tous les matchs d'un tournoi, optionnellement filtrés par round */
	async getTournamentMatchesAliases(tournamentId: number, round?: number): Promise<TournamentMatchAlias[]> {
		try {
			let query = `SELECT * FROM tournament_matches_aliases WHERE tournament_id = ?`;
			const params: any[] = [tournamentId];
			
			if (typeof round === 'number' && round > 0) {
				query += ` AND round = ?`;
				params.push(round);
			}
			
			query += ` ORDER BY round ASC, id ASC`;
			return await this.dbAll(query, params);
		} catch (e) {
			console.error('[DB] ⚠️ getTournamentMatchesAliases error:', e);
			return [];
		}
	}

	// async getCurrentRoundPairings(tournamentId: number, currentRound: number): Promise<any[]> {
	// 	try {
	// 		if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
	// 			throw new Error('Invalid tournament ID');
	// 		}
	// 		if (!Number.isInteger(currentRound) || currentRound < 1) {
	// 			throw new Error('Invalid round number');
	// 		}

	// 		const matches = await this.dbAll(`
	// 			SELECT
	// 				tma.id as matchId,
	// 				tma.player1_alias,
	// 				tma.player2_alias,
	// 				tma.status,
	// 				ta1.user_id as player1UserId,
	// 				ta2.user_id as player2UserId
	// 			FROM tournament_matches_aliases tma
	// 			LEFT JOIN tournament_aliases ta1
	// 				ON tma.tournament_id = ta1.tournament_id
	// 				AND tma.player1_alias = ta1.player_alias
	// 			LEFT JOIN tournament_aliases ta2
	// 				ON tma.tournament_id = ta2.tournament_id
	// 				AND tma.player2_alias = ta2.player_alias
	// 			WHERE tma.tournament_id = ? AND tma.round = ?
	// 			ORDER BY tma.id ASC
	// 		`, [tournamentId, currentRound]);

	// 		return matches;
	// 	} catch (e) {
	// 		console.error('[DB] ⚠️ getCurrentRoundPairings error:', e);
	// 		return [];
	// 	}
	// }

	/* Compte le nombre de matchs en attente ou actifs pour un round donné */
	async getPendingMatchesCount(tournamentId: number, round: number): Promise<number> {
		try {
			const result = await this.dbGet(`SELECT COUNT(*) as count FROM tournament_matches_aliases WHERE tournament_id = ? AND round = ? AND status IN ('pending', 'active')`, [tournamentId, round]);
			return result?.count || 0;
		} catch (e) {
			console.error('[DB] ⚠️ getPendingMatchesCount error:', e);
			return 0;
		}
	}

	/* Récupère la liste des alias gagnants d'un round spécifique */
	async getRoundWinners(tournamentId: number, round: number): Promise<string[]> {
		try {
			const results = await this.dbAll(`SELECT winner_alias FROM tournament_matches_aliases WHERE tournament_id = ? AND round = ? AND status = 'finished' ORDER BY id ASC`, [tournamentId, round]);
			
			return results
				.map(r => r.winner_alias)
				.filter((alias): alias is string => alias !== null && alias !== undefined);
		} catch (e) {
			console.error('[DB] ⚠️ getRoundWinners error:', e);
			return [];
		}
	}

	/* Enregistre le résultat final d'un joueur et met à jour ses statistiques de tournoi */
	async saveTournamentResultAlias(tournamentId: number, playerAlias: string, finalPosition: number): Promise<void> {
		try {
			if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
				throw new Error('Invalid tournament ID');
			}
			if (!playerAlias || playerAlias.trim().length === 0) {
				throw new Error('Player alias cannot be empty');
			}
			if (!Number.isInteger(finalPosition) || finalPosition < 1 || finalPosition > 4) {
				throw new Error('Final position must be between 1 and 4');
			}

			const userId = await this.getUserIdByAlias(tournamentId, playerAlias.trim());

			await this.dbRun(`
				INSERT INTO tournament_results (tournament_id, user_id, player_alias, final_position) 
				VALUES (?, ?, ?, ?)
			`, [tournamentId, userId || null, playerAlias.trim(), finalPosition]);

			if (userId) {
				const isWinner = finalPosition === 1;
				await this.dbRun(`
					UPDATE user_stats 
					SET tournaments_played = tournaments_played + 1,
					    tournaments_won = tournaments_won + ?
					WHERE user_id = ?
				`, [isWinner ? 1 : 0, userId]);

				console.log(`[DB] ✅ Tournament stats updated for ${playerAlias}`);
			}
		} catch (e) {
			console.error('[DB] ⚠️ saveTournamentResultAlias error:', e);
			throw e;
		}
	}

	/* Récupère l'historique des tournois d'un joueur par son alias */
	async getTournamentHistoryByAlias(playerAlias: string, limit: number = 10): Promise<Array<any>> {
		try {
			if (!playerAlias || playerAlias.trim().length === 0) {
				return [];
			}
			if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
				limit = 10;
			}

			return await this.dbAll(`SELECT tournament_id, final_position, created_at FROM tournament_results WHERE player_alias = ? ORDER BY created_at DESC LIMIT ?`, [playerAlias.trim(), limit]);
		} catch (e) {
			return [];
		}
	}

	/* Récupère l'historique des tournois d'un utilisateur avec détails des adversaires */
	async getUserTournamentHistory(userId: number, limit: number = 10): Promise<Array<any>> {
		try {
			if (!Number.isInteger(userId) || userId <= 0) {
				return [];
			}
			if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
				limit = 10;
			}

			const results = await this.dbAll(`
				SELECT 
					tr.tournament_id,
					t.name as tournament_name,
					tr.player_alias,
					tr.final_position,
					tr.created_at,
					t.created_at as tournament_date
				FROM tournament_results tr
				JOIN tournaments t ON tr.tournament_id = t.id
				WHERE tr.user_id = ?
				ORDER BY tr.created_at DESC
				LIMIT ?
			`, [userId, limit]);

			for (const result of results) {
				const opponents = await this.dbAll(`
					SELECT ta.player_alias, ta.user_id
					FROM tournament_aliases ta
					WHERE ta.tournament_id = ? AND ta.player_alias != ?
				`, [result.tournament_id, result.player_alias]);

				result.opponents = opponents;
			}

			return results;
		} catch (e) {
			console.error('[DB] ⚠️ getUserTournamentHistory error:', e);
			return [];
		}
	}

	/* Méthode legacy ignorée en mode REST (utiliser saveTournamentResultAlias) */
	async saveTournamentResult(tournamentId: string, userId: number, finalPosition: number): Promise<void> {
		console.warn(`[DB] Legacy saveTournamentResult called - ignored in REST mode`);
	}

	/* Met à jour les statistiques de tournoi d'un utilisateur (parties jouées et victoires) */
	async updateTournamentStats(userId: number, isWinner: boolean): Promise<void> {
		try {
			if (!Number.isInteger(userId) || userId <= 0) {
				throw new Error('Invalid user ID');
			}
			await this.dbRun(`UPDATE user_stats SET tournaments_played = tournaments_played + 1, tournaments_won = tournaments_won + ? WHERE user_id = ?`, [isWinner ? 1 : 0, userId]);
		} catch (e) {
			console.error('[DB] ⚠️ updateTournamentStats error:', e);
			throw e;
		}
	}
}