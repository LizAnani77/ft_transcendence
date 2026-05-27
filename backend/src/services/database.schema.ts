// backend/src/services/database.schema.ts

import sqlite3 from 'sqlite3';
import { MAX_CHAT_CHARS } from './database';

/* Classe gérant la création et migration du schéma de base de données */
export class DatabaseSchema {
	constructor(private db: sqlite3.Database) {}

	/* Initialise le schéma de la base de données et effectue toutes les migrations nécessaires */
	async initialize(): Promise<void> {
		await this.initializeTables();
		await this.ensure2FAColumns();
		await this.ensureUserIdColumn(); // Migration user_id
		await this.ensureSentWhileBlockedColumn();
		await this.ensurePreferredLanguageColumn();
		await this.ensureGuestUserIdColumn(); // Migration guest user_id
	}

	/* Crée toutes les tables de la base de données si elles n'existent pas déjà */
	private async initializeTables(): Promise<void> {
		const tableCreationSteps = [
			{ name: 'users', sql: this.getUsersTableSQL() },
			{ name: 'user_stats', sql: this.getUserStatsTableSQL() },
			{ name: 'games', sql: this.getGamesTableSQL() },
			{ name: 'friends', sql: this.getFriendsTableSQL() },
			{ name: 'oauth_accounts', sql: this.getOAuthAccountsTableSQL() },
			{ name: 'tournaments', sql: this.getTournamentsTableSQL() },
			{ name: 'chat_tables', sql: this.getChatTablesSQL() },
			{ name: 'chat_reads', sql: this.getChatReadsTableSQL() },
			{ name: 'cleanup_trigger', sql: this.getCleanupTriggerSQL() },
			{ name: 'tournament_aliases', sql: this.getTournamentAliasesTableSQL() },
			{ name: 'tournament_matches_aliases', sql: this.getTournamentMatchesAliasesTableSQL() },
			{ name: 'tournament_results', sql: this.getTournamentResultsTableSQL() },
			{ name: 'guest_sessions', sql: this.getGuestSessionsTableSQL() }
		];

		await new Promise<void>((resolve, reject) => {
			this.db.serialize(async () => {
				try {
					for (const step of tableCreationSteps) {
						console.log(`[DB] Creating ${step.name}...`);
						await this.execSQL(step.sql);
						console.log(`[DB] ✅ ${step.name} created successfully`);
					}
					console.log('[DB] All tables created successfully');
					resolve();
				} catch (error) {
					console.error(`[DB] ⚠️ Table creation failed:`, error);
					reject(error);
				}
			});
		});
	}

	/* Retourne le SQL de création de la table guest_sessions pour les sessions invités */
	private getGuestSessionsTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS guest_sessions (
			token VARCHAR(100) PRIMARY KEY,
			user_id INTEGER,
			tournament_id INTEGER,
			player_alias VARCHAR(50),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			expires_at TIMESTAMP NOT NULL,
			last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL
			);
			CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires ON guest_sessions(expires_at);
			CREATE INDEX IF NOT EXISTS idx_guest_sessions_tournament ON guest_sessions(tournament_id) WHERE tournament_id IS NOT NULL;
			CREATE INDEX IF NOT EXISTS idx_guest_sessions_alias ON guest_sessions(player_alias, tournament_id) WHERE player_alias IS NOT NULL;
			CREATE INDEX IF NOT EXISTS idx_guest_user_id ON guest_sessions(user_id);
		`;
	}

	/* Retourne le SQL de création de la table users pour les comptes utilisateurs */
	private getUsersTableSQL(): string {
		return `CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(100) UNIQUE,
			password_hash VARCHAR(255) NOT NULL,
			avatar_url VARCHAR(255),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			last_login TIMESTAMP,
			is_online BOOLEAN DEFAULT 0,
			preferred_language VARCHAR(10)
		)`;
	}

	/* Retourne le SQL de création de la table oauth_accounts pour l'authentification OAuth */
	private getOAuthAccountsTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS oauth_accounts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				provider VARCHAR(50) NOT NULL,
				provider_user_id VARCHAR(100) NOT NULL,
				access_token TEXT,
				refresh_token TEXT,
				token_expires_at TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id),
				UNIQUE(provider, provider_user_id)
			);
			CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
		`;
	}

	/* Retourne le SQL de création de la table user_stats pour les statistiques de jeu */
	private getUserStatsTableSQL(): string {
		return `CREATE TABLE IF NOT EXISTS user_stats (
			user_id INTEGER PRIMARY KEY,
			games_played INTEGER DEFAULT 0,
			games_won INTEGER DEFAULT 0,
			games_lost INTEGER DEFAULT 0,
			tournaments_played INTEGER DEFAULT 0,
			tournaments_won INTEGER DEFAULT 0,
			total_points_scored INTEGER DEFAULT 0,
			total_points_conceded INTEGER DEFAULT 0,
			longest_rally INTEGER DEFAULT 0,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`;
	}

	/* Retourne le SQL de création de la table games pour l'historique des parties */
	private getGamesTableSQL(): string {
		return `CREATE TABLE IF NOT EXISTS games (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			player1_id INTEGER NOT NULL,
			player2_id INTEGER,
			winner_id INTEGER,
			player1_score INTEGER DEFAULT 0,
			player2_score INTEGER DEFAULT 0,
			game_mode VARCHAR(50) DEFAULT 'classic',
			duration INTEGER,
			tournament_match_id INTEGER,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (player1_id) REFERENCES users(id),
			FOREIGN KEY (player2_id) REFERENCES users(id),
			FOREIGN KEY (winner_id) REFERENCES users(id),
			FOREIGN KEY (tournament_match_id) REFERENCES tournament_matches_aliases(id)
		);
		CREATE INDEX IF NOT EXISTS idx_games_players ON games(player1_id, player2_id);
		CREATE INDEX IF NOT EXISTS idx_games_tournament_match ON games(tournament_match_id);`;
	}

	/* Retourne le SQL de création de la table friends pour les relations d'amitié */
	private getFriendsTableSQL(): string {
		return `CREATE TABLE IF NOT EXISTS friends (
			user_id INTEGER NOT NULL,
			friend_id INTEGER NOT NULL,
			status VARCHAR(50) DEFAULT 'pending',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (user_id, friend_id),
			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (friend_id) REFERENCES users(id)
		)`;
	}

	/* Retourne le SQL de création de la table tournaments pour les tournois */
	private getTournamentsTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS tournaments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name VARCHAR(100) NOT NULL CHECK(length(trim(name)) > 0 AND length(trim(name)) <= 100),
				status VARCHAR(50) DEFAULT 'waiting' CHECK(status IN ('waiting', 'active', 'finished', 'cancelled')),
				max_players INTEGER DEFAULT 4 CHECK(max_players = 4),
				current_round INTEGER DEFAULT 1 CHECK(current_round > 0),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				started_at TIMESTAMP,
				ended_at TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
			CREATE INDEX IF NOT EXISTS idx_tournaments_created ON tournaments(created_at);
		`;
	}

	/* Retourne le SQL de création des tables de chat (conversations, messages, notifications, etc.) */
	private getChatTablesSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS conversations (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				type VARCHAR(20) DEFAULT 'private', 
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS conversation_participants (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				conversation_id INTEGER NOT NULL, 
				user_id INTEGER NOT NULL, 
				joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
				FOREIGN KEY (conversation_id) REFERENCES conversations(id), 
				FOREIGN KEY (user_id) REFERENCES users(id), 
				UNIQUE(conversation_id, user_id)
			);
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id INTEGER NOT NULL,
				sender_id INTEGER NOT NULL,
				content TEXT NOT NULL CHECK (length(content) <= ${MAX_CHAT_CHARS}),
				message_type VARCHAR(20) DEFAULT 'text',
				metadata TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (conversation_id) REFERENCES conversations(id),
				FOREIGN KEY (sender_id) REFERENCES users(id)
			);
			CREATE TABLE IF NOT EXISTS blocked_users (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				blocker_id INTEGER NOT NULL, 
				blocked_id INTEGER NOT NULL, 
				reason TEXT, 
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
				FOREIGN KEY (blocker_id) REFERENCES users(id), 
				FOREIGN KEY (blocked_id) REFERENCES users(id), 
				UNIQUE(blocker_id, blocked_id)
			);
			CREATE TABLE IF NOT EXISTS notifications (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				user_id INTEGER NOT NULL, 
				type VARCHAR(50) NOT NULL, 
				title VARCHAR(255) NOT NULL, 
				message TEXT NOT NULL, 
				metadata TEXT, 
				is_read BOOLEAN DEFAULT 0, 
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
				FOREIGN KEY (user_id) REFERENCES users(id)
			);
			CREATE TABLE IF NOT EXISTS friend_requests (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				requester_id INTEGER NOT NULL, 
				requested_id INTEGER NOT NULL, 
				message TEXT, 
				status VARCHAR(20) DEFAULT 'pending', 
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
				responded_at DATETIME, 
				FOREIGN KEY (requester_id) REFERENCES users(id), 
				FOREIGN KEY (requested_id) REFERENCES users(id)
			);
			CREATE TABLE IF NOT EXISTS friendships (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				user1_id INTEGER NOT NULL, 
				user2_id INTEGER NOT NULL, 
				status VARCHAR(20) DEFAULT 'accepted', 
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
				FOREIGN KEY (user1_id) REFERENCES users(id), 
				FOREIGN KEY (user2_id) REFERENCES users(id), 
				UNIQUE(user1_id, user2_id)
			);
			CREATE TABLE IF NOT EXISTS game_challenges (
				id INTEGER PRIMARY KEY AUTOINCREMENT, 
				challenger_id INTEGER NOT NULL, 
				challenged_id INTEGER NOT NULL, 
				message TEXT, 
				game_mode VARCHAR(50) DEFAULT 'classic', 
				status VARCHAR(20) DEFAULT 'pending', 
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
				responded_at DATETIME, 
				FOREIGN KEY (challenger_id) REFERENCES users(id), 
				FOREIGN KEY (challenged_id) REFERENCES users(id)
			);
			INSERT OR IGNORE INTO conversations (id, type, created_at) VALUES (1, 'global', datetime('now'));
		`;
	}

	/* Retourne le SQL de création de la table chat_message_reads pour le suivi de lecture des messages */
	private getChatReadsTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS chat_message_reads (
				message_id INTEGER NOT NULL,
				user_id INTEGER NOT NULL,
				read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (message_id, user_id),
				FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user ON chat_message_reads(user_id);
			CREATE INDEX IF NOT EXISTS idx_chat_message_reads_message ON chat_message_reads(message_id);
		`;
	}

	/* Retourne le SQL de création du trigger de nettoyage automatique des lectures de messages */
	private getCleanupTriggerSQL(): string {
		return `
			CREATE TRIGGER IF NOT EXISTS cleanup_message_reads
			AFTER DELETE ON messages
			BEGIN
				DELETE FROM chat_message_reads WHERE message_id = OLD.id;
			END;
		`;
	}

	/* Retourne le SQL de création de la table tournament_aliases pour les pseudonymes des participants */
	private getTournamentAliasesTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS tournament_aliases (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tournament_id INTEGER NOT NULL,
				user_id INTEGER,
				player_alias VARCHAR(50) NOT NULL CHECK(length(trim(player_alias)) > 0 AND length(trim(player_alias)) <= 50),
				is_owner BOOLEAN DEFAULT 0,
				joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
				UNIQUE(tournament_id, player_alias)
			);
			CREATE INDEX IF NOT EXISTS idx_tournament_aliases_tournament ON tournament_aliases(tournament_id);
			CREATE INDEX IF NOT EXISTS idx_tournament_aliases_owner ON tournament_aliases(tournament_id, is_owner);
			CREATE INDEX IF NOT EXISTS idx_tournament_aliases_alias ON tournament_aliases(player_alias);
			CREATE INDEX IF NOT EXISTS idx_tournament_aliases_user ON tournament_aliases(user_id) WHERE user_id IS NOT NULL;
		`;
	}

	/* Retourne le SQL de création de la table tournament_matches_aliases pour les matchs de tournoi */
	private getTournamentMatchesAliasesTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS tournament_matches_aliases (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tournament_id INTEGER NOT NULL,
				round INTEGER NOT NULL DEFAULT 1 CHECK(round > 0),
				player1_alias VARCHAR(50) NOT NULL CHECK(length(trim(player1_alias)) > 0),
				player2_alias VARCHAR(50),
				winner_alias VARCHAR(50),
				status VARCHAR(50) DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'finished', 'cancelled')),
				score1 INTEGER DEFAULT 0 CHECK(score1 >= 0),
				score2 INTEGER DEFAULT 0 CHECK(score2 >= 0),
				p1_ready BOOLEAN DEFAULT 0,
				p2_ready BOOLEAN DEFAULT 0,
				ready_deadline TIMESTAMP NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS idx_tournament_matches_aliases_tournament ON tournament_matches_aliases(tournament_id);
			CREATE INDEX IF NOT EXISTS idx_tournament_matches_aliases_round ON tournament_matches_aliases(tournament_id, round);
			CREATE INDEX IF NOT EXISTS idx_tournament_matches_aliases_status ON tournament_matches_aliases(status);
			CREATE INDEX IF NOT EXISTS idx_tma_ready_deadline ON tournament_matches_aliases(ready_deadline);
		`;
	}

	/* Retourne le SQL de création de la table tournament_results pour les classements finaux */
	private getTournamentResultsTableSQL(): string {
		return `
			CREATE TABLE IF NOT EXISTS tournament_results (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tournament_id INTEGER NOT NULL,
				user_id INTEGER,
				player_alias VARCHAR(50) NOT NULL CHECK(length(trim(player_alias)) > 0),
				final_position INTEGER NOT NULL CHECK(final_position > 0 AND final_position <= 4),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
				UNIQUE(tournament_id, player_alias),
				UNIQUE(tournament_id, final_position)
			);
			CREATE INDEX IF NOT EXISTS idx_tournament_results_tournament ON tournament_results(tournament_id);
			CREATE INDEX IF NOT EXISTS idx_tournament_results_alias ON tournament_results(player_alias);
			CREATE INDEX IF NOT EXISTS idx_tournament_results_position ON tournament_results(final_position);
			CREATE INDEX IF NOT EXISTS idx_tournament_results_user ON tournament_results(user_id) WHERE user_id IS NOT NULL;
		`;
	}

	/* Migration: ajoute les colonnes d'authentification à deux facteurs si elles sont absentes */
	private async ensure2FAColumns(): Promise<void> {
		try {
			console.log('[DB] Checking 2FA columns...');
			const cols = await this.dbAll(`PRAGMA table_info(users)`);
			const hasEnabled = cols.some((c: any) => c.name === 'two_factor_enabled');
			const hasSecret = cols.some((c: any) => c.name === 'two_factor_secret');
			const hasConfirmedAt = cols.some((c: any) => c.name === 'two_factor_confirmed_at');

			console.log(`[DB] 2FA columns status: enabled=${hasEnabled}, secret=${hasSecret}, confirmed=${hasConfirmedAt}`);

			if (!hasEnabled) {
				console.log('[DB] Adding two_factor_enabled column...');
				await this.dbRun(`ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT 0`);
			}
			if (!hasSecret) {
				console.log('[DB] Adding two_factor_secret column...');
				await this.dbRun(`ALTER TABLE users ADD COLUMN two_factor_secret TEXT`);
			}
			if (!hasConfirmedAt) {
				console.log('[DB] Adding two_factor_confirmed_at column...');
				await this.dbRun(`ALTER TABLE users ADD COLUMN two_factor_confirmed_at TIMESTAMP NULL`);
			}
			
			console.log('[DB] ✅ 2FA migration completed successfully');
		} catch (e) {
			console.error('[DB] ⚠️ 2FA migration failed:', e);
			throw new Error(`2FA migration failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	/* Migration: ajoute user_id à tournament_aliases et tournament_results si nécessaire */
	private async ensureUserIdColumn(): Promise<void> {
		try {
			console.log('[DB] PHASE 3: Checking user_id column in tournament_aliases...');
			const cols = await this.dbAll(`PRAGMA table_info(tournament_aliases)`);
			const hasUserId = cols.some((c: any) => c.name === 'user_id');

			if (!hasUserId) {
				console.log('[DB] PHASE 3: Adding user_id column to tournament_aliases...');
				await this.dbRun(`ALTER TABLE tournament_aliases ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
				await this.execSQL(`CREATE INDEX IF NOT EXISTS idx_tournament_aliases_user ON tournament_aliases(user_id) WHERE user_id IS NOT NULL`);
				console.log('[DB] ✅ PHASE 3: user_id column added successfully');
			} else {
				console.log('[DB] PHASE 3: user_id column already exists');
			}

			/* Vérifier games.player2_id nullable */
			const gamesCols = await this.dbAll(`PRAGMA table_info(games)`);
			const player2Col = gamesCols.find((c: any) => c.name === 'player2_id');
			console.log('[DB] PHASE 3: games.player2_id notnull status:', player2Col?.notnull);

			/* Ajouter tournament_match_id si manquant */
			const hasTournamentMatchId = gamesCols.some((c: any) => c.name === 'tournament_match_id');
			if (!hasTournamentMatchId) {
				console.log('[DB] PHASE 3: Adding tournament_match_id to games...');
				await this.dbRun(`ALTER TABLE games ADD COLUMN tournament_match_id INTEGER REFERENCES tournament_matches_aliases(id)`);
				await this.execSQL(`CREATE INDEX IF NOT EXISTS idx_games_tournament_match ON games(tournament_match_id)`);
			}

			/* Vérifier tournament_results.user_id */
			const resultsCols = await this.dbAll(`PRAGMA table_info(tournament_results)`);
			const hasResultsUserId = resultsCols.some((c: any) => c.name === 'user_id');
			if (!hasResultsUserId) {
				console.log('[DB] PHASE 3: Adding user_id to tournament_results...');
				await this.dbRun(`ALTER TABLE tournament_results ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
				await this.execSQL(`CREATE INDEX IF NOT EXISTS idx_tournament_results_user ON tournament_results(user_id) WHERE user_id IS NOT NULL`);
			}

			console.log('[DB] ✅ PHASE 3: Migration completed successfully');
		} catch (e) {
			console.error('[DB] ⚠️ PHASE 3: Migration failed:', e);
			throw new Error(`PHASE 3 migration failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	/* Exécute une requête SQL brute avec gestion d'erreur */
	private execSQL(sql: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.db.exec(sql, (err) => {
				if (err) {
					console.error('[DB] SQL execution failed:', err.message);
					console.error('[DB] Failed SQL snippet:', sql.substring(0, 200) + '...');
					reject(new Error(`SQL execution failed: ${err.message}`));
				} else {
					resolve();
				}
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
	/* Migration: ajoute sent_while_blocked à la table messages pour gérer les messages envoyés pendant un blocage */
	private async ensureSentWhileBlockedColumn(): Promise<void> {
		try {
			console.log('[DB]: Checking sent_while_blocked column in messages...');
			const cols = await this.dbAll(`PRAGMA table_info(messages)`);
			const hasSentWhileBlocked = cols.some((c: any) => c.name === 'sent_while_blocked');

			if (!hasSentWhileBlocked) {
			console.log('[DB]: Adding sent_while_blocked column to messages...');
			
			// Ajouter la colonne avec valeur par défaut 0 (non bloqué)
			await this.dbRun(`ALTER TABLE messages ADD COLUMN sent_while_blocked BOOLEAN DEFAULT 0`);
			
			// Créer un index pour optimiser les requêtes
			await this.execSQL(`CREATE INDEX IF NOT EXISTS idx_messages_sent_while_blocked ON messages(sent_while_blocked)`);
			
			console.log('[DB]: sent_while_blocked column added successfully');
			} else {
			console.log('[DB]: sent_while_blocked column already exists');
			}
		} catch (e) {
			console.error('[DB]: Migration failed:', e);
			throw new Error(`Migration failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	/* Migration: ajoute preferred_language à users pour la langue préférée de l'utilisateur */
	private async ensurePreferredLanguageColumn(): Promise<void> {
		try {
			console.log('[DB] Checking preferred_language column...');
			const cols = await this.dbAll(`PRAGMA table_info(users)`);
			const hasLang = cols.some((c: any) => c.name === 'preferred_language');
			if (!hasLang) {
			console.log('[DB] Adding preferred_language column to users...');
			await this.dbRun(`ALTER TABLE users ADD COLUMN preferred_language VARCHAR(10)`);
			console.log('[DB] ✅ preferred_language column added');
			} else {
			console.log('[DB] preferred_language column already exists');
			}
		} catch (e) {
			console.error('[DB] ⚠️ preferred_language migration failed:', e);
			throw new Error(`preferred_language migration failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	/* Migration: ajoute les colonnes de statut ready (p1_ready, p2_ready, ready_deadline) aux matchs */
	private async ensureMatchReadyColumns(): Promise<void> {
		try {
			console.log('[DB] Checking ready columns on tournament_matches_aliases...');
			const cols = await this.dbAll(`PRAGMA table_info(tournament_matches_aliases)`);
			const names = new Set(cols.map((c: any) => c.name));

			if (!names.has('p1_ready')) {
			await this.dbRun(`ALTER TABLE tournament_matches_aliases ADD COLUMN p1_ready BOOLEAN DEFAULT 0`);
			}
			if (!names.has('p2_ready')) {
			await this.dbRun(`ALTER TABLE tournament_matches_aliases ADD COLUMN p2_ready BOOLEAN DEFAULT 0`);
			}
			if (!names.has('ready_deadline')) {
			await this.dbRun(`ALTER TABLE tournament_matches_aliases ADD COLUMN ready_deadline TIMESTAMP NULL`);
			await this.execSQL(`CREATE INDEX IF NOT EXISTS idx_tma_ready_deadline ON tournament_matches_aliases(ready_deadline)`);
			}
			console.log('[DB] ✅ Ready columns present');
		} catch (e) {
			console.error('[DB] ⚠️ ensureMatchReadyColumns failed:', e);
			throw e;
		}
	}

	/* Migration: ajoute user_id à guest_sessions pour lier les sessions invités aux utilisateurs */
	private async ensureGuestUserIdColumn(): Promise<void> {
		try {
			console.log('[DB] Checking user_id column in guest_sessions...');
			const cols = await this.dbAll(`PRAGMA table_info(guest_sessions)`);
			const hasUserId = cols.some((c: any) => c.name === 'user_id');

			if (!hasUserId) {
				console.log('[DB] Adding user_id column to guest_sessions...');
				await this.dbRun(`ALTER TABLE guest_sessions ADD COLUMN user_id INTEGER`);
				await this.execSQL(`CREATE INDEX IF NOT EXISTS idx_guest_user_id ON guest_sessions(user_id)`);
				
				// Supprimer les sessions existantes car elles n'ont pas d'user_id
				console.log('[DB] Cleaning up existing guest sessions...');
				await this.dbRun(`DELETE FROM guest_sessions`);
				
				console.log('[DB] ✅ user_id column added to guest_sessions');
			} else {
				console.log('[DB] user_id column already exists in guest_sessions');
			}
		} catch (e) {
			console.error('[DB] ⚠️ guest user_id migration failed:', e);
			throw new Error(`guest user_id migration failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}
}
