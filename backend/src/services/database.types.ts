// backend/src/services/database.types.ts

/* Structure représentant un utilisateur dans la base */
export interface User { 
	id: number; 
	username: string; 
	email?: string; 
	password_hash: string; 
	avatar_url?: string; 
	created_at: string; 
	updated_at: string; 
	last_login?: string; 
	is_online: boolean;
}

/* Structure représentant les statistiques liées à un utilisateur */
export interface UserStats { 
	user_id: number; 
	games_played: number; 
	games_won: number; 
	games_lost: number; 
	tournaments_played: number; 
	tournaments_won: number; 
	total_points_scored: number; 
	total_points_conceded: number; 
	longest_rally: number;
}

/* Structure d'une entrée de classement */
export interface LeaderboardEntry { 
	rank: number; 
	user_id: number; 
	username: string; 
	avatar_url?: string; 
	created_at: string; 
	games_won: number; 
	games_lost: number; 
	total_points_scored: number; 
	total_points_conceded: number; 
	points_diff: number;
}

/* Interfaces pour les tournois avec aliases */
export interface Tournament { 
	id: number; 
	name: string; 
	status: string; 
	max_players: number; 
	current_round: number; 
	created_at: string; 
	started_at?: string; 
	ended_at?: string; 
	updated_at: string;
}

/* PHASE 3: TournamentAlias supporte maintenant user_id optionnel */
export interface TournamentAlias { 
	tournament_id: number;
	user_id?: number | null; /* PHASE 3: NULL = invité, valeur = compte lié */
	player_alias: string; 
	is_owner: boolean; 
	joined_at: string;
}

export interface TournamentMatchAlias { 
	id: number; 
	tournament_id: number; 
	round: number; 
	player1_alias: string; 
	player2_alias?: string; 
	winner_alias?: string; 
	status: string; 
	score1?: number; 
	score2?: number; 
	created_at: string; 
	updated_at: string;
}

export interface OAuthAccount {
	id: number;
	user_id: number;
	provider: string;
	provider_user_id: string;
	access_token?: string | null;
	refresh_token?: string | null;
	token_expires_at?: string | null;
	created_at: string;
	updated_at: string;
}
