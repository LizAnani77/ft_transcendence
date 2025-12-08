// backend/scripts/initDatabase.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Chemin vers la base de données
const dbPath = '/app/database/pong.db';

console.log('🗄️  Initializing database at:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err);
    process.exit(1);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Créer les tables
const createTables = () => {
  db.serialize(() => {
    // Table users
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_online BOOLEAN DEFAULT 0,
        elo_rating INTEGER DEFAULT 1000
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating users table:', err);
      } else {
        console.log('✅ Users table created/verified');
      }
    });

    db.run(`
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
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating oauth_accounts table:', err);
      } else {
        console.log('✅ oauth_accounts table created/verified');
      }
    });

    // Table games
    db.run(`
      CREATE TABLE IF NOT EXISTS games (
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
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating games table:', err);
      } else {
        console.log('✅ Games table created/verified');
      }
    });

    // Table tournaments
    db.run(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        max_players INTEGER DEFAULT 8,
        current_round INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        ended_at TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating tournaments table:', err);
      } else {
        console.log('✅ Tournaments table created/verified');
      }
    });

    // Table tournament_participants
    db.run(`
      CREATE TABLE IF NOT EXISTS tournament_participants (
        tournament_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        seed INTEGER,
        eliminated BOOLEAN DEFAULT 0,
        final_position INTEGER,
        PRIMARY KEY (tournament_id, user_id),
        FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating tournament_participants table:', err);
      } else {
        console.log('✅ Tournament_participants table created/verified');
      }
    });

    // Table friends
    db.run(`
      CREATE TABLE IF NOT EXISTS friends (
        user_id INTEGER NOT NULL,
        friend_id INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, friend_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (friend_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating friends table:', err);
      } else {
        console.log('✅ Friends table created/verified');
      }
    });

    // Table user_stats
    db.run(`
      CREATE TABLE IF NOT EXISTS user_stats (
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
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating user_stats table:', err);
      } else {
        console.log('✅ User_stats table created/verified');
      }
    });

    // Créer les index pour performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_games_players ON games(player1_id, player2_id)`, (err) => {
      if (err) {
        console.error('❌ Error creating games index:', err);
      } else {
        console.log('✅ Games index created/verified');
      }
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_tournament_participants ON tournament_participants(tournament_id)`, (err) => {
      if (err) {
        console.error('❌ Error creating tournament_participants index:', err);
      } else {
        console.log('✅ Tournament_participants index created/verified');
      }
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`, (err) => {
      if (err) {
        console.error('❌ Error creating users index:', err);
      } else {
        console.log('✅ Users index created/verified');
      }
    });

    // Fermer la base de données après toutes les opérations
    db.close((err) => {
      if (err) {
        console.error('❌ Error closing database:', err);
        process.exit(1);
      } else {
        console.log('📚 Database initialized successfully and closed');
        process.exit(0);
      }
    });
  });
};

// Exécuter la création des tables
createTables();
