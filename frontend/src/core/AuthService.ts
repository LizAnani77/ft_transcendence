// frontend/src/core/AuthService.ts

import { wsService } from '../services/WebSocketService';
import type { WebSocketService } from '../services/WebSocketService';
import { GameEngine } from '../game/GameEngine';
import { UserStats } from './interfaces';
import { i18n } from './I18n';
import { GuestAuthService } from '../services/GuestAuthService';

export class AuthService {
	private listeners: Map<string, Function[]> = new Map();
	private wsService: WebSocketService;
	private gameEngine: GameEngine;
	private currentUser: any = null;
	private userStats: UserStats | null = null;
	private temp2FAToken: string | null = null; // <-- JWT temporaire quand 2FA requis
	private temp2FAParamName: 'tmp_token' | 'temp_token' | null = null;

	/* Permet aux autres services de réagir à des événements AuthService */
	public on(event: string, handler: Function): void { const l = this.listeners.get(event) || []; this.listeners.set(event, [...l, handler]); }

	/* Déclenche tous les abonnés à un événement */
	private trigger(event: string, data?: any): void { (this.listeners.get(event) || []).forEach(fn => fn(data)); }

	/* Initialise le service avec les dépendances WebSocket et moteur de jeu. */
	constructor(wsService: WebSocketService, gameEngine: GameEngine) { 
		this.wsService = wsService; 
		this.gameEngine = gameEngine; 
		
		// Initialiser la session proprement
		this.initializeSession();
	}

	/* NOUVEAU : Initialise une session propre pour cet onglet */
	private initializeSession(): void {
		try {
			// Nettoyer localStorage au démarrage pour éviter les conflits entre onglets
			localStorage.removeItem('token');
			
			// Générer un ID de session unique pour cet onglet si pas déjà fait
			if (!sessionStorage.getItem('sessionId')) {
				const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2);
				sessionStorage.setItem('sessionId', sessionId);
				console.log('AuthService session initialisée:', sessionId);
			}
		} catch (e) {
			console.warn('AuthService session initialization failed:', e);
		}
	}

	/* Retourne l'utilisateur actuellement authentifié. */
	public getCurrentUser(): any { return this.currentUser; }

	/* Retourne les statistiques de l'utilisateur courant. */
	public getUserStats(): UserStats | null { return this.userStats; }

	/* Définit l'utilisateur courant après authentification ou mise à jour. */
	public setCurrentUser(user: any): void { this.currentUser = user; }

	/* Met à jour les statistiques stockées pour l'utilisateur courant. */
	public setUserStats(stats: UserStats): void { this.userStats = stats; }

	/* MODIFIÉ : Vérifie la session existante côté serveur avec isolation par onglet */
	public async checkExistingAuth(): Promise<void> {
		try {
			// Vérifier qu'un token existe en sessionStorage
			const token = sessionStorage.getItem('token');
			if (!token) {
				this.currentUser = null;
				return;
			}

			const user = await this.wsService.getCurrentUser(); // appelle /api/auth/me
			if (user) {
				this.currentUser = user;
				await this.loadUserData();
			} else {
				this.currentUser = null; // session invalide ou absente
				// Nettoyer le token invalide
				sessionStorage.removeItem('token');
				this.wsService.setAuthToken(null);
			}
		} catch (_err) {
			// Nettoyer en cas d'erreur
			this.currentUser = null;
			sessionStorage.removeItem('token');
			this.wsService.setAuthToken(null);
		}
	}

	/* Charge les données liées à l'utilisateur (stats, amis, demandes, historique, classement). */
	public async loadUserData(): Promise<void> {
		if (!this.currentUser) return;
		this.wsService.getUserStats(this.currentUser.id);
		this.wsService.getFriends();
		this.wsService.getFriendRequests();
		this.wsService.getMatchHistory(this.currentUser.id, 10);
		/* Récupère aussi le classement simple pour l'UI */
		this.wsService.getUserRank(this.currentUser.id);
		this.wsService.getLeaderboard(20, 0);
	}

	/* Réinitialise les formulaires de connexion et d'inscription dans l'UI. */
	public clearAuthForms(): void {
		const reset = (formId: string) => {
			const form = document.getElementById(formId) as HTMLFormElement | null;
			if (!form) return;
			form.reset();
			form.querySelectorAll('input').forEach(i => { (i as HTMLInputElement).value = ''; (i as HTMLInputElement).defaultValue = ''; });
		};
		reset('login-form'); reset('register-form');
	}

	/* Sauvegarde d'un match (désormais: pas pour le local).
	   *  Les parties VS en ligne sont automatiquement enregistrées côté serveur
	   */
	public async saveMatchResult(winner: string, currentMatch: any = null, showSuccessPopup: (m: string) => void): Promise<void> {
		const { paddle1, paddle2 } = this.gameEngine.getGameState(); const s1 = paddle1?.score ?? 0, s2 = paddle2?.score ?? 0;
		const isRemote = typeof (this.gameEngine as any).isRemote === 'function' ? (this.gameEngine as any).isRemote() : false;

		// 1) Partie locale "casual" : on NE PERSISTE PLUS (sinon stats faussées).
		if (!isRemote && !currentMatch) { console.log('[saveMatchResult] Local casual match not persisted (remote VS are auto-saved).'); showSuccessPopup(`Match ended (local): ${s1}-${s2} • Winner: ${winner}`); return; }

		// 2) Tournoi actuel : alias uniquement → pas d'ID adverse exploitable pour /games.
		if (!isRemote && currentMatch) { console.log('[saveMatchResult] Tournament match not persisted (no opponent userId).'); showSuccessPopup(`Match ended (tournament/local): ${s1}-${s2} • Winner: ${winner}`); return; }

		// 3) VS EN LIGNE (remote) : déjà enregistré côté serveur → on ne POST pas ici.
		try {
			showSuccessPopup(`Match ended (online): ${s1}-${s2} • Winner: ${winner}`);
			const updatedUser = await this.wsService.getCurrentUser(); // /api/auth/me
			if (updatedUser) {
				this.currentUser = updatedUser;
				await Promise.all([this.wsService.getUserStats(this.currentUser.id), this.wsService.getMatchHistory(this.currentUser.id, 10)]);
				/* Classement simple à jour juste après la fin du match */
				this.wsService.getUserRank(this.currentUser.id); this.wsService.getLeaderboard(20, 0);
			}
		} catch (err) { console.error('[saveMatchResult] refresh after remote game failed:', err); }
	}

	/* Déconnecte l'utilisateur et nettoie l'état local avec isolation par onglet */
	public logout(): void { 
		this.wsService.logout(); 
		this.currentUser = null; 
		this.userStats = null; 
		this.clearPending2FA(); 
		
		try { GuestAuthService.clearGuestData(); } catch { }
		
		// Nettoyage complet de la session pour cet onglet
		try {
			sessionStorage.clear(); // Vide tout pour cet onglet
			localStorage.removeItem('token'); // Sécurité
		} catch { }
	}

	/* Gère le succès d'authentification : reset UI, stocke l'utilisateur et navigue. */
	public handleAuthSuccess(data: any, loadUserData: () => void, showSuccessPopup: (m: string) => void, navigate: (p: string) => void): void {
		const wasGuestSession = GuestAuthService.isGuest();
		try { GuestAuthService.clearGuestData(); } catch { }
		if (data?.token) {
			try { this.wsService.setAuthToken(data.token); } catch { }
		}
		this.clearPending2FA();
		(this.gameEngine as any)?.destroy?.(); this.gameEngine = new GameEngine();
		console.log('Auth success:', data);
		this.currentUser = data.user; this.trigger('auth_success', data);
		i18n.loadInitialLanguage().catch(e => console.warn('[i18n] post-login reload failed', e));
		(document.getElementById('login-form') as HTMLFormElement | null)?.reset();
		(document.getElementById('register-form') as HTMLFormElement | null)?.reset();
		showSuccessPopup(`Welcome ${data.user.username}!`); loadUserData();

		// Forcer la reconnexion WS uniquement si nécessaire (ex: passage guest -> user ou socket fermée)
		if (wasGuestSession || !this.wsService.isConnected()) {
			this.wsService.connect(true).catch(err => {
				console.error('[AuthService] Failed to reconnect WebSocket after auth success:', err);
			});
		}
	}

	/* Gère une erreur d'authentification et affiche un message utilisateur. */
	public handleAuthError(data: any, showErrorPopup: (m: string) => void): void { 
		console.log('Auth error:', data); 
		const details = (data && typeof data === 'object' && data.data && typeof data.data === 'object')
			? data.data
			: data;
		const code = details?.code;
		const serverMessage = details?.error || details?.message || '';
		const localized = code === 'ALREADY_CONNECTED'
			? i18n.t('auth.errors.singleSession')
			: (serverMessage || i18n.t('auth.errors.generic'));
		showErrorPopup(localized); 
		
		// Nettoyer en cas d'erreur d'auth
		this.wsService.setAuthToken(null);
		sessionStorage.removeItem('token');
	}

	/* Gère la déconnexion avec nettoyage session */
	public handleAuthLogout(clearUserData: () => void): void { 
		this.currentUser = null; 
		this.userStats = null; 
		clearUserData(); 
		
		try { GuestAuthService.clearGuestData(); } catch { }
		
		// Nettoyage de session
		try {
			sessionStorage.clear();
			localStorage.removeItem('token');
		} catch { }
	}

	/* Met à jour l'utilisateur courant après chargement du profil. */
	public handleUserProfileLoaded(data: any): void { this.currentUser = data.user; }

	/* Met à jour le profil en mémoire et confirme la réussite à l'utilisateur. */
	public handleProfileUpdated(data: any, showSuccessPopup: (m: string) => void): void { this.currentUser = data.user; showSuccessPopup('Profile updated successfully!'); }

	/* Informe l'utilisateur d'une erreur lors de la mise à jour du profil. */
	public handleProfileUpdateError(data: any, showErrorPopup: (m: string) => void): void { showErrorPopup(data.error); }

	/* Enregistre les statistiques utilisateur et alimente l'UI. */
	public handleUserStatsLoaded(data: any): void { this.userStats = data.stats; }

	/* Optionnel: met à jour la position de classement de l'utilisateur courant. */
	public handleUserRankLoaded(data: any): void {
		if (!this.currentUser) return;
		if (data && typeof data.rank_position === 'number' && data.userId === this.currentUser.id) this.currentUser.rank_position = data.rank_position;
	}

	/* Optionnel: handler de confort si tu veux relayer le leaderboard vers d'autres listeners. */
	public handleLeaderboardLoaded(_data: any): void { /* rien ici pour l'instant */ }

	/* Confirme la création d'un match et rafraîchit stats, historique et classement. */
	public handleMatchCreated(data: any, showSuccessPopup: (m: string) => void): void {
		showSuccessPopup(data.message);
		if (!this.currentUser) return;
		this.wsService.getUserStats(this.currentUser.id);
		this.wsService.getMatchHistory(this.currentUser.id);
		/* Pense aussi au classement simple */
		this.wsService.getUserRank(this.currentUser.id);
		this.wsService.getLeaderboard(20, 0);
	}

	/* Indique si un palier 2FA est en cours (temp token présent) */
	public hasPending2FA(): boolean {
		return !!this.temp2FAToken;
	}

	public clearPending2FA(): void {
		this.temp2FAToken = null;
		this.temp2FAParamName = null;
	}

	/*  Retourne true si 2FA requis (et déclenche l'événement pour l'UI), false sinon. */
	public processLoginResponse(resp: any): boolean {
		if (resp?.requires_2fa && (resp.tmp_token || resp.temp_token)) {
			const token = resp.tmp_token || resp.temp_token;
			this.temp2FAToken = token;
			this.temp2FAParamName = resp.tmp_token ? 'tmp_token' : 'temp_token';
			this.trigger('auth_requires_2fa'); // l'UI affiche le champ code
			return true;
		}
		return false;
	}

	/* Confirme le code TOTP. */
	public async confirmLogin2FA(code: string): Promise<any> {
		const c = String(code).trim();
		if (!/^\d{6}$/.test(c)) {
			throw new Error('Enter a valid 6-digit code');
		}
		if (!this.temp2FAToken) {
			throw new Error('No 2FA login in progress');
		}

		const key = this.temp2FAParamName || 'tmp_token';
		const body: any = { code: c };
		body[key] = this.temp2FAToken;

		const res = await fetch('/api/auth/login/2fa', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		let json: any = {};
		try { json = await res.json(); } catch { }

		if (!res.ok) {
			if (json?.code === 'ALREADY_CONNECTED') {
				this.clearPending2FA();
				throw new Error(i18n.t('auth.errors.singleSession'));
			}
			// 429 : on relaie le message + éventuel Retry-After (pas de timer côté front)
			if (res.status === 429) {
				const ra = res.headers.get('Retry-After');
				throw new Error(`${json?.message || 'Too many attempts'}${ra ? ` (${ra}s)` : ''}`);
			}
			// 401 temp_token expiré : on réinitialise le flow
			if (res.status === 401 && /expired temp_token/i.test(json?.message || '')) {
				this.clearPending2FA();
				throw new Error('2FA session expired. Please log in again.');
			}
			// cas générique
			throw new Error(json?.message || '2FA verification failed');
		}

		// succès
		this.clearPending2FA();
		if (!json?.token || !json?.user) {
			throw new Error('2FA verification failed');
		}
		return json;
	}
}

export const authService = new AuthService(wsService, new GameEngine());
