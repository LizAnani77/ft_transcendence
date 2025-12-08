// backend/src/services/database.users.ts

import sqlite3 from 'sqlite3';
import { User, UserStats, LeaderboardEntry } from './database.types';
import { OAuthAccount } from './database.types';

/* Classe gérant toutes les opérations liées aux utilisateurs */
export class UserOperations {
	constructor(private db: sqlite3.Database) {}

	/* Exécute une requête de lecture et retourne la première ligne résultante avec logging */
	private dbGet(query: string, params: any[] = []): Promise<any> { 
		return new Promise((resolve, reject) => { 
			const startTime = Date.now();
			this.db.get(query, params, (err, row) => {
				const duration = Date.now() - startTime;
				if (err) {
					console.error(`[DB] dbGet failed (${duration}ms):`, { error: err.message, query: query.substring(0, 100) + '...', paramsCount: params.length });
					reject(new Error(`Database query failed: ${err.message}`));
				} else {
					console.debug(`[DB] dbGet success (${duration}ms):`, { query: query.substring(0, 50) + '...', hasResult: !!row });
					resolve(row);
				}
			});
		});
	}

	/* Exécute une requête d'écriture et retourne l'ID et le nombre de modifications avec logging */
	private dbRun(query: string, params: any[] = []): Promise<{ lastID: number; changes: number }> { 
		return new Promise((resolve, reject) => { 
			const startTime = Date.now();
			this.db.run(query, params, function (err) { 
				const duration = Date.now() - startTime;
				if (err) {
					console.error(`[DB] dbRun failed (${duration}ms):`, { error: err.message, query: query.substring(0, 100) + '...', paramsCount: params.length });
					reject(new Error(`Database operation failed: ${err.message}`));
				} else {
					console.debug(`[DB] dbRun success (${duration}ms):`, { query: query.substring(0, 50) + '...', lastID: this.lastID, changes: this.changes });
					resolve({ lastID: this.lastID, changes: this.changes });
				}
			});
		});
	}

	/* Exécute une requête de lecture et retourne toutes les lignes résultantes avec logging */
	private dbAll(query: string, params: any[] = []): Promise<any[]> { 
		return new Promise((resolve, reject) => { 
			const startTime = Date.now();
			this.db.all(query, params, (err, rows) => {
				const duration = Date.now() - startTime;
				if (err) {
					console.error(`[DB] dbAll failed (${duration}ms):`, { error: err.message, query: query.substring(0, 100) + '...', paramsCount: params.length });
					reject(new Error(`Database query failed: ${err.message}`));
				} else {
					console.debug(`[DB] dbAll success (${duration}ms):`, { query: query.substring(0, 50) + '...', rowCount: rows?.length || 0 });
					resolve(rows || []);
				}
			});
		});
	}

	/* Crée un nouvel utilisateur avec ses statistiques et retourne l'objet utilisateur */
	async createUser(username: string, password_hash: string, email?: string): Promise<User> {
		console.log(`[DB] Creating user: ${username}`);
		const query = `INSERT INTO users (username, password_hash, email, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
		try {
			const result = await this.dbRun(query, [username, password_hash, email ?? null]); 
			await this.createUserStats(result.lastID);
			const user = await this.getUserById(result.lastID); 
			if (!user) throw new Error('User created but not found');
			console.log(`[DB] ✅ User created: ${username} (ID: ${result.lastID})`); 
			return user;
		} catch (error: any) { 
			if (error.message?.includes('UNIQUE constraint failed')) {
				throw new Error("Username or email already taken");
			}
			console.error('[DB] createUser error:', error);
			throw new Error(`Failed to create user: ${error.message}`);
		}
	}

	/* Récupère un utilisateur par son nom d'utilisateur */
	async getUserByUsername(username: string): Promise<User | null> { 
		try { return (await this.dbGet('SELECT * FROM users WHERE username = ?', [username])) || null; } 
		catch (e) { console.error("Error getting user by username:", e); return null; } 
	}

	/* Récupère un utilisateur par son adresse email */
	async getUserByEmail(email: string): Promise<User | null> { 
		try { return (await this.dbGet('SELECT * FROM users WHERE email = ?', [email])) || null; } 
		catch (e) { console.error("Error getting user by email:", e); return null; } 
	}

	/* Récupère un utilisateur via son compte OAuth (provider et ID externe) */
	async getUserByOAuth(provider: string, providerUserId: string): Promise<User | null> {
		const sql = `
			SELECT u.* FROM oauth_accounts oa
			JOIN users u ON oa.user_id = u.id
			WHERE oa.provider = ? AND oa.provider_user_id = ?
			LIMIT 1
		`;
		try { return (await this.dbGet(sql, [provider, providerUserId])) || null; }
		catch (e) { console.error('Error getting user by oauth identifier:', e); return null; }
	}

	/* Crée ou met à jour un compte OAuth lié à un utilisateur */
	async upsertOAuthAccount(params: {
		userId: number;
		provider: string;
		providerUserId: string;
		accessToken?: string | null;
		refreshToken?: string | null;
		tokenExpiresAt?: string | null;
	}): Promise<void> {
		const sql = `
			INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, token_expires_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT(provider, provider_user_id) DO UPDATE SET
				user_id = excluded.user_id,
				access_token = excluded.access_token,
				refresh_token = excluded.refresh_token,
				token_expires_at = excluded.token_expires_at,
				updated_at = CURRENT_TIMESTAMP
		`;
		try {
			await this.dbRun(sql, [
				params.userId,
				params.provider,
				params.providerUserId,
				params.accessToken ?? null,
				params.refreshToken ?? null,
				params.tokenExpiresAt ?? null
			]);
		} catch (e) {
			console.error('Error upserting oauth account:', e);
			throw e;
		}
	}

	/* Récupère les informations d'un compte OAuth par provider et ID externe */
	async getOAuthAccount(provider: string, providerUserId: string): Promise<OAuthAccount | null> {
		try { 
			return (await this.dbGet('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?', [provider, providerUserId])) || null; 
		} catch (e) { 
			console.error('Error fetching oauth account:', e); 
			return null; 
		}
	}

	/* Récupère un utilisateur par son ID */
	async getUserById(id: number): Promise<User | null> { 
		try { return (await this.dbGet('SELECT * FROM users WHERE id = ?', [id])) || null; } 
		catch (e) { console.error("Error getting user by ID:", e); return null; } 
	}

	/* Met à jour la dernière connexion et marque l'utilisateur comme en ligne */
	async updateLastLogin(userId: number): Promise<void> { 
		try { await this.dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP, is_online = 1 WHERE id = ?', [userId]); } 
		catch (e) { console.error('Error updating last login:', e); } 
	}

	/* Marque un utilisateur comme hors ligne */
	async setUserOffline(userId: number): Promise<void> { 
		try { await this.dbRun('UPDATE users SET is_online = 0 WHERE id = ?', [userId]); } 
		catch (e) { console.error('Error setting user offline:', e); } 
	}

	/* Met à jour le profil utilisateur (username, email, avatar) et retourne l'utilisateur mis à jour */
	async updateUserProfile(userId: number, updates: Partial<Pick<User, 'username' | 'email' | 'avatar_url'>>): Promise<User | null> {
		const allowed = ['username', 'email', 'avatar_url'];
		const fields = Object.keys(updates).filter(k => allowed.includes(k));
		if (!fields.length) throw new Error('No valid fields to update');
		
		const setClause = fields.map(f => `${f} = ?`).join(', ');
		const values = fields.map(f => (updates as any)[f]); 
		values.push(userId);
		
		try { 
			await this.dbRun(`UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values); 
			return await this.getUserById(userId);
		} catch (e: any) { 
			if (e.message?.includes('UNIQUE constraint failed')) {
				throw new Error("Username or email already taken");
			}
			throw e;
		}
	}

	/* Crée l'entrée de statistiques pour un nouvel utilisateur */
	private async createUserStats(userId: number): Promise<void> { 
		try { await this.dbRun('INSERT INTO user_stats (user_id) VALUES (?)', [userId]); } 
		catch (e) { console.error('Error creating user stats:', e); } 
	}

	/* Récupère les statistiques de jeu d'un utilisateur */
	async getUserStats(userId: number): Promise<UserStats | null> { 
		try { return (await this.dbGet('SELECT * FROM user_stats WHERE user_id = ?', [userId])) || null; } 
		catch (e) { console.error('Error getting user stats:', e); return null; } 
	}

	/* Récupère la relation d'amitié existante entre deux utilisateurs (dans les deux sens) */
	private async getFriendEdge(a: number, b: number): Promise<{ status: string | null; from?: number; to?: number }> {
		const row = await this.dbGet(`SELECT user_id, friend_id, status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) ORDER BY created_at DESC LIMIT 1`, [a, b, b, a]);
		if (!row) return { status: null };
		return { status: row.status as string, from: row.user_id as number, to: row.friend_id as number };
	}

	/* Envoie une demande d'ami ou accepte automatiquement si une demande inverse existe */
	async addFriend(userId: number, friendId: number): Promise<void> {
		if (userId === friendId) throw new Error('Cannot add yourself as a friend');
		const friend = await this.getUserById(friendId); 
		if (!friend) throw new Error('User not found');

		const edge = await this.getFriendEdge(userId, friendId);

		if (!edge.status) {
			try {
				await this.dbRun(`INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`, [userId, friendId]);
				console.log(`✅ Friend request sent: ${userId} → ${friendId}`);
				return;
			} catch (e) { console.error("Error adding friend:", e); throw e; }
		}

		if (edge.status === 'accepted') {
			throw new Error('Friendship already exists');
		}

		if (edge.status === 'pending' && edge.from === userId && edge.to === friendId) {
			await this.dbRun(`UPDATE friends SET created_at = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ? AND status = 'pending'`, [userId, friendId]);
			return;
		}

		if (edge.status === 'pending' && edge.from === friendId && edge.to === userId) {
			await this.acceptFriend(userId, friendId);
			console.log(`✅ Reverse request detected and auto-accepted: ${friendId} ⇄ ${userId}`);
			return;
		}

		throw new Error('Unexpected friendship state');
	}

	/* Accepte une demande d'ami en attente et crée la relation bidirectionnelle */
	async acceptFriend(userId: number, friendId: number): Promise<void> {
		try { 
			await this.dbRun(`UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'`, [friendId, userId]); 
			await this.dbRun(`INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)`, [userId, friendId]); 
			console.log(`✅ Friendship accepted: ${userId} ⇄ ${friendId}`);
		} catch (e) { console.error("Error accepting friend:", e); throw e; }
	}

	/* Refuse une demande d'ami en attente */
	async declineFriend(userId: number, friendId: number): Promise<void> {
		try { 
			const r = await this.dbRun(`DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'`, [friendId, userId]); 
			if (!r.changes) throw new Error('No pending friend request found'); 
			console.log(`Friend request declined: ${friendId} → ${userId}`);
		} catch (e) { console.error("Error declining friend:", e); throw e; }
	}

	/* Supprime complètement une relation d'amitié entre deux utilisateurs */
	async removeFriend(userId: number, friendId: number): Promise<void> {
		try {
			await this.dbRun(`DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [userId, friendId, friendId, userId]);
			await this.dbRun(`DELETE FROM friend_requests WHERE (requester_id = ? AND requested_id = ?) OR (requester_id = ? AND requested_id = ?)`, [userId, friendId, friendId, userId]);
			await this.dbRun(`DELETE FROM friendships WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`, [userId, friendId, friendId, userId]);
			console.log(`✅ Friendship/relations removed: ${userId} ⇄ ${friendId}`);
		} catch (e) { console.error("Error removing friend:", e); throw e; }
	}

	/* Récupère le statut de la relation d'amitié entre deux utilisateurs */
	async getFriendshipStatus(userId: number, friendId: number): Promise<string | null> { 
		try { 
			const r = await this.dbGet(`SELECT status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) ORDER BY created_at DESC LIMIT 1`, [userId, friendId, friendId, userId]); 
			return r?.status || null;
		} catch (e) { console.error("Error checking friendship status:", e); return null; } 
	}

	/* Récupère la liste des amis acceptés d'un utilisateur avec dates et statuts */
	async getFriends(userId: number): Promise<Array<User & { friendship_status: string; friendship_date: string }>> {
		const q = `SELECT u.*, f.status as friendship_status, f.created_at as friendship_date FROM friends f JOIN users u ON (CASE WHEN f.user_id = ? THEN u.id = f.friend_id ELSE u.id = f.user_id END) WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted' GROUP BY u.id ORDER BY u.is_online DESC, u.username ASC`;
		try { return await this.dbAll(q, [userId, userId, userId]); } 
		catch (e) { console.error('Error getting friends:', e); return []; }
	}

	/* Récupère les demandes d'ami en attente reçues par un utilisateur */
	async getPendingFriendRequests(userId: number): Promise<Array<User & { request_date: string }>> { 
		try { return await this.dbAll(`SELECT u.*, f.created_at as request_date FROM friends f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`, [userId]); } 
		catch (e) { console.error("Error getting friend requests:", e); return []; } 
	}

	/* Enregistre une partie jouée et met à jour les statistiques des deux joueurs */
	async createGame(player1Id: number, player2Id: number, player1Score: number, player2Score: number, gameMode: string = 'classic', duration?: number): Promise<number> {
		const winnerId = player1Score > player2Score ? player1Id : player2Id;
		try {
			const res = await this.dbRun(`INSERT INTO games (player1_id, player2_id, winner_id, player1_score, player2_score, game_mode, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [player1Id, player2Id, winnerId, player1Score, player2Score, gameMode, duration ?? null]);
			await this.updatePlayerStatsAfterGame(player1Id, player2Id, player1Score, player2Score);
			console.log(`✅ Game recorded: ${player1Id} vs ${player2Id} (${player1Score}-${player2Score})`); 
			return res.lastID;
		} catch (e) { console.error('Error creating game:', e); throw e; }
	}

	/* Met à jour les statistiques des deux joueurs après une partie (victoires, défaites, points) */
	private async updatePlayerStatsAfterGame(player1Id: number, player2Id: number, player1Score: number, player2Score: number): Promise<void> {
		const p1Won = player1Score > player2Score;
		const updateQuery = `UPDATE user_stats SET games_played = games_played + 1, games_won = games_won + ?, games_lost = games_lost + ?, total_points_scored = total_points_scored + ?, total_points_conceded = total_points_conceded + ? WHERE user_id = ?`;
		try { 
			await this.dbRun(updateQuery, [p1Won ? 1 : 0, p1Won ? 0 : 1, player1Score, player2Score, player1Id]); 
			await this.dbRun(updateQuery, [p1Won ? 0 : 1, p1Won ? 1 : 0, player2Score, player1Score, player2Id]);
		} catch (e) { console.error('Error updating player stats:', e); }
	}

	/* Récupère l'historique des matchs d'un utilisateur avec détails des adversaires et résultats */
	async getUserMatchHistory(userId: number, limit: number = 20): Promise<Array<any>> {
		const q = `SELECT g.id, g.player1_score, g.player2_score, g.game_mode, g.duration, g.created_at AS played_at, g.player1_id, g.player2_id, g.winner_id, CASE WHEN g.player1_id = ? THEN u2.id ELSE u1.id END AS opponent_id, CASE WHEN g.player1_id = ? THEN u2.username ELSE u1.username END AS opponent_username, CASE WHEN g.player1_id = ? THEN u2.avatar_url ELSE u1.avatar_url END AS opponent_avatar FROM games g LEFT JOIN users u1 ON u1.id = g.player1_id LEFT JOIN users u2 ON u2.id = g.player2_id WHERE g.player1_id = ? OR g.player2_id = ? ORDER BY g.created_at DESC LIMIT ?`;
		try {
			const rows = await this.dbAll(q, [userId, userId, userId, userId, userId, limit]);
			return rows.map((m: any) => { 
				const isP1 = m.player1_id === userId;
				const myScore = isP1 ? m.player1_score : m.player2_score;
				const opponentScore = isP1 ? m.player2_score : m.player1_score;
				const result: 'win' | 'loss' = m.winner_id === userId ? 'win' : 'loss'; 
				return { 
					id: m.id, 
					opponent: { id: m.opponent_id ?? -1, username: m.opponent_username ?? 'Guest Player', avatar_url: m.opponent_avatar ?? null } as User, 
					my_score: myScore, opponent_score: opponentScore, result: result, game_mode: m.game_mode, duration: m.duration, played_at: m.played_at 
				};
			});
		} catch (e) { console.error("Error getting match history:", e); return []; }
	}

	/* Recherche des utilisateurs par nom d'utilisateur avec option d'exclusion */
	async searchUsers(searchTerm: string, excludeUserId?: number): Promise<User[]> {
		const q = `SELECT id, username, avatar_url, is_online, last_login, created_at, updated_at FROM users WHERE username LIKE ? ${excludeUserId ? 'AND id != ?' : ''} ORDER BY is_online DESC, username ASC LIMIT 20`;
		try { 
			const params: any[] = [`%${searchTerm}%`]; 
			if (excludeUserId) params.push(excludeUserId.toString()); 
			return await this.dbAll(q, params);
		} catch (e) { console.error("Error searching users:", e); return []; }
	}

	/* Compte le nombre total d'utilisateurs enregistrés */
	async getUserCount(): Promise<number> { 
		try { const r = await this.dbGet('SELECT COUNT(*) as count FROM users'); return r.count; } 
		catch (e) { console.error('Error counting users:', e); return 0; } 
	}

	/* Récupère le classement général des joueurs avec statistiques et pagination */
	async getLeaderboard(limit: number = 20, offset: number = 0): Promise<LeaderboardEntry[]> {
		const rows = await this.dbAll(`SELECT u.id AS user_id, u.username, u.avatar_url, u.created_at, COALESCE(s.games_won,0) AS games_won, COALESCE(s.games_lost,0) AS games_lost, COALESCE(s.total_points_scored,0) AS total_points_scored, COALESCE(s.total_points_conceded,0) AS total_points_conceded, (COALESCE(s.total_points_scored,0)-COALESCE(s.total_points_conceded,0)) AS points_diff FROM users u LEFT JOIN user_stats s ON s.user_id = u.id ORDER BY games_won DESC, games_lost ASC, points_diff DESC, u.created_at ASC, u.id ASC LIMIT ? OFFSET ?`, [limit, offset]);
		return rows.map((r: any, i: number) => ({ 
			rank: offset + i + 1, user_id: r.user_id, username: r.username, avatar_url: r.avatar_url, created_at: r.created_at, 
			games_won: r.games_won, games_lost: r.games_lost, total_points_scored: r.total_points_scored, total_points_conceded: r.total_points_conceded, points_diff: r.points_diff 
		}));
	}

	/* Récupère le rang d'un utilisateur dans le classement général */
	async getUserRank(userId: number): Promise<number | null> {
		try {
			const row = await this.dbGet(`WITH ranked AS (SELECT u.id AS user_id, ROW_NUMBER() OVER (ORDER BY COALESCE(s.games_won,0) DESC, COALESCE(s.games_lost,0) ASC, (COALESCE(s.total_points_scored,0)-COALESCE(s.total_points_conceded,0)) DESC, u.created_at ASC, u.id ASC) AS rn FROM users u LEFT JOIN user_stats s ON s.user_id = u.id) SELECT rn AS rank FROM ranked WHERE user_id = ?`, [userId]);
			if (row && typeof row.rank === 'number') return row.rank;
		} catch { /* Fallback */ }
		
		const all = await this.dbAll(`SELECT u.id AS user_id FROM users u LEFT JOIN user_stats s ON s.user_id = u.id ORDER BY COALESCE(s.games_won,0) DESC, COALESCE(s.games_lost,0) ASC, (COALESCE(s.total_points_scored,0)-COALESCE(s.total_points_conceded,0)) DESC, u.created_at ASC, u.id ASC`);
		const idx = (all as Array<{ user_id: number }>).findIndex(r => r.user_id === userId); 
		return idx >= 0 ? idx + 1 : null;
	}

	/* Enregistre le secret 2FA pour un utilisateur */
	async setTwoFactorSecret(userId: number, secret: string): Promise<void> {
		await this.dbRun('UPDATE users SET two_factor_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [secret, userId]);
	}

	/* Active l'authentification à deux facteurs pour un utilisateur */
	async activateTwoFactor(userId: number): Promise<void> {
		await this.dbRun('UPDATE users SET two_factor_enabled = 1, two_factor_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
	}

	/* Désactive l'authentification à deux facteurs et supprime le secret */
	async disableTwoFactor(userId: number): Promise<void> {
		await this.dbRun('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, two_factor_confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
	}

	/* Récupère les données d'authentification à deux facteurs d'un utilisateur */
	async getTwoFactorData(userId: number): Promise<{ enabled: boolean; secret: string | null }> {
		const row = await this.dbGet('SELECT COALESCE(two_factor_enabled, 0) AS enabled, two_factor_secret AS secret FROM users WHERE id = ?', [userId]);
		return { enabled: !!(row?.enabled), secret: row?.secret ?? null };
	}

	/* Récupère la liste de tous les utilisateurs actuellement en ligne */
	async getOnlineUsers(): Promise<User[]> {
		try { return await this.dbAll('SELECT id, username, avatar_url, is_online FROM users WHERE is_online = 1'); } 
		catch (e) { console.error('[DB] ⚠️ getOnlineUsers error:', e); return []; }
	}
}
