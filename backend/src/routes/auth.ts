// backend/src/routes/auth.ts

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { dbService } from '../services/database';
import { authenticator } from 'otplib';
import { OAuth42Service, OAuth42ConfigError } from '../services/oauth42';
import { LIMITS } from '../config/limits';

const isValidLang = (v: any) => typeof v === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(v);
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const TOTP_ISSUER = process.env.TOTP_ISSUER || 'ft_transcendence';
authenticator.options = { ...authenticator.options, window: 1 };

/* Types simples */
interface RegisterBody { username: string; password: string; email?: string }
interface LoginBody { username: string; password: string }
interface UpdateProfileBody { username?: string; email?: string; avatar_url?: string }
interface AddFriendBody { friendId: number }
interface CreateMatchBody { player2Id: number; player1Score: number; player2Score: number; gameMode?: string; duration?: number }

/* Enregistre les routes d'authentification et initialise les dépendances */
export default async function authRoutes(fastify: FastifyInstance) {
	console.log('🔐 Loading auth routes...');

	/* Initialiser la base de données */
	await dbService.initialize();

	// ==== Helpers compacts (réduisent les répétitions) ====
	const ok = (reply: FastifyReply, payload: any) => reply.send(payload);
	const bad = (reply: FastifyReply, code: number, message: string, extra: Record<string, any> = {}) => reply.code(code).send({ success: false, message, ...extra });
	const err500 = (reply: FastifyReply, e: any, tag: string) => { console.error(`❌ ${tag}:`, e); reply.code(500).send({ success: false, message: 'Internal server error' }) };
	const auth = { preValidation: [(fastify as any).authenticate] };
	const idParam = (v: any, name: string, reply: FastifyReply) => { const n = parseInt(v); if (isNaN(n)) { bad(reply, 400, `Invalid ${name}`); return null } return n };
	const is6Digits = (v: any) => /^\d{6}$/.test(String(v).trim());
	// ==== 2FA rate-limit (par userId) ====
	const MAX_2FA_ATTEMPTS = Number(process.env.TWOFA_MAX_ATTEMPTS ?? 5);        // tentatives invalides par fenêtre
	const TWOFA_WINDOW_MS = Number(process.env.TWOFA_WINDOW_MS ?? 5 * 60_000);  // 5 min
	const TWOFA_LOCK_MS = Number(process.env.TWOFA_LOCK_MS ?? 15 * 60_000);   // 15 min de lock

	type TwofaBucket = { count: number; resetAt: number; lockedUntil: number };
	const twofaBuckets = new Map<number, TwofaBucket>();
	const oauthStateStore = new Map<string, number>();
	const oauth42Service = new OAuth42Service();
	const OAUTH_STATE_TTL_MS = Number(process.env.OAUTH42_STATE_TTL ?? 5 * 60_000);
	const OAUTH_PROVIDER = '42';

	function bucketFor(userId: number): TwofaBucket {
		let b = twofaBuckets.get(userId);
		const now = Date.now();
		if (!b) {
			b = { count: 0, resetAt: now + TWOFA_WINDOW_MS, lockedUntil: 0 };
			twofaBuckets.set(userId, b);
		}
		// reset fenêtre si expirée
		if (now > b.resetAt) { b.count = 0; b.resetAt = now + TWOFA_WINDOW_MS; }
		return b;
	}

	function cleanupOAuthStates() {
		const now = Date.now();
		for (const [state, expiry] of oauthStateStore.entries()) {
			if (expiry <= now) oauthStateStore.delete(state);
		}
	}

	function createOAuthState(): string {
		cleanupOAuthStates();
		const state = crypto.randomUUID();
		oauthStateStore.set(state, Date.now() + OAUTH_STATE_TTL_MS);
		return state;
	}

	function consumeOAuthState(state: string): boolean {
		cleanupOAuthStates();
		const expiry = oauthStateStore.get(state);
		if (!expiry || expiry < Date.now()) {
			return false;
		}
		oauthStateStore.delete(state);
		return true;
	}

	const hasActiveWebSession = (userId: number): boolean => {
		try {
			const fn = (fastify as any)?.isUserConnected;
			return typeof fn === 'function' ? !!fn(userId) : false;
		} catch {
			return false;
		}
	};

	const rejectActiveSession = (reply: FastifyReply) => bad(
		reply,
		423,
		'User already connected in another tab',
		{ code: 'ALREADY_CONNECTED' }
	);

	async function generateUniqueUsername(base: string): Promise<string> {
		const sanitized = (base || 'player').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 10) || 'player';
		let candidate = sanitized;
		let attempt = 1;
		while (await dbService.getUserByUsername(candidate)) {
			const suffix = `${attempt}`;
			const prefix = sanitized.slice(0, Math.max(1, 10 - suffix.length));
			candidate = `${prefix}${suffix}`;
			attempt++;
			if (attempt > 50) {
				candidate = `player${crypto.randomInt(1000, 9999)}`;
				if (!await dbService.getUserByUsername(candidate)) break;
			}
		}
		return candidate;
	}

	function canAttempt2FA(userId: number): { ok: true } | { ok: false; retry_after: number } {
		const b = bucketFor(userId);
		const now = Date.now();
		if (b.lockedUntil && now < b.lockedUntil) {
			return { ok: false, retry_after: Math.ceil((b.lockedUntil - now) / 1000) };
		}
		if (b.count >= MAX_2FA_ATTEMPTS) {
			b.lockedUntil = now + TWOFA_LOCK_MS;
			return { ok: false, retry_after: Math.ceil(TWOFA_LOCK_MS / 1000) };
		}
		return { ok: true };
	}

	function record2FAFailure(userId: number) {
		const b = bucketFor(userId);
		b.count += 1;
		if (b.count >= MAX_2FA_ATTEMPTS) {
			b.lockedUntil = Date.now() + TWOFA_LOCK_MS;
		}
	}

	function record2FASuccess(userId: number) {
		twofaBuckets.delete(userId); // on repart à zéro
	}

	/* Returns true if user should be locked now */
	function maybeLockNow(reply: FastifyReply, userId: number) {
		const b = bucketFor(userId);
		if (b.count >= MAX_2FA_ATTEMPTS) {
			reply.header('Retry-After', Math.ceil(TWOFA_LOCK_MS / 1000));
			return true;
		}
		return false;
	}

	/* Inscription d'un utilisateur */
	fastify.post('/register', async (request: any, reply: FastifyReply) => {
		console.log('🔐 Register route called with:', { username: request.body.username, email: request.body.email });
		const { username, password, email }: RegisterBody = request.body;

		/* Validation des données */
		if (!username || !password) return bad(reply, 400, 'Username and password are required');
		if (username.length < 3) return bad(reply, 400, 'Username must be at least 3 characters long');
		if (username.length > 10) return bad(reply, 400, 'Username must be at most 10 characters long');
		if (password.length < 6) return bad(reply, 400, 'Password must be at least 6 characters long');
		if (password.length > 100) return bad(reply, 400, 'Password must be at most 100 characters long');

		try {
			/* Vérifier la limite d'utilisateurs enregistrés */
			const userCount = await dbService.getUserCount();
			console.log(`[LIMIT CHECK] User count: ${userCount} / Max: ${LIMITS.USER.MAX_REGISTERED_USERS}`);
			if (userCount >= LIMITS.USER.MAX_REGISTERED_USERS) {
				return bad(reply, 403, 'Registration temporarily closed. User limit reached.');
			}

			/* Vérifier si l'utilisateur existe déjà */
			if (await dbService.getUserByUsername(username)) return bad(reply, 409, 'This username is already taken');
			/* Vérifier l'email s'il est fourni */
			if (email && await dbService.getUserByEmail(email)) return bad(reply, 409, 'This email is already taken');

			/* Hasher le mot de passe */
			const password_hash = await bcrypt.hash(password, 12);
			/* Créer l'utilisateur */
			const newUser = await dbService.createUser(username, password_hash, email);
			/* Générer le token JWT */
			const token = fastify.jwt.sign({ id: newUser.id, username: newUser.username }, { expiresIn: JWT_EXPIRES });
			/* Mettre à jour la dernière connexion */
			await dbService.updateLastLogin(newUser.id);
			/* Calculer le rang actuel */
			const rank = await dbService.getUserRank(newUser.id);

			return ok(reply, { success: true, message: 'Registration successful', token, user: { id: newUser.id, username: newUser.username, email: newUser.email, avatar_url: newUser.avatar_url, created_at: newUser.created_at, rank, rank_position: rank } });
		} catch (error: any) { return err500(reply, error, 'Error during registration') }
	});

	/* Connexion d'un utilisateur */
	fastify.post('/login', async (request: any, reply: FastifyReply) => {
		console.log('🔐 Login route called with:', { username: request.body.username });
		const { username, password }: LoginBody = request.body;

		/* Validation des données */
		if (!username || !password) return bad(reply, 400, 'Username and password are required');

		try {
			/* Chercher l'utilisateur dans la base de données */
			const user = await dbService.getUserByUsername(username);
			if (!user) return bad(reply, 401, 'Invalid username or password');

			/* Vérifier le mot de passe */
			if (!await bcrypt.compare(password, user.password_hash)) return bad(reply, 401, 'Invalid username or password');

			if (hasActiveWebSession(user.id)) {
				console.warn('[AUTH] Login blocked: session already active', { userId: user.id });
				return rejectActiveSession(reply);
			}

			// NOTE: Rôle: ne pas donner accès sans code TOTP si le 2FA est activé.
			/* 2FA : si activée, on renvoie un JWT temporaire + requires_2fa */
			const twofa = await dbService.getTwoFactorData(user.id);
			if (twofa.enabled) {
				const temp_token = fastify.jwt.sign(
					{ id: user.id, username: user.username, twofa_stage: 'pending' },
					{ expiresIn: '5m' } // jeton court
				);
				return ok(reply, {
					success: true,
					requires_2fa: true,
					temp_token
				});
			}

			/* Sinon, login classique */
			/* Générer le token JWT */
			const token = fastify.jwt.sign({ id: user.id, username: user.username }, { expiresIn: JWT_EXPIRES });
			/* Mettre à jour la dernière connexion */
			await dbService.updateLastLogin(user.id);
			/* Récupérer les statistiques de l'utilisateur */
			const stats = await dbService.getUserStats(user.id);
			/* Calculer le rang actuel */
			const rank = await dbService.getUserRank(user.id);

			return ok(reply, {
				success: true,
				message: 'Login successful',
				token,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					avatar_url: user.avatar_url,
					last_login: user.last_login,
					rank,
					rank_position: rank,
					stats,
					two_factor_enabled: !!twofa.enabled
				}
			});
		} catch (error: any) { return err500(reply, error, '❌ Error during login') }
	});

	// NOTE: Rôle: achève l’authentification si le code TOTP est correct.
	/* Étape 2 du login (2FA) : valide le TOTP contre le secret en base, renvoie le token final */
	fastify.post('/login/2fa', async (request: any, reply: FastifyReply) => {
		try {
			const { temp_token, tmp_token, code } = request.body || {};
			const tokenIn = temp_token || tmp_token;
			if (!tokenIn || !code) return bad(reply, 400, 'temp_token (or tmp_token) and code are required');

			let payload: any;
			try { payload = fastify.jwt.verify(tokenIn); }
			catch { return bad(reply, 401, 'Invalid or expired temp_token'); }

			if (payload.twofa_stage !== 'pending' || !payload.id) {
				return bad(reply, 401, 'Invalid temp token stage');
			}

			// rate-limit
			const gate = canAttempt2FA(payload.id);
			if (!gate.ok) {
				// ✅ garde de type sûr pour éviter TS2339
				if ('retry_after' in gate) reply.header('Retry-After', gate.retry_after);
				return bad(reply, 429, 'Too many 2FA attempts. Try again later');
			}

			// Contrôle format du code (6 chiffres)
			const c = String(code).trim();
			if (!is6Digits(c)) {
				record2FAFailure(payload.id);
				if (maybeLockNow(reply, payload.id)) {
					return bad(reply, 429, 'Too many 2FA attempts. Try again later');
				}
				return bad(reply, 400, 'Invalid 2FA code format');
			}

			// Récupérer le secret 2FA de l’utilisateur
			const twofa = await dbService.getTwoFactorData(payload.id);
			if (!twofa.enabled || !twofa.secret) return bad(reply, 400, '2FA not enabled for this account');

			// Valider le code
			const isValid = authenticator.verify({ token: c, secret: twofa.secret });
			if (!isValid) {
				record2FAFailure(payload.id);
				if (maybeLockNow(reply, payload.id)) {
					return bad(reply, 429, 'Too many 2FA attempts. Try again later');
				}
				return bad(reply, 401, 'Invalid 2FA code');
			}

			// Succès : reset rate-limit
			record2FASuccess(payload.id);

			// OK → émettre le token final + profil
			const user = await dbService.getUserById(payload.id);
			if (!user) return bad(reply, 404, 'User not found');

			if (hasActiveWebSession(user.id)) {
				console.warn('[AUTH] 2FA login blocked: session already active', { userId: user.id });
				return rejectActiveSession(reply);
			}

			const token = fastify.jwt.sign({ id: user.id, username: user.username }, { expiresIn: JWT_EXPIRES });
			await dbService.updateLastLogin(user.id);
			const stats = await dbService.getUserStats(user.id);
			const rank = await dbService.getUserRank(user.id);

			return ok(reply, {
				success: true,
				message: 'Login with 2FA successful',
				token,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					avatar_url: user.avatar_url,
					last_login: user.last_login,
					rank,
					rank_position: rank,
					stats,
					two_factor_enabled: !!twofa.enabled
				}
			});
		} catch (error: any) {
			return err500(reply, error, '❌ Error during 2FA login');
		}
	});

	/* ==== OAuth 42 ==== */
	interface OAuth42CallbackQuery { code?: string; state?: string; error?: string }

	fastify.get('/oauth42/url', async (_request, reply: FastifyReply) => {
		try {
			if (!oauth42Service.isConfigured()) return bad(reply, 503, 'OAuth 42 is not configured');
			const state = createOAuthState();
			const url = oauth42Service.buildAuthorizeUrl(state);
			return ok(reply, { success: true, url, state });
		} catch (error: any) {
			if (error instanceof OAuth42ConfigError) return bad(reply, 503, error.message);
			return err500(reply, error, 'oauth42 url');
		}
	});

	fastify.get('/oauth42/callback', async (request: FastifyRequest<{ Querystring: OAuth42CallbackQuery }>, reply: FastifyReply) => {
		const { code, state, error } = request.query || {};
		if (error) return bad(reply, 400, `OAuth error: ${error}`);
		if (!code || !state) return bad(reply, 400, 'Missing code or state');
		if (!oauth42Service.isConfigured()) return bad(reply, 503, 'OAuth 42 is not configured');
		if (!consumeOAuthState(state)) return bad(reply, 400, 'Invalid or expired state parameter');

		try {
			const tokenData = await oauth42Service.exchangeCode(code);
			if (!tokenData?.access_token) return bad(reply, 502, 'Invalid token response from 42 API');

			const profile = await oauth42Service.fetchProfile(tokenData.access_token);
			if (!profile?.id) return bad(reply, 502, 'Invalid profile received from 42 API');

			const providerUserId = String(profile.id);
			let user = await dbService.getUserByOAuth(OAUTH_PROVIDER, providerUserId);

			if (!user && profile.email) {
				const existingByEmail = await dbService.getUserByEmail(profile.email);
				if (existingByEmail) user = existingByEmail;
			}

			if (!user) {
				const username = await generateUniqueUsername(profile.login || `p${providerUserId}`);
				const placeholderSecret = `oauth42:${providerUserId}:${Date.now()}`;
				const password_hash = await bcrypt.hash(placeholderSecret, 12);
				user = await dbService.createUser(username, password_hash, profile.email);
				if (profile.image?.link) {
					await dbService.updateUserProfile(user.id, { avatar_url: profile.image.link });
					user = await dbService.getUserById(user.id) || user;
				}
			}

			if (!user) return bad(reply, 500, 'Unable to create or retrieve the user');

			const tokenExpiresAt = tokenData.expires_in
				? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
				: null;

			await dbService.upsertOAuthAccount({
				userId: user.id,
				provider: OAUTH_PROVIDER,
				providerUserId,
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token,
				tokenExpiresAt
			});

			if (hasActiveWebSession(user.id)) {
				console.warn('[AUTH] OAuth login blocked: session already active', { userId: user.id });
				return rejectActiveSession(reply);
			}

			await dbService.updateLastLogin(user.id);
			const stats = await dbService.getUserStats(user.id);
			const rank = await dbService.getUserRank(user.id);
			const twofa = await dbService.getTwoFactorData(user.id);

			if (twofa.enabled) {
				const temp_token = fastify.jwt.sign(
					{ id: user.id, username: user.username, twofa_stage: 'pending' },
					{ expiresIn: '5m' }
				);
				return ok(reply, { success: true, requires_2fa: true, temp_token });
			}

			const token = fastify.jwt.sign({ id: user.id, username: user.username }, { expiresIn: JWT_EXPIRES });

			return ok(reply, {
				success: true,
				message: 'Login successful',
				token,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					avatar_url: user.avatar_url,
					last_login: user.last_login,
					rank,
					rank_position: rank,
					stats,
					two_factor_enabled: !!twofa.enabled
				}
			});
		} catch (error: any) {
			if (error instanceof OAuth42ConfigError) return bad(reply, 503, error.message);
			if (error?.message?.includes('state')) return bad(reply, 400, error.message);
			console.error('OAuth42 callback error:', error);
			return err500(reply, error, 'oauth42 callback');
		}
	});

	/* Récupère le profil de l'utilisateur connecté */
	fastify.get('/me', auth, async (request: any, reply: FastifyReply) => {
		try {
			const u = await dbService.getUserById(request.user.id);
			if (!u) return bad(reply, 404, 'User not found');
			/* Récupère en BDD les infos 2FA de l’utilisateur u (état activé + secret) via son id. */
			const twofa = await dbService.getTwoFactorData(u.id);
			/* Récupérer les statistiques */
			const stats = await dbService.getUserStats(u.id);
			/* Récupérer le rang */
			const rank = await dbService.getUserRank(u.id);
			/* Récupérer la langue */
			const preferred_language = (u as any).preferred_language ?? null;
			return ok(reply, { success: true, user: { id: u.id, username: u.username, email: u.email, avatar_url: u.avatar_url, last_login: u.last_login, is_online: u.is_online, created_at: u.created_at, rank, rank_position: rank, stats, two_factor_enabled: !!twofa.enabled, preferred_language } });
		} catch (error: any) { return err500(reply, error, '❌ Error while fetching profile') }
	});

	/* Récupère la langue préférée */
	fastify.get('/language', auth, async (request: any, reply: FastifyReply) => {
		try {
			const row = await dbService.dbGet('SELECT preferred_language FROM users WHERE id = ?', [request.user.id]);
			return ok(reply, { success: true, language: row?.preferred_language ?? null });
		} catch (e: any) {
			return err500(reply, e, '❌ Error while getting language');
		}
	});

	/* Met à jour la langue préférée */
	fastify.put('/language', auth, async (request: any, reply: FastifyReply) => {
		try {
			const { language } = request.body || {};
			if (!isValidLang(language)) return bad(reply, 400, 'Invalid language code (ex: "en", "fr", "en-US")');
			await dbService.dbRun(
			'UPDATE users SET preferred_language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
			[language, request.user.id]
			);
			return ok(reply, { success: true, language });
		} catch (e: any) {
			return err500(reply, e, '❌ Error while setting language');
		}
	});

	// NOTE: Rôle: /2fa/setup → génère secret et otpauth_url (QR côté front).
	/* Démarre l’enrôlement 2FA (user connecté) : génère et stocke un secret + otpauth URL */
	fastify.post('/2fa/setup', auth, async (request: any, reply: FastifyReply) => {
		try {
			const userId = request.user.id;
			const user = await dbService.getUserById(userId);
			if (!user) return bad(reply, 404, 'User not found');

			// Générer un secret TOTP
			const secret = authenticator.generateSecret();
			await dbService.setTwoFactorSecret(userId, secret);

			// Construire l’otpauth:// (email si dispo, sinon username)
			const label = user.email || user.username;
			const otpauth_url = authenticator.keyuri(label, TOTP_ISSUER, secret);

			return ok(reply, {
				success: true,
				otpauth_url     // à convertir en QR côté front
			});
		} catch (error: any) {
			return err500(reply, error, '❌ Error during 2FA setup');
		}
	});

	// NOTE: Rôle: /2fa/activate → vérifie un code puis active le 2FA.
	/* Valide un code (après scan du QR) et ACTIVE le 2FA pour le compte */
	fastify.post('/2fa/activate', auth, async (request: any, reply: FastifyReply) => {
		try {
			const userId = request.user.id;
			const { code } = request.body || {};
			if (!code) return bad(reply, 400, 'code is required');

			// rate-limit
			const gate = canAttempt2FA(userId);
			if (!gate.ok) {
				// ✅ garde de type sûr pour éviter TS2339
				if ('retry_after' in gate) reply.header('Retry-After', gate.retry_after);
				return bad(reply, 429, 'Too many 2FA attempts. Try again later');
			}

			// Contrôle format du code (6 chiffres)
			const c = String(code).trim();
			if (!is6Digits(c)) { record2FAFailure(userId); return bad(reply, 400, 'Invalid 2FA code format'); }

			const twofa = await dbService.getTwoFactorData(userId);
			if (!twofa.secret) return bad(reply, 400, 'No 2FA secret to verify');

			const isValid = authenticator.verify({ token: c, secret: twofa.secret });
			if (!isValid) { record2FAFailure(userId); return bad(reply, 401, 'Invalid 2FA code'); }

			// Succès : reset rate-limit
			record2FASuccess(userId);

			await dbService.activateTwoFactor(userId);
			return ok(reply, { success: true, message: 'Two-factor authentication enabled' });
		} catch (error: any) {
			return err500(reply, error, '❌ Error during 2FA activation');
		}
	});

	// Désactive le 2FA après vérification d'un code valide
	fastify.post('/2fa/disable', auth, async (request: any, reply: FastifyReply) => {
		try {
			const userId = request.user.id;
			const { code } = request.body || {};
			if (!code) return bad(reply, 400, 'code is required');

			// rate-limit
			const gate = canAttempt2FA(userId);
			if (!gate.ok) {
				// ✅ garde de type sûr pour éviter TS2339
				if ('retry_after' in gate) reply.header('Retry-After', gate.retry_after);
				return bad(reply, 429, 'Too many 2FA attempts. Try again later');
			}

			// Contrôle format du code (6 chiffres)
			const c = String(code).trim();
			if (!is6Digits(c)) {
				record2FAFailure(userId);
				if (maybeLockNow(reply, userId)) {
					return bad(reply, 429, 'Too many 2FA attempts. Try again later');
				}
				return bad(reply, 400, 'Invalid 2FA code format');
			}

			const twofa = await dbService.getTwoFactorData(userId);
			if (!twofa.enabled || !twofa.secret) return bad(reply, 400, '2FA not enabled');

			const isValid = authenticator.verify({ token: c, secret: twofa.secret });
			if (!isValid) {
				record2FAFailure(userId);
				if (maybeLockNow(reply, userId)) {
					return bad(reply, 429, 'Too many 2FA attempts. Try again later');
				}
				return bad(reply, 401, 'Invalid 2FA code');
			}

			// Succès : reset rate-limit
			record2FASuccess(userId);

			await dbService.disableTwoFactor(userId);
			return ok(reply, { success: true, message: 'Two-factor authentication disabled' });
		} catch (error: any) {
			return err500(reply, error, '❌ Error during 2FA disable');
		}
	});

	/* ===== NOUVELLE ROUTE DASHBOARD ===== */
	fastify.get('/dashboard/stats', auth, async (request: any, reply: FastifyReply) => {
		console.log('📊 Dashboard stats route called for user:', request.user.id);
		const userId = request.user.id;

		try {
			const user = await dbService.getUserById(userId);
			if (!user) return bad(reply, 404, 'User not found');

			// Récupérer toutes les stats nécessaires
			const userStats = await dbService.getUserStats(userId);
			const userRank = await dbService.getUserRank(userId);
			const recentMatches = await dbService.getUserMatchHistory(userId, 10);

			// Gestion du cas où userStats est null (nouvel utilisateur)
			const stats = userStats || {
				games_played: 0,
				games_won: 0,
				games_lost: 0,
				tournaments_played: 0,
				tournaments_won: 0,
				total_points_scored: 0,
				total_points_conceded: 0,
				longest_rally: 0
			};

			// Calculs spéciaux dashboard
			const totalGames = stats.games_played;
			const winRate = totalGames > 0 ? (stats.games_won / totalGames) * 100 : 0;

			// Calculer le win streak actuel
			let winStreak = 0;
			for (let i = 0; i < recentMatches.length; i++) {
				if (recentMatches[i].result === 'win') {
					winStreak++;
				} else {
					break;
				}
			}

			// Durée moyenne des parties (en secondes)
			const totalDuration = recentMatches.reduce((sum, match) => sum + (match.duration || 0), 0);
			const averageGameDuration = recentMatches.length > 0 ? totalDuration / recentMatches.length : 0;

			// Points par partie
			const pointsPerGame = totalGames > 0 ? stats.total_points_scored / totalGames : 0;

			const dashboardData = {
				user: {
					id: user.id,
					username: user.username,
					avatar_url: user.avatar_url,
					rank: stats.games_won || 0,
					rank_position: userRank || 1
				},
				stats: {
					games_played: stats.games_played,
					games_won: stats.games_won,
					games_lost: stats.games_lost,
					tournaments_played: stats.tournaments_played || 0,
					tournaments_won: stats.tournaments_won || 0,
					total_points_scored: stats.total_points_scored,
					total_points_conceded: stats.total_points_conceded || 0,
					longest_rally: stats.longest_rally || 0
				},
				recentMatches: recentMatches.slice(0, 10),
				winStreak,
				averageGameDuration,
				winRate,
				pointsPerGame
			};

			console.log('📊 Dashboard data prepared:', { userId, gamesPlayed: totalGames, winRate, winStreak });

			return ok(reply, {
				success: true,
				dashboard: dashboardData
			});

		} catch (error: any) {
			console.error('❌ Dashboard stats error:', error);
			return err500(reply, error, 'Dashboard stats fetch');
		}
	});

	/* Met à jour le profil de l'utilisateur connecté */
	fastify.put('/profile', auth, async (request: any, reply: FastifyReply) => {
		try {
			const updates: UpdateProfileBody = request.body;
			/* Validation */
			if (updates.username && updates.username.length < 3) return bad(reply, 400, 'Username must be at least 3 characters long');
			/* Mettre à jour le profil */
			const up = await dbService.updateUserProfile(request.user.id, updates);
			if (!up) return bad(reply, 404, 'User not found');
			/* Recalcule le rang au cas où des tie-breakers (created_at, etc.) importent */
			const rank = await dbService.getUserRank(up.id);
			return ok(reply, { success: true, message: 'Profile updated successfully', user: { id: up.id, username: up.username, email: up.email, avatar_url: up.avatar_url, updated_at: up.updated_at, rank, rank_position: rank } });
		} catch (error: any) {
			console.error('❌ Error while updating profile:', error);
			if (error.message?.includes('already') || error.message?.includes('déjà')) return bad(reply, 409, error.message);
			return bad(reply, 500, 'Internal server error');
		}
	});

	/* Déconnecte l'utilisateur courant */
	fastify.post('/logout', auth, async (request: any, reply: FastifyReply) => {
		try { await dbService.setUserOffline(request.user.id); return ok(reply, { success: true, message: 'Logout successful' }) }
		catch (e: any) { return err500(reply, e, '❌ Error during logout') }
	});

	/* Recherche des utilisateurs (exclut l'utilisateur courant) */
	fastify.get('/users/search', auth, async (request: any, reply: FastifyReply) => {
		try {
			const q = request.query.q; if (!q || String(q).length < 2) return bad(reply, 400, 'Search term must be at least 2 characters long');
			const users = await dbService.searchUsers(q, request.user.id);
			return ok(reply, { success: true, users: users.map((u: any) => ({ id: u.id, username: u.username, avatar_url: u.avatar_url, is_online: u.is_online })) });
		} catch (e: any) { return err500(reply, e, '❌ Error while searching users') }
	});

	/* Envoie une demande d'ami */
	fastify.post('/friends/add', auth, async (request: any, reply: FastifyReply) => {
		try {
			const { friendId }: AddFriendBody = request.body; if (!friendId || isNaN(friendId)) return bad(reply, 400, 'Invalid friend ID');

			/* Vérifier la limite d'amis pour les deux utilisateurs */
			const myFriends = await dbService.getFriends(request.user.id);
			const theirFriends = await dbService.getFriends(friendId);

			if (myFriends.length >= LIMITS.USER.MAX_FRIENDS_PER_USER) {
				return bad(reply, 403, `Friend limit reached (${LIMITS.USER.MAX_FRIENDS_PER_USER} maximum)`);
			}

			if (theirFriends.length >= LIMITS.USER.MAX_FRIENDS_PER_USER) {
				return bad(reply, 403, `This user has reached their friend limit (${LIMITS.USER.MAX_FRIENDS_PER_USER} maximum)`);
			}

			await dbService.addFriend(request.user.id, friendId);
			// Push temps réel au destinataire : apparition immédiate dans l'UI sans F5
			try {
				(fastify as any).broadcastToUser(friendId, 'friend:request_received', {
					requester: { id: request.user.id, username: request.user.username },
					message: null
				});
			} catch (e) {
				(fastify as any).log?.warn?.('Broadcast friend:request_received failed', e);
			}

			return ok(reply, { success: true, message: 'Friend request sent successfully' });
		} catch (e: any) {
			console.error('❌ Error while adding friend:', e);
			if (['not found', 'already', 'déjà', 'Cannot add yourself'].some(s => e.message?.includes(s))) return bad(reply, 400, e.message);
			return bad(reply, 500, 'Internal server error');
		}
	});

	/* Accepte une demande d'ami */
	fastify.post('/friends/accept', auth, async (request: any, reply: FastifyReply) => {
		try {
			const { friendId }: AddFriendBody = request.body; if (!friendId || isNaN(friendId)) return bad(reply, 400, 'Invalid friend ID');
			await dbService.acceptFriend(request.user.id, friendId);
			// --- realtime updates ---
			try {
			  const me   = await dbService.getUserById(request.user.id);
			  const them = await dbService.getUserById(friendId);
			  if (me && them) {
			    // 1) notifier le demandeur : sa demande a été acceptée
			    (fastify as any).broadcastToUser(friendId, 'friend_accepted', {
			      by: { id: me.id, username: me.username, avatar_url: me.avatar_url }
			    });
			    // 2) pousser l'ami chez l’accepteur
			    (fastify as any).broadcastToUser(request.user.id, 'friend_accepted', {
			      friend: { id: them.id, username: them.username, avatar_url: them.avatar_url, is_online: !!them.is_online }
			    });
			    // 3) pousser l'ami chez le demandeur
			    (fastify as any).broadcastToUser(friendId, 'friend_accepted', {
			      friend: { id: me.id, username: me.username, avatar_url: me.avatar_url, is_online: !!me.is_online }
			    });
			  }
			} catch (e) {
			  (fastify as any).log?.warn?.('Broadcast friend accept failed', e);
			}
			return ok(reply, { success: true, message: 'Friendship accepted successfully' });
		} catch (e: any) { return err500(reply, e, '❌ Error while accepting friend') }
	});

	/* Refuse une demande d'ami */
	fastify.delete('/friends/decline/:friendId', auth, async (request: any, reply: FastifyReply) => {
		try {
			const friendId = idParam(request.params.friendId, 'friend ID', reply); if (friendId === null) return;
			await dbService.declineFriend(request.user.id, friendId);
			return ok(reply, { success: true, message: 'Friend request declined' });
		} catch (e: any) {
			console.error('❌ Error while declining friend request:', e);
			if (e.message?.includes('No pending friend request found')) return bad(reply, 404, e.message);
			return bad(reply, 500, 'Internal server error');
		}
	});

	/* Supprime un ami existant */
	fastify.delete('/friends/:friendId', auth, async (request: any, reply: FastifyReply) => {
		try {
			const friendId = idParam(request.params.friendId, 'friend ID', reply); if (friendId === null) return;
			await dbService.removeFriend(request.user.id, friendId);
			try {
			(fastify as any).broadcastToUser(request.user.id, 'friend:removed', { friendId });
			(fastify as any).broadcastToUser(friendId,            'friend:removed', { friendId: request.user.id });
			} catch (e) {
				(fastify as any).log?.warn?.('Broadcast friend removed failed', e);
			}
			return ok(reply, { success: true, message: 'Friend removed successfully' });
		}	catch (e: any) { return err500(reply, e, '❌ Error while removing friend') }
	});

	/* Récupère la liste des amis de l'utilisateur */
	fastify.get('/friends', auth, async (request: any, reply: FastifyReply) => {
		try {
			const friends = await dbService.getFriends(request.user.id);
			return ok(reply, { success: true, friends: friends.map((f: any) => ({ id: f.id, username: f.username, avatar_url: f.avatar_url, is_online: f.is_online, last_login: f.last_login, friendship_date: f.friendship_date })) });
		} catch (e: any) { return err500(reply, e, '❌ Error while retrieving friends') }
	});

	/* Récupère les demandes d'ami en attente */
	fastify.get('/friends/requests', auth, async (request: any, reply: FastifyReply) => {
		try {
			const requests = await dbService.getPendingFriendRequests(request.user.id);
			return ok(reply, { success: true, requests: requests.map((r: any) => ({ id: r.id, username: r.username, avatar_url: r.avatar_url, request_date: r.request_date })) });
		} catch (e: any) { return err500(reply, e, '❌ Error while retrieving friend requests') }
	});

	/* Récupère l'historique des matches d'un utilisateur */
	fastify.get('/users/:userId/matches', auth, async (request: any, reply: FastifyReply) => {
		try {
			const userId = idParam(request.params.userId, 'user ID', reply); if (userId === null) return;
			const limit = request.query.limit ? parseInt(request.query.limit) : 20;
			const user = await dbService.getUserById(userId); if (!user) return bad(reply, 404, 'User not found');
			const matches = await dbService.getUserMatchHistory(userId, limit); const rank = await dbService.getUserRank(userId);
			return ok(reply, { success: true, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, rank, rank_position: rank }, matches });
		} catch (e: any) { return err500(reply, e, '❌ Error while retrieving match history') }
	});

	/* Crée un match (outil de test) */
	fastify.post('/matches', auth, async (request: any, reply: FastifyReply) => {
		try {
			const { player2Id, player1Score, player2Score, gameMode, duration }: CreateMatchBody = request.body;
			if (!player2Id || isNaN(player1Score) || isNaN(player2Score)) return bad(reply, 400, 'Invalid match data');
			const gameId = await dbService.createGame(request.user.id, player2Id, player1Score, player2Score, gameMode || 'classic', duration);
			return ok(reply, { success: true, message: 'Match successfully recorded', gameId });
		} catch (e: any) { return err500(reply, e, '❌ Error while creating match') }
	});

	/* Récupère les statistiques d'un utilisateur */
	fastify.get('/users/:userId/stats', auth, async (request: any, reply: FastifyReply) => {
		try {
			const userId = idParam(request.params.userId, 'user ID', reply); if (userId === null) return;
			const user = await dbService.getUserById(userId); if (!user) return bad(reply, 404, 'User not found');
			const stats = await dbService.getUserStats(userId); const rank = await dbService.getUserRank(userId);
			return ok(reply, { success: true, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, last_login: user.last_login, created_at:user.created_at, rank, rank_position: rank }, stats });
		} catch (e: any) { return err500(reply, e, '❌ Error while retrieving stats') }
	});

	/* Classement global (leaderboard simple) */
	fastify.get('/ranking', auth, async (request: any, reply: FastifyReply) => {
		try {
			const limit = request.query.limit ? parseInt(request.query.limit) : 20;
			const offset = request.query.offset ? parseInt(request.query.offset) : 0;
			const leaderboard = await dbService.getLeaderboard(limit, offset);
			return ok(reply, { success: true, leaderboard });
		} catch (e: any) { return err500(reply, e, '❌ Error while retrieving leaderboard') }
	});

	/* Rang d'un utilisateur donné (position actuelle) */
	fastify.get('/users/:userId/rank', auth, async (request: any, reply: FastifyReply) => {
		try {
			const userId = idParam(request.params.userId, 'user ID', reply); if (userId === null) return;
			const user = await dbService.getUserById(userId); if (!user) return bad(reply, 404, 'User not found');
			const rank = await dbService.getUserRank(userId);
			return ok(reply, { success: true, user: { id: user.id, username: user.username }, rank, rank_position: rank });
		} catch (e: any) { return err500(reply, e, '❌ Error while retrieving user rank') }
	});

	/* Health 2FA (vérifie conf + état utilisateur) */
	fastify.get('/2fa/health', auth, async (request: any, reply: FastifyReply) => {
		try {
			const u = await dbService.getUserById(request.user.id);
			if (!u) return bad(reply, 404, 'User not found');
			const twofa = await dbService.getTwoFactorData(u.id);

			// Empêche toute mise en cache par des proxies
			reply.header('Cache-Control', 'no-store');

			return ok(reply, {
				ok: true,
				now: Date.now(),
				config: {
					issuer: TOTP_ISSUER,
					maxAttempts: Number(process.env.TWOFA_MAX_ATTEMPTS ?? 5),
					windowMs: Number(process.env.TWOFA_WINDOW_MS ?? 300000),
					lockMs: Number(process.env.TWOFA_LOCK_MS ?? 900000),
					otpWindow: authenticator.options.window ?? 0
				},
				user: {
					id: u.id,
					username: u.username,
					two_factor_enabled: !!twofa.enabled
				}
			});
		} catch (e) {
			return err500(reply, e, '❌ 2FA health');
		}
	});

	console.log('✅ Auth routes registered: /register, /login, /me, /profile, /dashboard/stats, /logout, /users/:userId/stats, /friends/*, /friends/decline/:friendId, /users/:userId/matches, /matches, /ranking, /users/:userId/rank');
}
