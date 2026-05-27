CREATE TABLE IF NOT EXISTS users 
(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255),
    avatar_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_online BOOLEAN DEFAULT 0,
	two_factor_enabled BOOLEAN DEFAULT 0,
    two_factor_secret TEXT,
    two_factor_confirmed_at TIMESTAMP NULL,
    elo_rating INTEGER DEFAULT 1000
);

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

CREATE TABLE IF NOT EXISTS games 
(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    winner_id INTEGER,
    player1_score INTEGER DEFAULT 0,
    player2_score INTEGER DEFAULT 0,
    game_mode VARCHAR(50) DEFAULT 'classic',
    duration INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player1_id) REFERENCES users(id),
    FOREIGN KEY (player2_id) REFERENCES users(id),
    FOREIGN KEY (winner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tournaments 
(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'waiting',
    max_players INTEGER DEFAULT 8,
    current_round INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tournament_participants 
(
    tournament_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    seed INTEGER,
    eliminated BOOLEAN DEFAULT 0,
    final_position INTEGER,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tournament_id, user_id),
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- NOUVELLE TABLE pour les matchs de tournoi
CREATE TABLE IF NOT EXISTS tournament_matches 
(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    winner_id INTEGER,
    status VARCHAR(50) DEFAULT 'pending',
    score1 INTEGER DEFAULT 0,
    score2 INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (player1_id) REFERENCES users(id),
    FOREIGN KEY (player2_id) REFERENCES users(id),
    FOREIGN KEY (winner_id) REFERENCES users(id)
);

-- NOUVELLE TABLE pour stocker les résultats des tournois en mémoire
CREATE TABLE IF NOT EXISTS tournament_results 
(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id VARCHAR(50) NOT NULL, -- ID du tournoi en mémoire (t_xxxxx)
    user_id INTEGER NOT NULL,
    final_position INTEGER NOT NULL, -- 1=winner, 2=finalist, 3-4=semi-finalist
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS friends 
(
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_stats 
(
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
);

-- Creation d'index
CREATE INDEX idx_games_players ON games(player1_id, player2_id);
CREATE INDEX idx_tournament_participants ON tournament_participants(tournament_id);
CREATE INDEX idx_tournament_matches_tournament ON tournament_matches(tournament_id);
CREATE INDEX idx_tournament_matches_round ON tournament_matches(tournament_id, round);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_tournament_results_user ON tournament_results(user_id);
CREATE INDEX idx_tournament_results_tournament ON tournament_results(tournament_id);

-- Tables pour le système de chat amélioré
CREATE TABLE IF NOT EXISTS chat_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type VARCHAR(50) DEFAULT 'private', -- 'private', 'global'
    name VARCHAR(100), -- pour les conversations de groupe ou nom du chat global
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chat_participants (
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT 1,
    role VARCHAR(50) DEFAULT 'member', -- 'admin', 'member' pour futures fonctionnalités
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    message_type VARCHAR(50) DEFAULT 'text', -- 'text', 'game_invite', 'notification', 'system'
    content TEXT NOT NULL CHECK (length(content) <= 500),
    metadata TEXT, -- JSON pour données supplémentaires (invitations jeu, etc.)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    edited_at TIMESTAMP NULL,
    is_deleted BOOLEAN DEFAULT 0,
    parent_message_id INTEGER NULL, -- pour futures réponses/threads
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (parent_message_id) REFERENCES chat_messages(id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason VARCHAR(255), -- optionnel pour modération
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id),
    FOREIGN KEY (blocked_id) REFERENCES users(id)
);

-- Table pour gérer les demandes d'amis (amélioration)
CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    requested_id INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'declined'
    message TEXT, -- message personnalisé optionnel
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL,
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (requested_id) REFERENCES users(id),
    UNIQUE(requester_id, requested_id)
);

-- Table pour les challenges de jeu
CREATE TABLE IF NOT EXISTS game_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenger_id INTEGER NOT NULL,
    challenged_id INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'expired'
    message TEXT, -- message de défi optionnel
    game_mode VARCHAR(50) DEFAULT 'classic',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL,
    expires_at TIMESTAMP DEFAULT (datetime('now', '+5 minutes')), -- expire automatiquement
    FOREIGN KEY (challenger_id) REFERENCES users(id),
    FOREIGN KEY (challenged_id) REFERENCES users(id)
);

-- Table pour les notifications utilisateur
CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'friend_request', 'game_challenge', 'message', 'tournament_invite'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT, -- JSON pour données supplémentaires
    is_read BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL, -- pour notifications temporaires
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Index pour les performances du chat
CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX idx_chat_messages_type ON chat_messages(message_type);
CREATE INDEX idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON user_blocks(blocked_id);
CREATE INDEX idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX idx_chat_conversations_type ON chat_conversations(type);
CREATE INDEX idx_friend_requests_requested ON friend_requests(requested_id, status);
CREATE INDEX idx_game_challenges_challenged ON game_challenges(challenged_id, status);
CREATE INDEX idx_user_notifications_user ON user_notifications(user_id, is_read, created_at DESC);

-- Insertion du chat global par défaut
INSERT OR IGNORE INTO chat_conversations (id, type, name, created_at) 
VALUES (1, 'global', 'Global Chat', datetime('now'));

-- Triggers pour maintenir les données cohérentes

-- Trigger pour nettoyer automatiquement les anciens messages du chat global
CREATE TRIGGER IF NOT EXISTS cleanup_global_chat_messages
AFTER INSERT ON chat_messages
WHEN NEW.conversation_id = 1 -- Chat global
BEGIN
    DELETE FROM chat_messages 
    WHERE conversation_id = 1 
    AND id NOT IN (
        SELECT id FROM chat_messages 
        WHERE conversation_id = 1 
        ORDER BY created_at DESC 
        LIMIT 100
    );
END;

-- Trigger pour nettoyer les challenges expirés
CREATE TRIGGER IF NOT EXISTS cleanup_expired_challenges
AFTER INSERT ON game_challenges
BEGIN
    UPDATE game_challenges 
    SET status = 'expired' 
    WHERE status = 'pending' 
    AND expires_at < datetime('now');
END;

-- Trigger pour nettoyer les notifications expirées
CREATE TRIGGER IF NOT EXISTS cleanup_expired_notifications
AFTER INSERT ON user_notifications
BEGIN
    DELETE FROM user_notifications 
    WHERE expires_at IS NOT NULL 
    AND expires_at < datetime('now');
END;

-- Trigger pour mettre à jour updated_at dans chat_conversations
CREATE TRIGGER IF NOT EXISTS update_conversation_timestamp
AFTER INSERT ON chat_messages
BEGIN
    UPDATE chat_conversations 
    SET updated_at = datetime('now') 
    WHERE id = NEW.conversation_id;
END;

-- Trigger pour mettre à jour updated_at dans tournaments
CREATE TRIGGER IF NOT EXISTS update_tournament_timestamp
AFTER UPDATE ON tournaments
BEGIN
    UPDATE tournaments 
    SET updated_at = datetime('now') 
    WHERE id = NEW.id;
END;

-- Table pour tracker quels messages ont été lus par quels utilisateurs
CREATE TABLE IF NOT EXISTS chat_message_reads (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index pour les performances
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user ON chat_message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_message ON chat_message_reads(message_id);

-- Trigger pour nettoyer automatiquement les lectures des messages supprimés
CREATE TRIGGER IF NOT EXISTS cleanup_message_reads
AFTER DELETE ON chat_messages
BEGIN
    DELETE FROM chat_message_reads WHERE message_id = OLD.id;
END;
