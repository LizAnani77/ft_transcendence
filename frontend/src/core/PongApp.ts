import { Router } from '../services/Router';
import { WebSocketService } from '../services/WebSocketService';
import { GameEngine } from '../game/GameEngine';

import { AuthService } from './AuthService';
import { TournamentService } from './TournamentService';
import { FriendsService } from './FriendsService';

import { PageRenderer } from './PageRenderer';
import { ProfileRenderer } from './ProfileRenderer';
import { SocialRenderer } from './SocialRenderer';
import { GameRenderer } from './GameRenderer';
import { UIUtils } from './UIUtils';

import { ChatController } from './ChatController';
import { RemoteGameController } from './RemoteGameController';
import { WebSocketBinder } from './WebSocketBinder';
import { OtherUserProfileService } from './OtherUserProfileService';

import { mountTournamentPage } from './TournamentPage';

import { DashboardService } from './DashboardService';
import { DashboardRenderer } from './DashboardRenderer';

import { i18n } from './I18n';
import { GuestAuthService } from '../services/GuestAuthService';

export class PongApp {
	private router = new Router();
	private wsService = new WebSocketService();
	private gameEngine = new GameEngine();

	private uiUtils = new UIUtils();
	private authService = new AuthService(this.wsService, this.gameEngine);
	private tournamentService = new TournamentService(this.uiUtils);
	private friendsService = new FriendsService(this.wsService, this.uiUtils);
	private otherUserProfileService = new OtherUserProfileService(this.wsService, this.uiUtils);

	private dashboardService = new DashboardService(this.wsService);
	private dashboardRenderer = new DashboardRenderer();

	private pageRenderer = new PageRenderer();
	private profileRenderer = new ProfileRenderer(this.uiUtils, this.wsService);
	private socialRenderer = new SocialRenderer(this.uiUtils);
	private gameRenderer = new GameRenderer();

	private chat = new ChatController(this.wsService, this.uiUtils);
	private remote = new RemoteGameController(
		this.wsService,
		this.gameEngine,
		this.gameRenderer,
		this.uiUtils,
		() => this.navigate('/welcome')
	);

	private wsBinder = new WebSocketBinder(
		this.wsService,
		this.uiUtils,
		this.authService,
		this.friendsService,
		this.gameRenderer,
		this.remote
	);

	private currentView: string = 'home';
	private gameInitialized = false;
	private lastAuthId: number | null = null;
	private socialHandlersAttached = false;
	private oauthCallbackInFlight = false;
	private pendingOAuth2FA = false;
	private forceTwoFAView = false;
	private skipNextNavigationHandling = false;
	private forfeitFlagKey = 'tournament_forfeit_pending';
	private isLoggingOut = false;

	/* Applique l'affichage de l'interface 2FA si une authentification en deux étapes est en attente */
	private applyPending2FA(): void {
		if (!this.pendingOAuth2FA) return;
		this.pendingOAuth2FA = false;
		this.toggle2FAUI(true);
	}

	/* Réinitialise le chemin de base de l'URL en supprimant les paramètres de requête */
	private resetBasePath(): void {
		try {
			const hash = window.location.hash || '';
			if (window.location.pathname !== '/' || window.location.search) {
				window.history.replaceState({}, '', `/${hash || ''}`);
			}
		} catch { }
	}

	/* Enregistre un message de log avec préfixe [PONGAPP] */
	private log(...a: any[]) { try { console.log('[PONGAPP]', ...a); } catch { } }
	/* Enregistre un avertissement avec préfixe [PONGAPP] */
	private warn(...a: any[]) { try { console.warn('[PONGAPP]', ...a); } catch { } }

	/* Initialise l'application Pong avec tous les services et gestionnaires d'événements */
	constructor() {
		this.setupEventListeners();
		this.authService.on('auth_requires_2fa', () => {
			this.pendingOAuth2FA = true;
			this.forceTwoFAView = true;
			if (this.currentView !== 'auth') {
				this.navigate('/auth');
			} else {
				requestAnimationFrame(() => this.applyPending2FA());
			}
		});
		this.wsBinder.bindCore(
			(p) => this.navigate(p),
			() => this.loadUserData(),
			() => {
				// Ne pas re-render si on est sur chat
				if (this.currentView === 'chat') {
				console.log('🔵 [PONGAPP] Skip rerender for chat view');
				// Mais rafraîchir les badges chat
				try {
					(this.chat as any).refreshChatBadges?.();
				} catch {}
				return;
				}
				this.render();
			},
			() => this.performSessionCleanup()
			);

		i18n.onChange(() => {
			if (this.currentView === 'game') { 
				return;
			}
			this.render(); 
		});

		document.addEventListener('dashboard:refresh', () => {
			this.dashboardService.refreshStats();
		});

		this.wsService.onMessage('dashboard:stats_loaded', () => {
			if (this.currentView === 'dashboard') {
				this.render();
			}
		});

		window.addEventListener('beforeunload', () => this.cleanupTournamentSession());
	}

	/* Vérifie l'existence d'une authentification stockée et initialise le système de blocage */
	private async checkExistingAuth(): Promise<void> {
		try {
			await this.authService.checkExistingAuth();
		} catch (error) {
			console.error('[PONGAPP] Error checking existing auth:', error);
		} finally {
			this.initializeBlockingSystem();
		}
	}

	/* Configure tous les gestionnaires d'événements globaux de l'application */
	private setupEventListeners(): void {
		const handleNativeNavigation = () => {
			if (this.skipNextNavigationHandling) {
				this.skipNextNavigationHandling = false;
				return;
			}
			this.handleNavigation();
		};

		window.addEventListener('hashchange', handleNativeNavigation);
		window.addEventListener('popstate', handleNativeNavigation);

		// HANDLER DE NAVIGATION SPA
		document.addEventListener('click', (e) => {
			const target = e.target as HTMLElement | null; 
			if (!target) return;
			
			if (document.querySelector('.overlay-game-invite') || document.body.getAttribute('data-invite-open') === '1') return;

			const me = e as MouseEvent;
			if (me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) return;

			const a = target.closest('a[data-link]') as HTMLAnchorElement | null;
			if (!a) return;

			const href = a.getAttribute('href') || a.dataset.link || '';
			try {
				const url = new URL(href, window.location.origin);
				if (url.origin !== window.location.origin) return;
			} catch { }

			e.preventDefault();
			this.navigate(a.dataset.link || href || '/');
		}, true);

		// HANDLER GLOBAL UNIQUE POUR TOUTES LES ACTIONS
		document.addEventListener('click', (e) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;

			// Chercher l'élément avec data-action
			const actionElement = target.closest('[data-action]') as HTMLElement | null;
			if (!actionElement) return;

			const action = actionElement.getAttribute('data-action');
			if (!action) return;

			console.log('[PONGAPP] 🎯 Action detected:', action);

			// CHALLENGE OPPONENT - GESTION COMPLÈTE (supporte users ET guests)
			if (action === 'challenge-friend' || action === 'challenge-opponent') {
				e.preventDefault();
				e.stopPropagation();

				const opponentUserIdStr = actionElement.getAttribute('data-friend-id') || actionElement.getAttribute('data-opponent-user-id');
				const tournamentIdStr = actionElement.getAttribute('data-tournament-id');
				const matchIdStr = actionElement.getAttribute('data-match-id');
				const isTournamentContext = actionElement.getAttribute('data-tournament-context') === 'true';

				console.log('[PONGAPP] ✅ Challenge button clicked', {
					opponentUserId: opponentUserIdStr,
					tournamentId: tournamentIdStr,
					matchId: matchIdStr,
					isTournamentContext
				});

				// Vérifier qu'on a un userId (peut être négatif pour les guests)
				if (!opponentUserIdStr || opponentUserIdStr === '') {
					console.error('[PONGAPP] ❌ Missing opponent user ID');
					return;
				}

				const opponentUserId = parseInt(opponentUserIdStr, 10);
				if (isNaN(opponentUserId)) {
					console.error('[PONGAPP] ❌ Invalid opponentUserId:', opponentUserIdStr);
					return;
				}

				// Challenge avec contexte tournoi
				if (isTournamentContext && tournamentIdStr && matchIdStr) {
					const tournamentId = parseInt(tournamentIdStr, 10);
					const matchId = parseInt(matchIdStr, 10);

					if (!isNaN(tournamentId) && !isNaN(matchId)) {
						console.log('[PONGAPP] ✅ Challenge opponent with tournament context:', {
							opponentUserId,
							isGuest: opponentUserId < 0,
							tournamentId,
							matchId
						});
						this.challengeFriendWithTournament(opponentUserId, tournamentId, matchId);
						return;
					}
				}

				// Challenge standard
				console.log('[PONGAPP] ✅ Standard challenge:', { opponentUserId, isGuest: opponentUserId < 0 });
				this.challengeFriend(opponentUserId);
				return;
			}

			// AUTRES ACTIONS SOCIALES
			const userId = parseInt(actionElement.getAttribute('data-id') || actionElement.getAttribute('data-friend-id') || '0');

			switch (action) {
				case 'add-friend':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Adding friend:', userId);
						e.preventDefault();
						e.stopPropagation();
						this.addFriend(userId);
					}
					break;

				case 'accept-friend':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Accepting friend:', userId);
						e.preventDefault();
						e.stopPropagation();
						this.acceptFriend(userId);
					}
					break;

				case 'decline-friend':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Declining friend:', userId);
						e.preventDefault();
						e.stopPropagation();
						this.declineFriend(userId);
					}
					break;

				case 'remove-friend':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Removing friend:', userId);
						e.preventDefault();
						e.stopPropagation();
						this.removeFriend(userId);
					}
					break;

				case 'unblock-user':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Unblocking user:', userId);
						e.preventDefault();
						e.stopPropagation();
						this.unblockUserFromProfile(userId);
					}
					break;

				case 'block-user':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Blocking user:', userId);
						e.preventDefault();
						e.stopPropagation();
						this.blockUserFromProfile(userId);
					}
					break;

				case 'chat-with-user':
					if (userId > 0) {
						console.log('[PONGAPP] ✅ Starting chat with user:', userId);
						e.preventDefault();
						e.stopPropagation();
						try {
							sessionStorage.setItem('chatSelectUserId', userId.toString());
						} catch (error) {
							console.warn('[PONGAPP] Cannot store in sessionStorage:', error);
						}
						this.navigate('/chat');
					}
					break;

				case 'oauth42-login':
					e.preventDefault();
					e.stopPropagation();
					this.startOAuth42Login();
					break;

				case 'join-tournament':
					{
						const tournamentId = actionElement.getAttribute('data-tournament-id');
						if (tournamentId) {
							console.log('[PONGAPP] ✅ Joining tournament:', tournamentId);
							e.preventDefault();
							e.stopPropagation();

							// Rejoindre directement sans navigation
							const currentUser = this.authService?.getCurrentUser?.();
							const playerAlias = currentUser?.username || `Guest${Date.now()}`;
							const userId = currentUser?.id;
							const tid = parseInt(tournamentId, 10);

							if (!isNaN(tid)) {
								this.tournamentService.joinTournament(tid, playerAlias, userId)
									.then(() => {
										console.log('[PONGAPP] Successfully joined tournament:', tid);
										this.uiUtils.showSuccessPopup('Successfully joined the tournament!');
										// Rediriger vers la page tournoi après succès
										setTimeout(() => {
											this.navigate('/tournament');
										}, 1000); // Délai pour voir le popup de succès
									})
									.catch((error) => {
										console.error('[PONGAPP] Failed to join tournament:', error);

										let errorMessage = 'Unable to join tournament';
										const errorStr = error?.message || error?.toString() || '';

										if (errorStr.includes('finished') || errorStr.includes('completed')) {
											errorMessage = 'This tournament has already finished';
										} else if (errorStr.includes('cancelled') || errorStr.includes('canceled')) {
											errorMessage = 'This tournament has been cancelled';
										} else if (errorStr.includes('full') || errorStr.includes('maximum')) {
											errorMessage = 'This tournament is full';
										} else if (errorStr.includes('started') || errorStr.includes('in progress')) {
											errorMessage = 'This tournament has already started';
										}

										this.uiUtils.showErrorPopup(errorMessage);
									});
							}
						}
					}
					break;

				default:
					console.log('[PONGAPP] ℹ️ Unhandled action:', action);
					break;
			}
		}, { capture: true });

		// Handler pour annuler 2FA
		document.addEventListener('click', (e) => {
			const t = e.target as HTMLElement | null; 
			if (!t) return;
			const cancel = t.closest('#twofa-cancel') as HTMLElement | null;
			if (!cancel) return;
			this.authService.clearPending2FA();
			this.toggle2FAUI(false);
		});

		// Handler pour les formulaires
		document.addEventListener('submit', (e) => {
			const f = e.target as HTMLFormElement;
			e.preventDefault();

			if (f.id === 'login-form' || f.id === 'register-form') {
				const fd = new FormData(f), u = (fd.get('username') as string || '').trim(), p = (fd.get('password') as string || '').trim();
				if (!u || !p) return this.uiUtils.showErrorPopup('Please fill all fields');

				if (f.id === 'login-form') {
					return this.handleLoginSubmit(u, p, f);
				} else {
					return this.wsService.register(u, p);
				}
			}

			if (f.id === 'login-2fa-form') {
				const fd = new FormData(f);
				const code = String(fd.get('code') || '').trim();
				if (!code) return this.uiUtils.showErrorPopup('Please enter your 2FA code');
				return this.handle2FAVerify(code);
			}

			if (f.id === 'profile-form') {
				const fd = new FormData(f), me = this.authService.getCurrentUser(), updates: any = {};
				const name = fd.get('username') as string, mail = fd.get('email') as string, avatar = fd.get('avatar_url') as string;
				if (me) {
					if (name && name !== me.username) updates.username = name;
					if (mail && mail !== me.email) updates.email = mail;
					if (avatar !== me.avatar_url) updates.avatar_url = avatar || null;
				}
				return Object.keys(updates).length
					? this.wsService.updateProfile(updates)
					: this.uiUtils.showErrorPopup('No changes to save');
			}

			if (f.id === 'search-users-form') {
				const q = (new FormData(f).get('query') as string)?.trim();
				return q && q.length >= 2
					? this.wsService.searchUsers(q)
					: this.uiUtils.showErrorPopup('Search term must be at least 2 characters');
			}
		});
	}

	/* SYSTÈME DE BLOCAGE */

	/* Bloque un utilisateur depuis son profil et met à jour l'interface */
	public async blockUserFromProfile(userId: number): Promise<void> {
		try {
			this.uiUtils.showLoadingPopup('Blocking user...');

			const success = await this.otherUserProfileService.blockUser(userId);

			if (success) {
				this.chat.addBlockedUser(userId);

				const userData = await this.otherUserProfileService.loadOtherUserData(userId);

				if (userData && this.currentView === 'profile') {
					const currentUserId = this.router.isViewingOtherUserProfile().userId;
					if (currentUserId === userId) {
						this.render();
					}
				}

				await this.syncBlockingState();
				this.uiUtils.showSuccessPopup('User blocked successfully');
			} else {
				this.uiUtils.showErrorPopup('Unable to block this user');
			}
		} catch (error) {
			console.error('[APP] Error blocking user:', error);
			this.uiUtils.showErrorPopup('Error while blocking user');
		} finally {
			this.uiUtils.hideLoadingPopup();
		}
	}

	/* Débloque un utilisateur depuis son profil et met à jour l'interface */
	public async unblockUserFromProfile(userId: number): Promise<void> {
		try {
			this.uiUtils.showLoadingPopup('Unblocking user...');

			const success = await this.otherUserProfileService.unblockUser(userId);

			if (success) {
				this.chat.removeBlockedUser(userId);

				const userData = await this.otherUserProfileService.loadOtherUserData(userId);

				if (userData && this.currentView === 'profile') {
					const currentUserId = this.router.isViewingOtherUserProfile().userId;
					if (currentUserId === userId) {
						this.render();
					}
				}

				await this.syncBlockingState();
				this.uiUtils.showSuccessPopup('User unblocked successfully');
			} else {
				this.uiUtils.showErrorPopup('Unable to unblock this user');
			}
		} catch (error) {
			console.error('[APP] Error unblocking user:', error);
			this.uiUtils.showErrorPopup('Error while unblocking user');
		} finally {
			this.uiUtils.hideLoadingPopup();
		}
	}

	/* Synchronise l'état de blocage entre le chat et les amis */
	private async syncBlockingState(): Promise<void> {
		try {
			await this.chat.refreshBlockedUsers();
			this.wsService.getFriends();
			console.log('[APP] Blocking state synchronized');
		} catch (error) {
			console.error('[APP] Error synchronizing blocking state:', error);
		}
	}

	/* Gère les changements de statut de blocage d'un utilisateur */
	private handleBlockingStatusChange(data: any): void {
		const { userId, isBlocked } = data;

		if (!userId) return;

		if (isBlocked) {
			this.chat.addBlockedUser(userId);
		} else {
			this.chat.removeBlockedUser(userId);
		}

		const isProfile = this.router.getView(this.router.getCurrentRoute()) === 'profile';
		const currentUserId = this.router.getUrlParam('user');

		if (isProfile && currentUserId === String(userId)) {
			this.render();
		}

		const message = isBlocked ? 'User blocked' : 'User unblocked';
		this.uiUtils.showSuccessPopup(message);
	}

	/* Initialise les gestionnaires WebSocket pour les événements de blocage et d'amitié */
	private initializeBlockingWebSocketHandlers(): void {
		this.wsService.onMessage('user:blocking_status_changed', (msg: any) => {
			this.handleBlockingStatusChange(msg.data || msg);
		});

		this.wsService.onMessage('friends:list_updated', () => {
			try { (this.wsService as any).getFriends?.(); } catch { }
			try { (this.wsService as any).getFriendRequests?.(); } catch { }
			this.render();
			requestAnimationFrame(() => (this.chat as any).refreshChatBadges?.());
		});

		['friends:request_received', 'friend_accepted', 'friends:request_declined']
			.forEach(evt => this.wsService.onMessage(evt, () => {
				try { (this.wsService as any).getFriends?.(); } catch { }
				try { (this.wsService as any).getFriendRequests?.(); } catch { }
				this.render();
				requestAnimationFrame(() => (this.chat as any).refreshChatBadges?.());
			}));
	}

	/* Vérifie si un utilisateur est bloqué */
	public isUserBlocked(userId: number): boolean {
		return this.chat.isBlocked(userId);
	}

	/* Retourne la liste des IDs des utilisateurs bloqués */
	public getBlockedUsers(): number[] {
		return Array.from(this.chat.getBlockedUsers());
	}

	/* Filtre une liste d'utilisateurs pour exclure les utilisateurs bloqués */
	public filterBlockedUsers<T extends { id: number }>(users: T[]): T[] {
		return users.filter(user => !this.isUserBlocked(user.id));
	}

	/* Initialise le système de blocage avec les gestionnaires WebSocket */
	public initializeBlockingSystem(): void {
		console.log('[APP] Initializing blocking system...');

		this.initializeBlockingWebSocketHandlers();

		this.chat.refreshBlockedUsers().then(() => {
			console.log('[APP] Blocking system initialized');
		}).catch(error => {
			console.error('[APP] Error initializing blocking system:', error);
		});
	}

	/* DASHBOARD */

	/* Charge les données du tableau de bord si elles ne sont pas déjà chargées */
	private loadDashboardData(): void {
		if (!this.dashboardService.hasData() && !this.dashboardService.isLoadingStats()) {
			this.dashboardService.loadStats();
		}
	}

	/* DÉMARRAGE ET NAVIGATION */

	/* Démarre l'application et initialise la connexion WebSocket */
	public async start(): Promise<void> {
		this.handlePendingForfeitOnReload();
		await this.checkExistingAuth();
		await this.wsService.connect();
		this.gameRenderer.bindWebSocket(this.wsService);
		(window as any).pongApp = this;
		this.handleNavigation();
	}

	/* Navigue vers un chemin donné et nettoie les ressources de la vue précédente */
	public navigate(path: string): void {
		this.resetBasePath();

		this.skipNextNavigationHandling = true;
		this.router.navigateTo(path);
		this.handleNavigation();
	}

	/* Gère la navigation en mettant à jour la vue actuelle et en rechargeant les données */
	private handleNavigation(): void {
		const previousView = this.currentView;
		const targetView = this.router.getView(this.router.getCurrentRoute());
		const leavingGameView = previousView === 'game' && targetView !== 'game';
		const activeTournamentGame =
			typeof this.remote.isActiveTournamentGame === 'function' &&
			this.remote.isActiveTournamentGame();

		// Empêcher un guest en tournoi (en attente de match) d'ouvrir /game sans contexte remote
		if (targetView === 'game' && !this.authService.getCurrentUser()) {
			const state = this.tournamentService.getTournamentState();
			const hasTournament = !!this.tournamentService.getCurrentTournamentId();
			let hasPendingRemote = false;
			try { hasPendingRemote = !!sessionStorage.getItem('pendingRemoteGameId'); } catch { }

			// Bloquer les guests inscrits à un tournoi tant qu'ils n'ont pas de gameId à rejoindre
			if (hasTournament && !hasPendingRemote && (!state?.champion || state?.active || state?.tournamentStatus !== 'finished')) {
				this.uiUtils.showErrorPopup(i18n.t('tournament.ui.activeTournament'));
				this.router.navigateTo('/tournament');
				this.currentView = 'tournament';
				this.render();
				return;
			}
		}

		if (!this.isLoggingOut && leavingGameView && activeTournamentGame) {
			this.log('[PONGAPP] Dropping WS to trigger tournament forfeit on navigation', { targetView, previousView });
			try {
				(this.wsService as any)?.dropAndReconnect?.('tournament_forfeit_navigation');
			} catch (e) {
				this.warn('Failed to drop connection before navigation:', e);
			}
		}

		if (leavingGameView) {
			this.log('Leaving game view - cleaning up GameEngine');
			this.remote.unbindRemoteControls(true);
			try { (this.gameEngine as any)?.reset?.(); } catch { }
			this.gameInitialized = false;
		}

		if (previousView === 'tournament' && targetView !== 'tournament') {
			this.log('Leaving tournament view - triggering cleanup');
			try {
				const cleanup = (window as any).__tournamentPageCleanup;
				if (typeof cleanup === 'function') {
					cleanup();
					this.log('✅ Tournament cleanup executed successfully');
				} else {
					this.warn('⚠️ Tournament cleanup function not found');
				}
			} catch (e) {
				console.error('[PONGAPP] Tournament cleanup error:', e);
			}
		}

		this.currentView = targetView;
		if (this.currentView !== 'oauth42-callback') {
			this.oauthCallbackInFlight = false;
		}

		if (this.currentView === 'dashboard') {
			this.loadDashboardData();
		}

		// Rafraîchir les demandes d'amis à l'entrée sur la page Friends
		if (this.currentView === 'friends') {
			try {
				this.wsService.getFriendRequests();
				this.wsService.getFriends();
			} catch { }
		}

		this.render();
	}

	/* INTERACTIONS SOCIALES */

	/* Envoie une demande d'ami à un utilisateur */
	public addFriend(friendId: number): void {
		this.log('✅ Adding friend:', friendId);
		this.friendsService.addFriend(friendId);
	}

	/* Accepte une demande d'ami */
	public acceptFriend(friendId: number): void { 
		this.log('✅ Accepting friend:', friendId);
		this.friendsService.acceptFriend(friendId);
	}

	/* Refuse une demande d'ami */
	public declineFriend(friendId: number): void { 
		this.log('✅ Declining friend:', friendId);
		this.friendsService.declineFriend(friendId);
	}

	/* Supprime un ami de la liste d'amis */
	public removeFriend(friendId: number): void { 
		this.log('✅ Removing friend:', friendId);
		this.friendsService.removeFriend(friendId);
	}

	/* Défie un ami en partie en vérifiant son statut en ligne */
	public challengeFriend(friendId: number): void {
		this.log('[PONGAPP] ✅ Attempting to challenge user:', friendId);
		
		// 1. Vérifier dans la liste des amis (mis à jour en temps réel)
		const friend = this.friendsService.getFriends().find(f => f.id === friendId);
		
		// 2. Vérifier dans le cache du profil
		const otherUserData = this.otherUserProfileService.getCachedUserData(friendId);
		
		// 3. Vérifier dans la liste globale des utilisateurs en ligne
		const onlineUser = this.wsBinder.getOnlineUsers().find(u => u.id === friendId);
		
		// Vérifier le statut en ligne (priorité : ami > liste globale > cache profil)
		const isOnline = friend?.is_online || onlineUser?.is_online || otherUserData?.user?.is_online;
		
		console.log('[PONGAPP] User online status:', {
			friendId,
			isOnline,
			fromFriend: friend?.is_online,
			fromGlobalList: onlineUser?.is_online,
			fromCache: otherUserData?.user?.is_online,
			source: friend ? 'friendsList' : onlineUser ? 'globalOnlineList' : 'cachedProfile'
		});
		
		if (!isOnline) {
			this.uiUtils.showErrorPopup('User is offline');
			return;
		}
		
		// Envoyer le challenge
		this.wsService.challengeUser(friendId);
	}

	/* Défie un adversaire avec le contexte d'un tournoi spécifique */
	public challengeFriendWithTournament(friendId: number, tournamentId: number, matchId: number): void {
		this.log('[PONGAPP] ✅ Challenging opponent with tournament context:', {
			opponentId: friendId,
			isGuest: friendId < 0,
			tournamentId,
			matchId
		});
		
		this.wsService.challengeUser(friendId, tournamentId, matchId);
	}

	/* Rafraîchit l'historique des matchs de l'utilisateur actuel */
	public refreshMatchHistory(): void {
		const me = this.authService.getCurrentUser();
		if (me) {
			this.wsService.getMatchHistory(me.id, 20);
			this.uiUtils.showSuccessPopup('Match history refreshed!');
		}
	}

	/* Déconnecte l'utilisateur et nettoie la session */
	public logout(): void {
		this.isLoggingOut = true;

		const activeTournamentGame =
			this.currentView === 'game' &&
			typeof this.remote.isActiveTournamentGame === 'function' &&
			this.remote.isActiveTournamentGame();
		if (activeTournamentGame) {
			this.log('[PONGAPP] Logout during tournament game - skipping WS drop to avoid reconnect loop');
			try { sessionStorage.removeItem('pendingRemoteGameId'); } catch { }
			// Ne pas drop/reconnect ici, la fermeture sera gérée par logout WS
		}

		this.cleanupTournamentSession();
		this.authService.logout();
		try { this.tournamentService.resetTournament(false); } catch (e) { this.warn('Failed to reset tournament on logout:', e); }
		this.uiUtils.showSuccessPopup('You have been logged out!');
		this.navigate('/welcome');
		this.isLoggingOut = false;
	}

	/* Empêche un rejoin automatique après un forfeit déclenché (F5/logout/nav) */
	private handlePendingForfeitOnReload(): void {
		try {
			const flag = sessionStorage.getItem(this.forfeitFlagKey);
			if (!flag) return;

			sessionStorage.removeItem(this.forfeitFlagKey);
			sessionStorage.removeItem('pendingRemoteGameId');

			// Si on recharge sur /game après un forfait, rediriger vers la page tournoi
			const route = this.router.getCurrentRoute();
			if (route === '/game') {
				this.log('[PONGAPP] Forfeit flag detected - redirecting away from game');
				this.navigate('/tournament');
			}
		} catch { }
	}

	/* Nettoie la session de tournoi en cours lors de la déconnexion ou du départ */
	private cleanupTournamentSession(): void {
		try {
			const tournamentId = this.tournamentService.getCurrentTournamentId();
			if (!tournamentId) return;

			const state = this.tournamentService.getTournamentState();
			const status = state.tournamentStatus || (state.active ? 'active' : undefined);
			const hasChampion = !!state.champion;
			const shouldForfeit =
				state.active ||
				status === 'waiting' ||
				(!status && !hasChampion);

			if (shouldForfeit) {
				try {
					sessionStorage.setItem(this.forfeitFlagKey, '1');
					sessionStorage.removeItem('pendingRemoteGameId');
				} catch { }
				this.tournamentService.declareForfeit('disconnected').catch(() => {});
			} else {
				this.tournamentService.quitTournament().catch(() => {});
			}
		} catch (error) {
			this.warn('Tournament auto-cleanup failed on unload:', error);
		}
	}

	/* Nettoie complètement la session lors de transitions Guest ↔ User */
	private performSessionCleanup(): void {
		console.log('[PONGAPP] ✅ Performing full session cleanup');

		// 1. Nettoyer le ChatController
		try {
			this.chat.cleanup();
			console.log('[PONGAPP] ✅ ChatController cleaned up');
		} catch (e) {
			console.error('[PONGAPP] ❌ ChatController cleanup failed:', e);
		}

		// 2. Nettoyer le GameRenderer (avatars, etc.)
		try {
			this.gameRenderer.fullSessionCleanup();
			console.log('[PONGAPP] ✅ GameRenderer cleaned up');
		} catch (e) {
			console.error('[PONGAPP] ❌ GameRenderer cleanup failed:', e);
		}

		// 3. Nettoyer les files de messages WebSocket
		try {
			this.wsService.clearMessageQueues();
			console.log('[PONGAPP] ✅ WebSocket message queues cleared');
		} catch (e) {
			console.error('[PONGAPP] ❌ WebSocket cleanup failed:', e);
		}

		// 4. Nettoyer le WebSocketBinder
		try {
			this.wsBinder.cleanup();
			console.log('[PONGAPP] ✅ WebSocketBinder cleaned up');
		} catch (e) {
			console.error('[PONGAPP] ❌ WebSocketBinder cleanup failed:', e);
		}

		// 5. Réinitialiser les flags
		this.socialHandlersAttached = false;
		this.gameInitialized = false;
		this.lastAuthId = null;

		console.log('[PONGAPP] ✅ Full session cleanup completed');
	}

	/* Charge les données de l'utilisateur actuel */
	private loadUserData(): void { this.authService.loadUserData(); }

	/* Bascule l'affichage de l'interface d'authentification à deux facteurs */
	private toggle2FAUI(show: boolean): void {
		const loginCard = document.getElementById('login-card') as HTMLElement | null;
		const registerCard = document.getElementById('register-card') as HTMLElement | null;
		const twofaCard = document.getElementById('twofa-card') as HTMLElement | null;
		if (!loginCard || !registerCard || !twofaCard) return;

		loginCard.style.display = show ? 'none' : '';
		registerCard.style.display = show ? 'none' : '';
		twofaCard.style.display = show ? '' : 'none';

		const err = document.getElementById('twofa-error') as HTMLElement | null;
		if (err) { err.textContent = ''; err.style.display = 'none'; }

		if (show) {
			const input = document.querySelector('#login-2fa-form input[name="code"]') as HTMLInputElement | null;
			try { input?.focus(); } catch { }
		}
	}

	/* Démarre le processus de connexion OAuth via 42 */
	private async startOAuth42Login(): Promise<void> {
		try {
			this.uiUtils.showLoadingPopup(i18n.t('auth.oauth42.button'));
			const res = await fetch('/api/auth/oauth42/url', { method: 'GET' });
			const json = await res.json().catch(() => ({}));
			if (!res.ok || !json?.url) {
				throw new Error(json?.message || 'OAuth init failed');
			}
			window.location.href = json.url;
		} catch (error) {
			console.error('[PONGAPP] OAuth42 init failed:', error);
			this.uiUtils.showErrorPopup(i18n.t('auth.oauth42.error'));
		} finally {
			this.uiUtils.hideLoadingPopup();
		}
	}

	/* Gère la soumission du formulaire de connexion */
	private async handleLoginSubmit(username: string, password: string, _form: HTMLFormElement): Promise<void> {
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			const json = await res.json().catch(() => ({}));

			if (!res.ok) {
				const msg = json?.code === 'ALREADY_CONNECTED'
					? i18n.t('auth.errors.singleSession')
					: (json?.message || i18n.t('auth.errors.generic'));
				this.uiUtils.showErrorPopup(msg);
				return;
			}

			if (this.authService.processLoginResponse(json)) return;

			await this.finalizeLogin(json);
		} catch {
			this.uiUtils.showErrorPopup('Network error while logging in');
		}
	}

	/* Vérifie le code d'authentification à deux facteurs */
	private async handle2FAVerify(code: string): Promise<void> {
		const errEl = document.getElementById('twofa-error') as HTMLElement | null;
		try {
			const json = await this.authService.confirmLogin2FA(code);
			await this.finalizeLogin(json);
		} catch (e: any) {
			if (errEl) { errEl.textContent = e?.message || 'Invalid 2FA code'; errEl.style.display = 'block'; }
		}
	}

	/* Finalise la connexion en stockant le token et en chargeant les données utilisateur */
	private async finalizeLogin(json: any): Promise<void> {
		const token = json?.token;
		const user  = json?.user;
		if (!token || !user) {
			this.uiUtils.showErrorPopup('Invalid server response');
			return;
		}

		try {
			(this.wsService as any).setAuthToken?.(token);
			localStorage.removeItem('token');
		} catch {}

		this.toggle2FAUI(false);
		this.forceTwoFAView = false;

		this.authService.handleAuthSuccess(
			json,
			() => this.loadUserData(),
			(m) => this.uiUtils.showSuccessPopup(m),
			(p) => this.navigate(p)
		);
		try { this.tournamentService.resetTournament(false); } catch (e) { this.warn('Failed to reset tournament after login:', e); }

		try {
			this.wsService.getFriends();
			this.wsService.getFriendRequests();
		} catch {}

		this.render();
	}

	/* Gère le callback OAuth de 42 après redirection */
	private async handleOAuth42Callback(): Promise<void> {
		try {
			const params = this.router.getUrlParams();
			const err = params.get('error');
			if (err) {
				this.uiUtils.showErrorPopup(i18n.t('auth.oauth42.error'));
				this.navigate('/auth');
				return;
			}

			const code = params.get('code');
			const state = params.get('state');
			if (!code || !state) {
				if (this.authService.getCurrentUser()) {
					this.navigate('/welcome');
					return;
				}
				this.uiUtils.showErrorPopup(i18n.t('auth.oauth42.error'));
				this.navigate('/auth');
				return;
			}

			const query = new URLSearchParams({ code, state });
			const res = await fetch(`/api/auth/oauth42/callback?${query.toString()}`, { method: 'GET' });
			const json = await res.json().catch(() => ({}));

			if (!res.ok) {
				const errMsg = json?.code === 'ALREADY_CONNECTED'
					? i18n.t('auth.errors.singleSession')
					: (json?.message || i18n.t('auth.oauth42.error'));
				this.uiUtils.showErrorPopup(errMsg);
				this.navigate('/auth');
				return;
			}

			if (this.authService.processLoginResponse(json)) return;

			await this.finalizeLogin(json);
		} catch (error) {
			console.error('[PONGAPP] OAuth callback handling failed:', error);
			this.uiUtils.showErrorPopup(i18n.t('auth.oauth42.error'));
			this.navigate('/auth');
		} finally {
			this.oauthCallbackInFlight = false;
			this.clearOAuthCallbackParams();
		}
	}

	/* Nettoie les paramètres de callback OAuth de l'URL */
	private clearOAuthCallbackParams(): void {
		try {
			const url = new URL(window.location.href);
			url.searchParams.delete('code');
			url.searchParams.delete('state');
			url.searchParams.delete('error');
			const qs = url.searchParams.toString();
			const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash ?? ''}`;
			window.history.replaceState({}, '', next);
		} catch { }
	}

	/* RENDU */

	/* Insère du HTML en toute sécurité en supprimant les attributs d'événements */
	private safeSetHTML(el: HTMLElement, html: string): void {
		el.innerHTML = html;
		try {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
			let node = walker.nextNode() as HTMLElement | null;
			while (node) {
				const toRemove: string[] = [];
				for (let i = 0; i < node.attributes.length; i++) {
					const attr = node.attributes[i].name;
					if (attr.toLowerCase().startsWith('on')) toRemove.push(attr);
				}
				toRemove.forEach((a) => node!.removeAttribute(a));
				node = walker.nextNode() as HTMLElement | null;
			}
		} catch { }
	}

	/* Rend la vue actuelle en fonction du routage */
	private render(): void {
			const app = document.getElementById('app');
			if (!app) return;

			const user = this.authService.getCurrentUser();
			const protectedViews = ['profile', 'friends', 'chat', 'online-game', 'dashboard'];

			if (!user && protectedViews.includes(this.currentView)) {
				this.uiUtils.showErrorPopup(i18n.t('nav.loginRequired'));
				this.navigate('/auth');
				return;
			}

			if (this.currentView !== 'game') {
				this.gameInitialized = false;
				(this.gameEngine as any)?.destroy?.();
				this.remote.unbindRemoteControls(true);
				this.remote.unbindEscape();
				this.remote.removeEscHint();
			}

			switch (this.currentView) {
				case 'welcome':
					this.safeSetHTML(app, this.pageRenderer.renderWelcomePage(
						user,
						this.authService.getUserStats(),
						this.friendsService.getFriendRequests()
					));
					requestAnimationFrame(() => this.chat.refreshChatBadges());
					break;

				case 'auth':
					if (user) {
						this.navigate('/welcome');
						return;
					}

					this.safeSetHTML(app, this.pageRenderer.renderAuth(user));
					requestAnimationFrame(() => {
						this.authService.clearAuthForms();
						if (this.pendingOAuth2FA) {
							this.applyPending2FA();
						} else if (this.forceTwoFAView) {
							this.toggle2FAUI(true);
						}
					});
					break;

				case 'game': {
					const authId = user?.id ?? null;
					if (this.gameInitialized && this.lastAuthId === authId) break;

					this.safeSetHTML(app, this.gameRenderer.renderGame(user, null));
					this.gameRenderer.mountCanvas();

					// Vérifier si on rejoint une partie remote (après F5 par exemple)
					let pending: string | null = null;
					try {
						pending = sessionStorage.getItem('pendingRemoteGameId');
					} catch (e) {
						console.error('[PONGAPP] Cannot read sessionStorage:', e);
					}

					const alreadyRemote = this.gameEngine.isRemote();

					if (pending || alreadyRemote) {
						this.tryConsumePendingRemoteGame();
						this.gameInitialized = true;
						break;
					}

					// Bloquer le mode local pour les utilisateurs connectés
					if (user) {
						this.uiUtils.showErrorPopup(i18n.t('game.online.noActiveGame'));
						this.navigate('/welcome');
						break;
					}

					this.initializeGame();
					break;
				}

				case 'tournament':
					mountTournamentPage(app);
					break;

				case 'profile': {
					const profileInfo = this.router.isViewingOtherUserProfile();
					if (profileInfo.isOther && profileInfo.userId !== null) {
						const cachedData = this.otherUserProfileService.getCachedUserData(profileInfo.userId);
						let isLoading = this.otherUserProfileService.isLoadingUser(profileInfo.userId);

						if (!cachedData && !isLoading) {
							isLoading = true;
							this.otherUserProfileService.loadOtherUserData(profileInfo.userId)
								.then(() => this.render())
								.catch(() => this.render());
						}

						const showLoading = !cachedData && isLoading;

						this.safeSetHTML(app, this.profileRenderer.renderOtherUserProfile(user, cachedData, showLoading));
						requestAnimationFrame(() => {
							if (profileInfo.userId !== null) {
								this.attachOtherUserProfileEvents(profileInfo.userId);
							}
						});
					} else {
						this.safeSetHTML(app, this.profileRenderer.renderProfile(
							user,
							this.authService.getUserStats(),
							this.friendsService.getMatchHistory()
						));
						requestAnimationFrame(() => {
							this.profileRenderer.attachAvatarEvents();
							this.profileRenderer.attachTwoFAEvents();
						});
					}
					break;
				}

				case 'friends':
					this.safeSetHTML(app, this.socialRenderer.renderFriends(
						user,
						this.friendsService.getFriends(),
						this.friendsService.getFriendRequests(),
						this.friendsService.getSearchResults()
					));
					requestAnimationFrame(() => {
						if (!this.socialHandlersAttached) {
							this.socialRenderer.attachEventListeners();
							this.socialHandlersAttached = true;
						}
					});
					break;

				case 'chat':
					this.safeSetHTML(app, this.socialRenderer.renderChat(user, this.friendsService.getFriends()));
					requestAnimationFrame(() => {
						this.chat.bindChatHandlers(this.currentView);
						this.chat.switchToConversation('global');
						this.socialRenderer.attachEventListeners();
					});
					break;

				case 'dashboard':
					this.safeSetHTML(app, this.dashboardRenderer.renderDashboard(
						user,
						this.dashboardService.getDashboardData(),
					));
					requestAnimationFrame(() => {
						this.dashboardRenderer.attachEventListeners();
					});
					break;

				case 'online-game': {
					this.safeSetHTML(app, this.pageRenderer.renderOnlineGame(
						user,
						this.friendsService.getFriends()
					));
					break;
				}

				case 'oauth42-callback':
					this.safeSetHTML(app, this.pageRenderer.renderOAuth42Callback(user));
					if (!this.oauthCallbackInFlight) {
						this.oauthCallbackInFlight = true;
						requestAnimationFrame(() => this.handleOAuth42Callback());
					}
					break;

				case '404':
				default:
					this.safeSetHTML(app, this.pageRenderer.render404(user));
			}

			const hasSidebar = !!app.querySelector('.sidebar-nav');
			app.classList.toggle('with-sidebar', hasSidebar);
			app.classList.toggle('with-nav',     hasSidebar);
			app.classList.toggle('no-nav',      !hasSidebar);

			this.lastAuthId = this.authService.getCurrentUser()?.id ?? null;
		}

	/* UI */

	/* Attache les gestionnaires d'événements pour le profil d'un autre utilisateur */
	private attachOtherUserProfileEvents(userId: number): void {
		const blockButton = document.getElementById('profile-block-btn');
		if (blockButton) {
			// Cloner le bouton pour supprimer tous les anciens event listeners
			const newButton = blockButton.cloneNode(true) as HTMLElement;
			blockButton.parentNode?.replaceChild(newButton, blockButton);

			const handleBlockAction = (e: Event) => {
				e.preventDefault();
				e.stopPropagation();

				const buttonText = (newButton.textContent || '').toLowerCase();

				// Comparaison insensible à la casse pour toutes les langues
				if (buttonText.includes('block') || buttonText.includes('bloquer') || buttonText.includes('bloquear')) {
					console.log('[PONGAPP] 🔴 Blocking user:', userId);
					this.blockUserFromProfile(userId);
				} else if (buttonText.includes('unblock') || buttonText.includes('débloquer') || buttonText.includes('desbloquear')) {
					console.log('[PONGAPP] 🟢 Unblocking user:', userId);
					this.unblockUserFromProfile(userId);
				} else {
					console.warn('[PONGAPP] ⚠️ Unknown button text:', buttonText);
				}
			};

			newButton.addEventListener('click', handleBlockAction);
		}
	}

	/* JEU */

	/* Initialise le moteur de jeu en mode local ou remote selon le contexte */
	private initializeGame(): void {
		// Détecter le type de match AVANT de vérifier isRemote()
		// Pour éviter le bug : remote → local où les paddles disparaissent
		
		let isPendingRemoteGame = false;
		let pendingGameId: string | null = null;
		
		try {
			pendingGameId = sessionStorage.getItem('pendingRemoteGameId');
			isPendingRemoteGame = !!pendingGameId;
		} catch { }

		this.log('initializeGame called', { 
			isPendingRemoteGame, 
			pendingGameId,
			isCurrentlyRemote: this.gameEngine.isRemote() 
		});

		// CAS 1 : Match REMOTE en attente
		if (isPendingRemoteGame) {
			this.log('initializeGame: pending remote game detected -', pendingGameId);
			
			// Si déjà en mode remote, juste monter le canvas
			if (this.gameEngine.isRemote()) {
				this.gameRenderer.mountCanvas();
				this.gameInitialized = true;
				return;
			}
			
			// Si pendingRemoteGameId existe mais isRemote() est false, 
			// on attend que tryConsumePendingRemoteGame() l'initialise
			this.log('initializeGame: waiting for remote game initialization');
			this.gameInitialized = true;
			return;
		}

		// CAS 2 : Match LOCAL (pas de pendingRemoteGameId)
		// Si on arrive ici sans pendingRemoteGameId, c'est FORCÉMENT un match local
		// On DOIT reset le GameEngine même s'il était en mode remote avant
		// C'est ici que se situe le bug : sans ce reset, isRemoteMode reste true
		this.log('initializeGame: local game detected - forcing reset');
		
		// S'assurer que pendingRemoteGameId est bien vide
		try {
			const orphanedGameId = sessionStorage.getItem('pendingRemoteGameId');
			if (orphanedGameId) {
				this.warn('⚠️ Found orphaned pendingRemoteGameId, cleaning:', orphanedGameId);
				sessionStorage.removeItem('pendingRemoteGameId');
			}
		} catch { }
		
		const cu = this.authService.getCurrentUser();
		
		// Reset FORCÉ pour nettoyer l'état remote précédent
		this.gameEngine.reset();
		
		// Initialiser le jeu local avec paddles et logique locale
		this.gameEngine.initializeForTournament(
			'game-canvas',
			cu ? cu.username : 'Player 1',
			'Player 2',
			(winner: string) => this.authService.saveMatchResult(winner, null, (m) => this.uiUtils.showSuccessPopup(m)),
			false
		);
		this.gameInitialized = true;
	}

	/* API tournois historique - Méthodes conservées pour compatibilité */
	/* Ajoute un joueur au tournoi */
	public addPlayer(): void { 
		this.tournamentService.addPlayer(); 
		this.render();
	}

	/* Retire un joueur du tournoi par son index */
	public removePlayer(index: number): void { 
		this.tournamentService.removePlayer(index); 
		this.render();
	}

	/* Démarre le tournoi en tant que propriétaire */
	public startTournament(): void {
		if (this.tournamentService.canStartTournament()) {
			this.tournamentService.startTournamentAsOwner()
				.then(() => this.render())
				.catch(error => {
					console.error('Failed to start tournament:', error);
					this.render();
				});
		} else {
			this.uiUtils.showErrorPopup('Cannot start tournament');
			this.render();
		}
	}

	/* Génère le prochain match du tournoi */
	public generateNextMatch(): void { 
		this.tournamentService.generateNextMatch(); 
		this.render();
	}

	/* Lance le match en cours du tournoi */
	public playCurrentMatch(): void { 
		this.tournamentService.playCurrentMatch(); 
		this.navigate('/game');
	}

	/* Déclare le gagnant d'un match de tournoi */
	public declareWinner(winner: string): void { 
		this.tournamentService.declareWinner(winner); 
		this.render();
	}

	// Variable pour éviter les double appels
	private isConsumingPendingGame = false;

	/* Consomme une partie remote en attente et initialise le mode remote pour users et guests */
	private tryConsumePendingRemoteGame(): void {
		// Guard contre les appels multiples
		if (this.isConsumingPendingGame) {
			console.log('[PONGAPP] ⚠️ Already consuming pending game, skipping duplicate call');
			return;
		}

		const pending = sessionStorage.getItem('pendingRemoteGameId');
		this.log('✅ tryConsumePendingRemoteGame check', { hasPending: !!pending, pendingValue: pending });
		
		if (!pending) {
			return;
		}

		// Ne pas rejoin si un forfait a été marqué (logout/nav/F5)
		try {
			const forfeitFlag = sessionStorage.getItem(this.forfeitFlagKey);
			if (forfeitFlag) {
				this.warn('Forfeit flag present - skipping pending remote game rejoin');
				sessionStorage.removeItem('pendingRemoteGameId');
				return;
			}
		} catch { }

		// Marquer comme en cours
		this.isConsumingPendingGame = true;
		console.log('[PONGAPP] 🔒 Locked - consuming pending game:', pending);

		let attempts = 0;
		const maxAttempts = 100;
		
		const tick = () => {
			attempts++;
			
			// Vérifier d'abord si c'est un user normal avec getCurrentUser
			const me = this.authService.getCurrentUser();
			
			const socketReady =
				(this as any).wsService?.isConnected?.() ||
				(this as any).wsService?.['socket']?.readyState === 1;

			this.log('pendingRemoteGameId tick', { 
				attempts, 
				meId: me?.id ?? null, 
				socketReady 
			});

			// CAS 1: User enregistré normal (priorité)
			if (me && me.id && socketReady) {
				try {
					this.log('✅ Initializing remote mode with registered user', { 
						gameId: pending, 
						userId: me.id 
					});
					
					this.gameEngine.initializeRemoteMode(pending, this.wsService, me.id);
					this.wsService.joinRemoteGame(pending);
				} finally {
					try { 
						sessionStorage.removeItem('pendingRemoteGameId'); 
						this.log('✅ pendingRemoteGameId cleared'); 
					} catch { }
					
					this.isConsumingPendingGame = false;
					console.log('[PONGAPP] 🔓 Unlocked - pending game consumed (registered user)');
				}
				return;
			}

			// CAS 2: Guest (seulement si pas de user normal)
			if (!me && socketReady) {
				const isGuest = GuestAuthService.isGuest();
				
				if (isGuest) {
					const userIdentifier = GuestAuthService.getUserIdentifier();
					
					if (userIdentifier.guestToken) {
						try {
							// Calculer l'ID négatif depuis le token
							const effectiveUserId = userIdentifier.guestToken.split('_')[1].substring(0, 8).split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) * -1;
							
							this.log('✅ Initializing remote mode with guest', { 
								gameId: pending, 
								userId: effectiveUserId,
								isGuest: true
							});
							
							this.gameEngine.initializeRemoteMode(pending, this.wsService, effectiveUserId);
							this.wsService.joinRemoteGame(pending);
						} finally {
							try { 
								sessionStorage.removeItem('pendingRemoteGameId'); 
								this.log('✅ pendingRemoteGameId cleared'); 
							} catch { }
							
							this.isConsumingPendingGame = false;
							console.log('[PONGAPP] 🔓 Unlocked - pending game consumed (guest)');
						}
						return;
					}
				}
			}

			if (attempts < maxAttempts) {
				setTimeout(tick, 100);
			} else {
				this.warn('❌ Gave up waiting for auth/ws to join pending game', { gameId: pending });
				
				try {
					sessionStorage.removeItem('pendingRemoteGameId');
					this.warn('✅ Cleaned orphaned pendingRemoteGameId after timeout');
				} catch { }
				
				this.isConsumingPendingGame = false;
				console.log('[PONGAPP] 🔓 Unlocked - timeout reached');
			}
		};
		
		tick();
	}
}
