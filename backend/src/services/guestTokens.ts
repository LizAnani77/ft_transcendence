// backend/src/services/guestTokens.ts

import crypto from 'crypto';
import sqlite3 from 'sqlite3';

interface GuestSession {
  token: string;
  user_id: number;
  tournament_id: number | null;
  player_alias: string | null;
  created_at: string;
  expires_at: string;
  last_activity: string;
}

export class GuestTokenService {
  constructor(private db: sqlite3.Database) {}

  /* Génère un userId stable et négatif basé sur un token */
  static generateGuestUserId(token: string): number {
    const hash = token.split('_')[1].substring(0, 8)
      .split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return -Math.abs(hash);
  }

  /* Génère un token unique pour un guest */
  generateGuestToken(): string {
    // Génère un token aléatoire sécurisé de 32 bytes en hexadécimal
    return `guest_${crypto.randomBytes(32).toString('hex')}`;
  }

  /* Crée une session guest dans la base de données */
  async createGuestSession(token: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Durée de vie : 24 heures
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const userId = GuestTokenService.generateGuestUserId(token);
      
      this.db.run(
        `INSERT INTO guest_sessions (token, user_id, expires_at, last_activity) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [token, userId, expiresAt],
        (err) => {
          if (err) {
            reject(new Error(`Failed to create guest session: ${err.message}`));
          } else {
            console.log('[GuestTokens] ✅ Guest session created:', {
              token: token.substring(0, 20) + '...',
              userId
            });
            resolve(userId);
          }
        }
      );
    });
  }

  /* Valide un token guest et met à jour la dernière activité */
  async validateGuestToken(token: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT token, expires_at FROM guest_sessions 
         WHERE token = ? AND datetime(expires_at) > datetime('now')`,
        [token],
        (err, row: any) => {
          if (err) {
            reject(new Error(`Failed to validate guest token: ${err.message}`));
          } else if (row) {
            // Met à jour la dernière activité
            this.db.run(
              `UPDATE guest_sessions SET last_activity = CURRENT_TIMESTAMP WHERE token = ?`,
              [token],
              (updateErr) => {
                if (updateErr) {
                  console.warn('[GuestTokens] Failed to update last_activity:', updateErr);
                }
              }
            );
            resolve(true);
          } else {
            resolve(false);
          }
        }
      );
    });
  }

  /* Récupère l'userId depuis un token */
  async getUserIdFromToken(token: string): Promise<number | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT user_id FROM guest_sessions 
         WHERE token = ? AND datetime(expires_at) > datetime('now')`,
        [token],
        (err, row: any) => {
          if (err) {
            reject(new Error(`Failed to get userId from token: ${err.message}`));
          } else {
            resolve(row?.user_id || null);
          }
        }
      );
    });
  }

  /* Associe un token guest à un tournoi et un alias */
  async linkGuestToTournament(token: string, tournamentId: number, playerAlias: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE guest_sessions 
         SET tournament_id = ?, player_alias = ?, last_activity = CURRENT_TIMESTAMP 
         WHERE token = ?`,
        [tournamentId, playerAlias, token],
        function(err) {
          if (err) {
            reject(new Error(`Failed to link guest to tournament: ${err.message}`));
          } else if (this.changes === 0) {
            reject(new Error('Guest token not found'));
          } else {
            console.log('[GuestTokens] ✅ Guest linked to tournament:', {
              token: token.substring(0, 20) + '...',
              tournamentId,
              playerAlias
            });
            resolve();
          }
        }
      );
    });
  }

  /* Récupère les informations d'une session guest */
  async getGuestSession(token: string): Promise<GuestSession | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM guest_sessions 
         WHERE token = ? AND datetime(expires_at) > datetime('now')`,
        [token],
        (err, row: any) => {
          if (err) {
            reject(new Error(`Failed to get guest session: ${err.message}`));
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /* Supprime une session guest (quand le guest quitte le tournoi) */
  async deleteGuestSession(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM guest_sessions WHERE token = ?`,
        [token],
        (err) => {
          if (err) {
            reject(new Error(`Failed to delete guest session: ${err.message}`));
          } else {
            console.log('[GuestTokens] ✅ Guest session deleted');
            resolve();
          }
        }
      );
    });
  }

  /* Nettoie les sessions expirées (à appeler périodiquement) */
  async cleanExpiredSessions(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM guest_sessions WHERE datetime(expires_at) <= datetime('now')`,
        function(err) {
          if (err) {
            reject(new Error(`Failed to clean expired sessions: ${err.message}`));
          } else {
            if (this.changes > 0) {
              console.log(`[GuestTokens] 🧹 Cleaned ${this.changes} expired guest sessions`);
            }
            resolve(this.changes);
          }
        }
      );
    });
  }

  /* Vérifie si un alias est déjà utilisé par un guest dans un tournoi */
  async isAliasUsedByGuest(tournamentId: number, playerAlias: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 1 FROM guest_sessions 
         WHERE tournament_id = ? AND player_alias = ? 
         AND datetime(expires_at) > datetime('now')`,
        [tournamentId, playerAlias],
        (err, row: any) => {
          if (err) {
            reject(new Error(`Failed to check guest alias: ${err.message}`));
          } else {
            resolve(!!row);
          }
        }
      );
    });
  }

  /* Dissocier un guest d'un tournoi (quand le tournoi se termine) */
  async unlinkGuestFromTournament(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE guest_sessions 
         SET tournament_id = NULL, player_alias = NULL, last_activity = CURRENT_TIMESTAMP 
         WHERE token = ?`,
        [token],
        (err) => {
          if (err) {
            reject(new Error(`Failed to unlink guest from tournament: ${err.message}`));
          } else {
            console.log('[GuestTokens] ✅ Guest unlinked from tournament');
            resolve();
          }
        }
      );
    });
  }

  /* Mettre à jour l'alias d'un guest (SANS changer le tournamentId si déjà défini) */
  async updateGuestAlias(token: string, newAlias: string, tournamentId?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Si tournamentId est fourni, mettre à jour les deux
      if (tournamentId !== undefined) {
        this.db.run(
          `UPDATE guest_sessions 
           SET player_alias = ?, tournament_id = ?, last_activity = CURRENT_TIMESTAMP 
           WHERE token = ? AND datetime(expires_at) > datetime('now')`,
          [newAlias, tournamentId, token],
          (err) => {
            if (err) {
              reject(new Error(`Failed to update guest alias and tournament: ${err.message}`));
            } else {
              console.log('[GuestTokens] ✅ Guest alias and tournament updated:', { newAlias, tournamentId });
              resolve();
            }
          }
        );
      } else {
        // Sinon, mettre à jour uniquement l'alias
        this.db.run(
          `UPDATE guest_sessions 
           SET player_alias = ?, last_activity = CURRENT_TIMESTAMP 
           WHERE token = ? AND datetime(expires_at) > datetime('now')`,
          [newAlias, token],
          (err) => {
            if (err) {
              reject(new Error(`Failed to update guest alias: ${err.message}`));
            } else {
              console.log('[GuestTokens] ✅ Guest alias updated:', newAlias);
              resolve();
            }
          }
        );
      }
    });
  }
}