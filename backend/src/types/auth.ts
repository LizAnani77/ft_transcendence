// backend/src/types/auth.ts

import { FastifyRequest, FastifyReply } from 'fastify';

/* Structure des données contenues dans le token JWT */
export interface JWTPayload {
  id: number;
  username: string;
  iat?: number;
  exp?: number;
  twofa_stage?: 'pending'; // présent uniquement pour le temp_token 2FA
}

// NOTE: "twofa_stage?" Rôle : permet de distinguer un JWT final d’un JWT temporaire (phase 2FA).

/* Requête Fastify enrichie avec l'utilisateur authentifié */
export interface AuthenticatedRequest extends FastifyRequest { user: JWTPayload }

/* Extension de Fastify pour ajouter la méthode d'authentification */
declare module 'fastify' { interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void> } }

/* Extension de Fastify-JWT pour typer les données utilisateur */
declare module '@fastify/jwt' { interface FastifyJWT { payload: JWTPayload; user: JWTPayload } }
