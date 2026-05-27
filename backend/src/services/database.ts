// backend/src/services/database.ts

import sqlite3 from 'sqlite3';
import { User, UserStats, LeaderboardEntry, Tournament, TournamentAlias, TournamentMatchAlias } from './database.types';
import { DatabaseSchema } from './database.schema';
import { UserOperations } from './database.users';
import { TournamentOperations } from './database.tournaments';
import { ChatOperations } from './database.chats';

export const MAX_CHAT_CHARS = 500;

export class DatabaseService {
	private db!: sqlite3.Database;
	private connectionReady: Promise<void>;
	private initialized = false;
	private connectionRetryCount = 0;
	private readonly MAX_RETRY_ATTEMPTS = 3;
	private readonly RETRY_DELAY_MS = 1000;

	private schema!: DatabaseSchema;
	private userOps!: UserOperations;
	private tournamentOps!: TournamentOperations;
	private chatOps!: ChatOperations;

	constructor() {
		const dbPath = '/app/database/pong.db';
		this.connectionReady = new Promise((resolve, reject) => {
			this.initializeConnection(dbPath, resolve, reject);
		});
	}

	private initializeConnection(dbPath: string, resolve: () => void, reject: (err: Error) => void): void {
		console.log(`[DB] Attempting to connect to database: ${dbPath} (attempt ${this.connectionRetryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`);
		
		this.db = new sqlite3.Database(dbPath, (err) => {
			if (err) {
				console.error(`[DB] Connection attempt ${this.connectionRetryCount + 1} failed:`, err.message);
				this.connectionRetryCount++;
				
				if (this.connectionRetryCount < this.MAX_RETRY_ATTEMPTS) {
					console.log(`[DB] Retrying connection in ${this.RETRY_DELAY_MS}ms...`);
					setTimeout(() => { this.initializeConnection(dbPath, resolve, reject); }, this.RETRY_DELAY_MS);
				} else {
					const error = new Error(`Database connection failed after ${this.MAX_RETRY_ATTEMPTS} attempts: ${err.message}`);
					console.error(`[DB] Max retry attempts reached.`);
					reject(error);
				}
			} else {
				console.log('[DB] SQLite connection successful');
				this.connectionRetryCount = 0;
				this.initializeServices();
				this.validateConnection();
				resolve();
			}
		});

		this.db.on('error', (err) => { console.error('[DB] Runtime database error:', err); });
		this.db.on('close', () => { console.log('[DB] Database connection closed'); });
	}

	private validateConnection(): void {
		this.db.get("SELECT 1 as test", (err, row) => {
			if (err) {
				console.error('[DB] Connection validation failed:', err);
				throw new Error(`Database validation failed: ${err.message}`);
			} else {
				console.log('[DB] Connection validation successful');
			}
		});
	}

	private initializeServices(): void {
		console.log('[DB] Initializing sub-services...');
		this.schema = new DatabaseSchema(this.db);
		this.userOps = new UserOperations(this.db);
		this.tournamentOps = new TournamentOperations(this.db);
		this.chatOps = new ChatOperations(this.db);
		console.log('[DB] Sub-services initialized');
	}

	async initialize(): Promise<void> { 
		await this.connectionReady;
		
		if (this.initialized) {
			console.log('[DB] Already initialized, skipping');
			return;
		}
		
		try { 
			console.log('[DB] Starting database initialization...');
			await this.schema.initialize();
			this.initialized = true; 
			console.log('[DB] Database initialization completed successfully');
		} catch (error) { 
			console.error("[DB] Critical error during database initialization:", error); 
			throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} 
	}

	/* Délégation des méthodes utilisateurs */
	async createUser(username: string, password_hash: string, email?: string): Promise<User> {
		return this.userOps.createUser(username, password_hash, email);
	}
	async getUserByUsername(username: string): Promise<User | null> {
		return this.userOps.getUserByUsername(username);
	}
	async getUserByEmail(email: string): Promise<User | null> {
		return this.userOps.getUserByEmail(email);
	}
	async getUserByOAuth(provider: string, providerUserId: string): Promise<User | null> {
		return this.userOps.getUserByOAuth(provider, providerUserId);
	}
	async getUserById(id: number): Promise<User | null> {
		return this.userOps.getUserById(id);
	}
	async updateLastLogin(userId: number): Promise<void> {
		return this.userOps.updateLastLogin(userId);
	}
	async setUserOffline(userId: number): Promise<void> {
		return this.userOps.setUserOffline(userId);
	}
	async updateUserProfile(userId: number, updates: Partial<Pick<User, 'username' | 'email' | 'avatar_url'>>): Promise<User | null> {
		return this.userOps.updateUserProfile(userId, updates);
	}
	async getUserStats(userId: number): Promise<UserStats | null> {
		return this.userOps.getUserStats(userId);
	}
	async addFriend(userId: number, friendId: number): Promise<void> {
		return this.userOps.addFriend(userId, friendId);
	}
	async acceptFriend(userId: number, friendId: number): Promise<void> {
		return this.userOps.acceptFriend(userId, friendId);
	}
	async declineFriend(userId: number, friendId: number): Promise<void> {
		return this.userOps.declineFriend(userId, friendId);
	}
	async removeFriend(userId: number, friendId: number): Promise<void> {
		return this.userOps.removeFriend(userId, friendId);
	}
	async getFriendshipStatus(userId: number, friendId: number): Promise<string | null> {
		return this.userOps.getFriendshipStatus(userId, friendId);
	}
	async getFriends(userId: number): Promise<Array<User & { friendship_status: string; friendship_date: string }>> {
		return this.userOps.getFriends(userId);
	}
	async getPendingFriendRequests(userId: number): Promise<Array<User & { request_date: string }>> {
		return this.userOps.getPendingFriendRequests(userId);
	}
	async createGame(player1Id: number, player2Id: number, player1Score: number, player2Score: number, gameMode: string = 'classic', duration?: number): Promise<number> {
		return this.userOps.createGame(player1Id, player2Id, player1Score, player2Score, gameMode, duration);
	}
	async getUserMatchHistory(userId: number, limit: number = 20): Promise<Array<any>> {
		return this.userOps.getUserMatchHistory(userId, limit);
	}
	async searchUsers(searchTerm: string, excludeUserId?: number): Promise<User[]> {
		return this.userOps.searchUsers(searchTerm, excludeUserId);
	}
	async getUserCount(): Promise<number> {
		return this.userOps.getUserCount();
	}
	async getLeaderboard(limit: number = 20, offset: number = 0): Promise<LeaderboardEntry[]> {
		return this.userOps.getLeaderboard(limit, offset);
	}
	async getUserRank(userId: number): Promise<number | null> {
		return this.userOps.getUserRank(userId);
	}
	async setTwoFactorSecret(userId: number, secret: string): Promise<void> {
		return this.userOps.setTwoFactorSecret(userId, secret);
	}
	async activateTwoFactor(userId: number): Promise<void> {
		return this.userOps.activateTwoFactor(userId);
	}
	async disableTwoFactor(userId: number): Promise<void> {
		return this.userOps.disableTwoFactor(userId);
	}
	async getTwoFactorData(userId: number): Promise<{ enabled: boolean; secret: string | null }> {
		return this.userOps.getTwoFactorData(userId);
	}
	async getOnlineUsers(): Promise<User[]> {
		return this.userOps.getOnlineUsers();
	}
	async upsertOAuthAccount(params: {
		userId: number;
		provider: string;
		providerUserId: string;
		accessToken?: string | null;
		refreshToken?: string | null;
		tokenExpiresAt?: string | null;
	}): Promise<void> {
		return this.userOps.upsertOAuthAccount(params);
	}
	async getOAuthAccount(provider: string, providerUserId: string) {
		return this.userOps.getOAuthAccount(provider, providerUserId);
	}

	/* Délégation des méthodes tournois */
	async createTournament(name: string, status: string = 'waiting', maxPlayers: number = 4): Promise<number> {
		return this.tournamentOps.createTournament(name, status, maxPlayers);
	}
	async getTournament(tournamentId: number): Promise<Tournament | null> {
		return this.tournamentOps.getTournament(tournamentId);
	}
	async isUserInActiveTournament(userId: number): Promise<boolean> {
		return this.tournamentOps.isUserInActiveTournament(userId);
	}
	async updateTournament(tournamentId: number, updates: Partial<Tournament>): Promise<void> {
		return this.tournamentOps.updateTournament(tournamentId, updates);
	}
	async getOpenTournaments(limit: number = 20): Promise<Array<Tournament & { current_players: number }>> {
		return this.tournamentOps.getOpenTournaments(limit);
	}
	async addTournamentAlias(tournamentId: number, playerAlias: string, isOwner: boolean = false, userId?: number | null): Promise<void> {
		return this.tournamentOps.addTournamentAlias(tournamentId, playerAlias, isOwner, userId);
	}
	async getTournamentAliases(tournamentId: number): Promise<TournamentAlias[]> {
		return this.tournamentOps.getTournamentAliases(tournamentId);
	}
	async getTournamentAliasCount(tournamentId: number): Promise<number> {
		return this.tournamentOps.getTournamentAliasCount(tournamentId);
	}
	async aliasExistsInTournament(tournamentId: number, playerAlias: string): Promise<boolean> {
		return this.tournamentOps.aliasExistsInTournament(tournamentId, playerAlias);
	}
	async createTournamentMatchAlias(tournamentId: number, round: number, player1Alias: string, player2Alias?: string, status: string = 'pending'): Promise<number> {
		return this.tournamentOps.createTournamentMatchAlias(tournamentId, round, player1Alias, player2Alias, status);
	}
	async updateTournamentMatchAlias(matchId: number, winnerAlias: string, score1?: number, score2?: number): Promise<{ tournamentId: number; round: number }> {
  		return this.tournamentOps.updateTournamentMatchAlias(matchId, winnerAlias, score1, score2);
	}	
	async getTournamentMatchesAliases(tournamentId: number, round?: number): Promise<TournamentMatchAlias[]> {
		return this.tournamentOps.getTournamentMatchesAliases(tournamentId, round);
	}
	async getPendingMatchesCount(tournamentId: number, round: number): Promise<number> {
		return this.tournamentOps.getPendingMatchesCount(tournamentId, round);
	}
	async getRoundWinners(tournamentId: number, round: number): Promise<string[]> {
		return this.tournamentOps.getRoundWinners(tournamentId, round);
	}
	async saveTournamentResultAlias(tournamentId: number, playerAlias: string, finalPosition: number): Promise<void> {
		return this.tournamentOps.saveTournamentResultAlias(tournamentId, playerAlias, finalPosition);
	}
	async getTournamentHistoryByAlias(playerAlias: string, limit: number = 10): Promise<Array<any>> {
		return this.tournamentOps.getTournamentHistoryByAlias(playerAlias, limit);
	}
	async saveTournamentResult(tournamentId: string, userId: number, finalPosition: number): Promise<void> {
		return this.tournamentOps.saveTournamentResult(tournamentId, userId, finalPosition);
	}
	async updateTournamentStats(userId: number, isWinner: boolean): Promise<void> {
		return this.tournamentOps.updateTournamentStats(userId, isWinner);
	}
	async getUserTournamentHistory(userId: number, limit: number = 10): Promise<Array<any>> {
		return this.tournamentOps.getUserTournamentHistory(userId, limit);
	}

	/* Délégation des méthodes chat */
	async getOrCreatePrivateConversation(user1Id: number, user2Id: number): Promise<number> {
		return this.chatOps.getOrCreatePrivateConversation(user1Id, user2Id);
	}
	
	async sendMessage(
		conversationId: number, 
		senderId: number, 
		content: string, 
		messageType: string = 'text', 
		metadata?: string,
		sentWhileBlocked: boolean = false
	): Promise<number> {
		return this.chatOps.sendMessage(conversationId, senderId, content, messageType, metadata, sentWhileBlocked);
	}
	
	async getMessages(conversationId: number, userId: number, limit: number = 50, offset: number = 0): Promise<any[]> {
		return this.chatOps.getMessages(conversationId, userId, limit, offset);
	}
	async getUserConversations(userId: number): Promise<any[]> {
		return this.chatOps.getUserConversations(userId);
	}
	async blockUser(blockerId: number, blockedId: number, reason?: string): Promise<void> {
		return this.chatOps.blockUser(blockerId, blockedId, reason);
	}
	async unblockUser(blockerId: number, blockedId: number): Promise<void> {
		return this.chatOps.unblockUser(blockerId, blockedId);
	}
	async isUserBlocked(userId: number, otherUserId: number): Promise<boolean> {
		return this.chatOps.isUserBlocked(userId, otherUserId);
	}
	async getBlockedUsers(userId: number): Promise<User[]> {
		return this.chatOps.getBlockedUsers(userId);
	}
	async getLastUserMessage(userId: number, conversationId: number): Promise<any> {
		return this.chatOps.getLastUserMessage(userId, conversationId);
	}
	async createNotification(userId: number, type: string, title: string, message: string, metadata?: string): Promise<number> {
		return this.chatOps.createNotification(userId, type, title, message, metadata);
	}
	async getUserNotifications(userId: number, limit: number = 20, unreadOnly: boolean = false): Promise<any[]> {
		return this.chatOps.getUserNotifications(userId, limit, unreadOnly);
	}
	async getUnreadNotificationCount(userId: number): Promise<number> {
		return this.chatOps.getUnreadNotificationCount(userId);
	}
	async markNotificationAsRead(notificationId: number, userId: number): Promise<void> {
		return this.chatOps.markNotificationAsRead(notificationId, userId);
	}
	async markAllNotificationsAsRead(userId: number): Promise<void> {
		return this.chatOps.markAllNotificationsAsRead(userId);
	}
	async createFriendRequest(requesterId: number, requestedId: number, message?: string): Promise<number> {
		return this.chatOps.createFriendRequest(requesterId, requestedId, message);
	}
	async createGameChallenge(challengerId: number, challengedId: number, message?: string, gameMode: string = 'classic'): Promise<number> {
		return this.chatOps.createGameChallenge(challengerId, challengedId, message, gameMode);
	}
	async markMessageAsRead(messageId: number, userId: number): Promise<void> {
		return this.chatOps.markMessageAsRead(messageId, userId);
	}
	async markConversationMessagesAsRead(conversationId: number, userId: number): Promise<void> {
		return this.chatOps.markConversationMessagesAsRead(conversationId, userId);
	}
	async markUserMessagesAsRead(currentUserId: number, otherUserId: number): Promise<void> {
		return this.chatOps.markUserMessagesAsRead(currentUserId, otherUserId);
	}
	async getUnreadChatCounts(userId: number): Promise<Array<any>> {
		return this.chatOps.getUnreadChatCounts(userId);
	}
	async getTotalUnreadChatCount(userId: number): Promise<number> {
		return this.chatOps.getTotalUnreadChatCount(userId);
	}
	async isMessageRead(messageId: number, userId: number): Promise<boolean> {
		return this.chatOps.isMessageRead(messageId, userId);
	}
	async cleanupOldMessageReads(daysOld: number = 30): Promise<void> {
		return this.chatOps.cleanupOldMessageReads(daysOld);
	}

	/* Récupère les compteurs de messages non lus par utilisateur (pour les notifications en temps réel) */
	async getUnreadMessageCounts(userId: number): Promise<Array<{ userId: number; username: string; count: number; lastMessageTime: string }>> {
		return this.chatOps.getUnreadMessageCounts(userId);
	}

	/* Méthode helper pour accès direct (utilisée en interne) */
	public dbGet(query: string, params: any[] = []): Promise<any> {
		return new Promise((resolve, reject) => {
			this.db.get(query, params, (err, row) => {
				if (err) reject(err);
				else resolve(row);
			});
		});
	}

	public dbAll(query: string, params: any[] = []): Promise<any[]> {
		return new Promise((resolve, reject) => {
			this.db.all(query, params, (err, rows) => {
				if (err) reject(err);
				else resolve(rows || []);
			});
		});
	}

	public dbRun(query: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
		return new Promise((resolve, reject) => {
			this.db.run(query, params, function(err) {
				if (err) reject(err);
				else resolve({ lastID: this.lastID, changes: this.changes });
			});
		});
	}

	async close(): Promise<void> { 
		return new Promise((resolve, reject) => {
			console.log('[DB] Closing database connection...');
			
			try {
				if (this.db) {
					this.db.close(err => {
						if (err) {
							console.error('[DB] Error closing database:', err);
							reject(err);
						} else {
							console.log('[DB] Database closed successfully');
							this.initialized = false;
							resolve();
						}
					});
				} else {
					console.log('[DB] Database was not initialized');
					resolve();
				}
			} catch (error) {
				console.error('[DB] Critical error during database close:', error);
				reject(error);
			}
		});
	}
}

export const dbService = new DatabaseService();
