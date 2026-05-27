// backend/src/routes/guest.ts

import { FastifyInstance } from 'fastify';
import sqlite3 from 'sqlite3';
import path from 'path';
import { GuestTokenService } from '../services/guestTokens';

const dbPath = path.join(process.cwd(), 'database', 'pong.db');
let sharedDb: sqlite3.Database | null = null;

function getDatabase(): sqlite3.Database {
  if (!sharedDb) {
    sharedDb = new sqlite3.Database(dbPath);
    console.log('[Guest] Database connection created');
  }
  return sharedDb;
}

export default async function guestRoutes(fastify: FastifyInstance) {
  /* Génère un nouveau token guest */
  fastify.post('/token', {
    schema: {
      body: {
        type: 'object',
        properties: {},
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    try {
      console.log('[Guest] Generating new guest token...');
      
      const db = getDatabase();
      const guestTokenService = new GuestTokenService(db);
      
      const token = guestTokenService.generateGuestToken();
      const userId = await guestTokenService.createGuestSession(token);
      
      console.log('[Guest] ✅ Guest token created successfully:', { token: token.substring(0, 20) + '...', userId });
      
      return { 
        success: true,
        token,
        userId
      };
    } catch (error: any) {
      console.error('[Guest] ❌ Error creating token:', error);
      reply.code(500).send({ 
        success: false,
        error: 'Failed to generate guest token',
        message: error.message 
      });
    }
  });

  /* Valide un token guest existant */
  fastify.get('/validate', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      
      if (!authHeader) {
        return { valid: false, error: 'No authorization header' };
      }

      const token = authHeader.replace('Bearer ', '');
      
      if (!token.startsWith('guest_')) {
        return { valid: false, error: 'Not a guest token' };
      }

      const db = getDatabase();
      const guestTokenService = new GuestTokenService(db);
      const isValid = await guestTokenService.validateGuestToken(token);
      
      if (isValid) {
        const session = await guestTokenService.getGuestSession(token);
        return { 
          valid: true,
          session: {
            token: token.substring(0, 20) + '...',
            userId: session?.user_id || null,
            tournamentId: session?.tournament_id || null,
            playerAlias: session?.player_alias || null
          }
        };
      } else {
        return { valid: false, error: 'Token expired or invalid' };
      }
    } catch (error: any) {
      console.error('[Guest] Error validating token:', error);
      return { valid: false, error: 'Validation failed' };
    }
  });

  /* Récupère les informations d'une session guest */
  fastify.get('/guest/session', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      
      if (!authHeader) {
        return reply.code(401).send({ error: 'No authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');
      
      if (!token.startsWith('guest_')) {
        return reply.code(400).send({ error: 'Not a guest token' });
      }

      const db = getDatabase();
      const guestTokenService = new GuestTokenService(db);
      const session = await guestTokenService.getGuestSession(token);
      
      if (!session) {
        return reply.code(404).send({ error: 'Session not found or expired' });
      }

      return {
        success: true,
        session: {
          userId: session.user_id,
          tournamentId: session.tournament_id,
          playerAlias: session.player_alias,
          createdAt: session.created_at,
          expiresAt: session.expires_at,
          lastActivity: session.last_activity
        }
      };
    } catch (error: any) {
      console.error('[Guest] Error getting session:', error);
      reply.code(500).send({ 
        error: 'Failed to get session',
        message: error.message 
      });
    }
  });

  /* Supprime une session guest (déconnexion) */
  fastify.delete('/guest/session', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      
      if (!authHeader) {
        return reply.code(401).send({ error: 'No authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');
      
      if (!token.startsWith('guest_')) {
        return reply.code(400).send({ error: 'Not a guest token' });
      }

      const db = getDatabase();
      const guestTokenService = new GuestTokenService(db);
      await guestTokenService.deleteGuestSession(token);
      
      return { 
        success: true,
        message: 'Guest session deleted' 
      };
    } catch (error: any) {
      console.error('[Guest] Error deleting session:', error);
      reply.code(500).send({ 
        error: 'Failed to delete session',
        message: error.message 
      });
    }
  });
}