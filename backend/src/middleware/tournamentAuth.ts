// backend/src/middleware/tournamentAuth.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { GuestTokenService } from '../services/guestTokens';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

export interface TournamentAuthUser {
  type: 'registered' | 'guest';
  userId?: number;
  guestToken?: string;
  username?: string;
}

/*
 Middleware pour authentifier soit un user enregistré, soit un guest
 Ajoute l'objet tournamentUser à la request
 */
export async function tournamentAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  guestTokenService: GuestTokenService
): Promise<TournamentAuthUser | null> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    // Pas d'authentification fournie
    return null;
  }

  const token = authHeader.replace('Bearer ', '');

  // Vérifier si c'est un token guest
  if (token.startsWith('guest_')) {
    try {
      const isValid = await guestTokenService.validateGuestToken(token);
      
      if (!isValid) {
        reply.code(401).send({ error: 'Invalid or expired guest token' });
        return null;
      }

      const session = await guestTokenService.getGuestSession(token);
      
      if (!session) {
        reply.code(401).send({ error: 'Guest session not found' });
        return null;
      }

      return {
        type: 'guest',
        userId: session.user_id,
        guestToken: token,
        username: session.player_alias || 'Guest'
      };
    } catch (error) {
      console.error('[TournamentAuth] Guest token validation error:', error);
      reply.code(500).send({ error: 'Authentication failed' });
      return null;
    }
  }

  // Sinon, c'est un JWT classique pour un user enregistré
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    if (!decoded.userId) {
      reply.code(401).send({ error: 'Invalid token' });
      return null;
    }

    return {
      type: 'registered',
      userId: decoded.userId,
      username: decoded.username
    };
  } catch (error) {
    console.error('[TournamentAuth] JWT validation error:', error);
    reply.code(401).send({ error: 'Invalid or expired token' });
    return null;
  }
}

/*  Helper pour extraire userId ou guestToken depuis le body ou les headers */
// export function extractUserIdentifier(
//   request: FastifyRequest,
//   body: any
// ): { userId?: number; guestToken?: string } {
//   // Priorité 1: depuis le body
//   if (body.userId) {
//     return { userId: body.userId };
//   }
//
//   if (body.guestToken) {
//     return { guestToken: body.guestToken };
//   }

//   // Priorité 2: depuis les headers Authorization
//   const authHeader = request.headers.authorization;
//   if (authHeader) {
//     const token = authHeader.replace('Bearer ', '');
//
//     if (token.startsWith('guest_')) {
//       return { guestToken: token };
//     }
//
//     // Essayer de décoder le JWT
//     try {
//       const decoded = jwt.verify(token, JWT_SECRET) as any;
//       if (decoded.userId) {
//         return { userId: decoded.userId };
//       }
//     } catch (error) {
//       console.warn('[TournamentAuth] Failed to decode JWT from header');
//     }
//   }

//   // Aucun identifiant trouvé
//   return {};
// }