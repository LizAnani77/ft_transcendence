import { WebSocketService } from '../services/WebSocketService';
import { UIUtils } from './UIUtils';
import { AuthService } from './AuthService';
import { FriendsService } from './FriendsService';
import { GameRenderer } from './GameRenderer';
import { RemoteGameController } from './RemoteGameController';
import { i18n } from './I18n';

type OnlineUser = { id: number; username: string; is_online: boolean };

export class WebSocketBinder {
	public onlineUsers: OnlineUser[] = [];
	private lastPresenceRequest: number = 0;
	private readonly PRESENCE_COOLDOWN = 1000;
	private coreBound = false;
	private activeTimers = new Set<ReturnType<typeof setTimeout>>();
	private matchFinishedCooldownUntil = 0;
	private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private friendsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	private outgoingChallengeOverlay: HTMLElement | null = null;

	/* Initialise le binder WebSocket avec tous les services requis */
	constructor(
		private ws: WebSocketService,
		private ui: UIUtils,
		private auth: AuthService,
		private friends: FriendsService,
		private renderer: GameRenderer,
		private remote: RemoteGameController
	) { }

	/* Attache tous les gestionnaires d'événements WebSocket principaux */
	public bindCore(navigate: (path: string) => void, loadUserData: () => void, rerender: () => void, onLogoutCleanup?: () => void): void {
		if (this.coreBound) {
			console.warn('[WSB] Core already bound, skipping duplicate binding');
			return;
		}
		this.coreBound = true;

		const on = (t: string, cb: (d: any) => void) => {
			try {
				console.debug('[WSB] onMessage bind →', t);
			} catch { }
			this.ws.onMessage(t, cb);
		};

		const view = () => (window as any)?.pongApp?.['currentView'];

		on('connection', () => {
			console.debug('[WSB] WebSocket connection established');

			// 🔄 On reconnect, if the user had a tournament in memory, resync it
			try {
				const pongApp = (window as any)?.pongApp;
				const tournamentService = pongApp?.tournamentService;
				if (tournamentService && tournamentService.getCurrentTournamentId?.()) {
					console.log('[WSB] 🔄 Reconnected - refreshing current tournament state');
						tournamentService.refreshCurrentTournament()
						.then(() => {
							const alias = tournamentService.getCurrentUserAlias?.();
							const state = tournamentService.getTournamentState?.();
							const stillListed = !!alias && Array.isArray(state?.players) && state.players.some((p: any) => p?.alias === alias);
							if (!stillListed) {
								console.warn('[WSB] ⚠️ User no longer listed in tournament after reconnect - resetting UI');
								tournamentService.resetTournament(false);
								this.ui.showErrorPopup(i18n.t('tournament.activity.noLongerInTournament'));
								if (pongApp?.navigate) pongApp.navigate('/welcome');
							}
							rerender();
						})
						.catch((e: any) => {
							console.warn('[WSB] Tournament refresh on reconnect failed:', e);
						});
				}
			} catch (e) {
				console.warn('[WSB] Error during tournament resync on reconnect:', e);
			}
		});

		on('user:authenticated', (data) => {
			try {
				this.requestPresenceListSafe();
				
				// Si guest, stocker l'userId reçu
				if (data?.data?.isGuest && data?.data?.userId) {
					sessionStorage.setItem('guest_user_id', String(data.data.userId));
					console.log('[WSB] ✅ Guest userId stored from authentication:', data.data.userId);
				}
				
				console.debug('[WSB] event: user:authenticated → request presence list');
			} catch (e) {
				console.error('[WSB] Error requesting presence list on auth:', e);
			}
		});

		on('guest:alias_updated', (data) => {
			try {
				const newAlias = data?.data?.alias;
				if (newAlias) {
					console.log('[WSB] ✅ Guest alias updated confirmed by backend:', newAlias);
					sessionStorage.setItem('guest_tournament_alias', newAlias);
				}
			} catch (e) {
				console.error('[WSB] Error handling guest:alias_updated:', e);
			}
		});

		on('auth_success', (d) => {
			this.auth.handleAuthSuccess(d, loadUserData, (m: string) => this.ui.showSuccessPopup(m), navigate);
			this.requestPresenceListSafe();
			rerender();
		});

		on('auth_error', (d) => this.auth.handleAuthError(d, (m: string) => this.ui.showErrorPopup(m)));
		on('auth_logout', () => {
			this.auth.handleAuthLogout(() => this.friends.clearData());
			try {
				const pongApp = (window as any)?.pongApp;
				if (pongApp) {
					pongApp.socialHandlersAttached = false;
					const tournamentService = pongApp.tournamentService;
					try {
						if (tournamentService?.resetTournament) {
							tournamentService.resetTournament(false);
						}
					} catch (e) {
						console.warn('[WSB] Failed to reset tournament on logout:', e);
					}
				}
			} catch {}

			// Appeler le callback de cleanup centralisé
			if (onLogoutCleanup) {
				try {
					onLogoutCleanup();
					console.log('[WSB] ✅ Logout cleanup callback executed');
				} catch (e) {
					console.error('[WSB] ❌ Logout cleanup callback failed:', e);
				}
			}

			rerender();
		});
		on('user_profile_loaded', (d) => {
			this.auth.handleUserProfileLoaded(d);
			rerender();
		});

		on('profile_updated', (d) => {
			this.auth.handleProfileUpdated(d, (m: string) => this.ui.showSuccessPopup(m));
			try {
				this.renderer.syncCurrentUserAvatar(this.auth.getCurrentUser())
			} catch { }
			rerender();
		});

		on('profile_update_error', (d) => this.auth.handleProfileUpdateError(d, (m: string) => this.ui.showErrorPopup(m)));
		on('user_stats_loaded', (d) => {
			this.auth.handleUserStatsLoaded(d);
			rerender();
		});

		on('friends_loaded', (d) => {
			this.friends.handleFriendsLoaded(d);
			rerender();
		});
		on('friend_requests_loaded', (d) => {
			this.friends.handleFriendRequestsLoaded(d);
			rerender();
		});
		on('users_found', (d) => {
			this.friends.handleUsersFound(d);
			rerender();
		});
		on('friend_request_sent', (d) => {
			this.friends.handleFriendRequestSent(d);
			rerender();
		});

		const refreshFriends = () => {
			// Debounce pour éviter des GET en rafale qui peuvent déclencher des réponses non-JSON (WAF/proxy)
			if (this.friendsRefreshTimer) clearTimeout(this.friendsRefreshTimer);
			this.friendsRefreshTimer = setTimeout(() => {
				try {
					this.ws.getFriends?.();
					this.ws.getFriendRequests?.();
				} catch {}
				rerender();
				this.friendsRefreshTimer = null;
			}, 120);
		};

		on('friend_accepted', (d) => {
			this.friends.handleFriendAccepted?.(d);
			refreshFriends();
		});
		on('friend_removed', (d) => {
			this.friends.handleFriendRemoved?.(d);
			refreshFriends();
		});
		on('friend:removed', (d) => {
			this.friends.handleFriendRemoved?.(d);
			refreshFriends();
		});
		on('friend_declined', (d) => {
			this.friends.handleFriendDeclined?.(d);
			refreshFriends();
		});
		on('friend_request_error', (d) => this.friends.handleFriendRequestError(d));
		on('friends_load_error', (d) => {
			try { this.ui.showErrorPopup(d?.error || 'Failed to load friends'); } catch {}
			rerender();
		});
		on('friend_requests_error', (d) => {
			try { this.ui.showErrorPopup(d?.error || 'Failed to load friend requests'); } catch {}
		});
		on('friend:request_received', (msg) => {
			try {
				const req = msg?.data?.requester;
				console.info('[WSB] friend:request_received from', req?.id, req?.username);
			} catch { }
			this.ws.getFriendRequests();
			rerender();
		});

		on('friend:status_change', (msg) => {
			const data = msg?.data;
			if (!data || typeof data.friendId !== 'number') return;
			
			console.log('[WSB] friend:status_change received:', {
				friendId: data.friendId,
				isOnline: data.isOnline
			});
			
			const friends = this.friends.getFriends();
			const friend = friends.find(f => f.id === data.friendId);
			
			if (friend) {
				friend.is_online = !!data.isOnline;
				console.log('[WSB] ✅ Friend status updated:', {
					friendId: data.friendId,
					username: friend.username,
					isOnline: friend.is_online
				});
				
				rerender();
			}
		});

		on('match_history_loaded', (d) => {
			this.friends.handleMatchHistoryLoaded(d);
			rerender();
		});
		on('match_created', (d) => this.auth.handleMatchCreated(d, (m: string) => this.ui.showSuccessPopup(m)));

		on('chat:message', (d) => console.log('Nouveau message chat reçu:', d));
		on('chat:message_sent', (d) => console.log('Message chat envoyé avec succès:', d));
		on('chat:error', (d) => this.ui.showErrorPopup(d.message || 'Chat error occurred'));
		on('chat:conversations_loaded', (d) => console.log('Conversations chargées:', d));
		on('chat:messages_loaded', (d) => console.log('Messages de conversation chargés:', d));

		on('game:challenge_error', (d) => {
			this.closeOutgoingChallengeOverlay();
			this.ui.showErrorPopup(d?.message || 'User not online');
		});
		on('game:input_error', (d) => this.ui.showErrorPopup(d.message || 'Invalid game input'));
		on('game:create_error', (d) => this.ui.showErrorPopup(d?.message || 'Failed to create game'));
		on('game:join_error', (d) => this.ui.showErrorPopup(d?.message || 'Failed to join game'));
		on('game:error', (d) => this.ui.showErrorPopup(d?.message || 'Game error'));

		on('game:challenge_declined', () => {
			console.warn('[WSB] game:challenge_declined received');
			this.closeOutgoingChallengeOverlay();
			
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (tournamentService && tournamentService.getCurrentTournamentId()) {
				console.log('[WSB] Challenge declined in tournament context - declaring forfeit');
				tournamentService.declareForfeit('declined_invitation')
					.then(() => {
						console.log('[WSB] Forfeit declared for declined invitation');
					})
					.catch((error: any) => {
						console.error('[WSB] Error declaring forfeit:', error);
					});
			}
			
			this.remote.handleGameCancelled(i18n.t('game.online.challengeDeclined'));
		});

		on('game:challenge_cancelled', (data) => {
			const { challengerId, challengerName, reason } = data.data;
			console.log('[WSB] ❌ game:challenge_cancelled received:', {
				from: challengerId,
				name: challengerName,
				reason
			});
			
			this.closeInvitationOverlay();
			
			const message = reason === 'timeout' 
				? i18n.t('game.online.challengeExpired').replace('{challengerName}', challengerName || 'Player')
				: i18n.t('game.online.challengeCancelledBy').replace('{challengerName}', challengerName || 'Player');
			
			this.ui.showErrorPopup(message);
		});

		on('game:challenge_received', (data) => {
			const { challengerId, challengerName, tournamentId, matchId, isTournamentMatch } = data.data;
			console.log('[WSB] ✅ game:challenge_received:', {
				from: challengerId,
				name: challengerName,
				isTournamentMatch,
				tournamentId,
				matchId
			});

			const inviteOpen = document.body.getAttribute('data-invite-open') === '1';
			const outgoingChallenge = document.body.getAttribute('data-outgoing-challenge') === '1';
			const hasActiveGame = this.remote.hasActiveRemoteGame();

			if (inviteOpen || outgoingChallenge || hasActiveGame) {
				console.warn('[WSB] ⚠️ Ignoring challenge (already busy)', {
					inviteOpen,
					outgoingChallenge,
					hasActiveGame
				});
				try {
					this.ws.declineChallenge(challengerId);
				} catch (error) {
					console.warn('[WSB] Failed to auto-decline busy challenge:', error);
				}
				return;
			}
			
			if (isTournamentMatch && tournamentId !== undefined && matchId !== undefined) {
				console.log('[WSB] 🏆 Tournament match detected - creating game automatically (no overlay)');
				
				this.ws.sendMessage({
					type: 'game:create',
					data: {
						opponentId: challengerId,
						gameMode: 'tournament',
						tournamentId,
						matchId
					}
				});
				
				return;
			}
			
			console.log('[WSB] ⚔️ Standard 1v1 challenge - showing overlay');
			this.showInviteOverlay(
				i18n.t('game.online.gameInvitation'),
				`<strong>${challengerName}</strong>${i18n.t('game.online.invitationMessage')}`,
				'inv-accept', 'inv-decline',
				() => {
					console.log('[WSB] ✅ Challenge ACCEPTED - creating remote game');
					this.ws.createRemoteGame(challengerId);
				},
				() => {
					console.log('[WSB] ❌ Challenge DECLINED');
					try {
						this.ws.declineChallenge(challengerId);
					} finally {
						this.remote.handleGameCancelled(i18n.t('game.online.invitationDeclined'));
					}
				}
			);
		});

		on('game:challenge_sent', (d) => {
			console.log('[WSB] ✅ game:challenge_sent to', d?.data?.challengedName);
			const data = d?.data || {};
			this.ui.showSuccessPopup( i18n.t('game.online.challengeSent').replace('{challengedName}', data.challengedName || 'player'));
			if (!data.isTournamentMatch && typeof data.challengedId === 'number') {
				this.showOutgoingChallengeOverlay(data.challengedId, data.challengedName || 'Player');
			}
		});

		on('game:started', (d) => {
			console.log('[WSB] ✅ game:started');
			this.closeOutgoingChallengeOverlay();
			const data = d?.data;
			const gameId = data?.gameId;
			const tournamentId = data?.tournamentId;
			const matchId = data?.matchId;
			const isTournamentMatch = data?.isTournamentMatch;

			console.log('[WSB] ✅ game:started parsed:', {
				gameId,
				tournamentId,
				matchId,
				isTournamentMatch,
				hasGameId: !!gameId,
				gameIdType: typeof gameId
			});

			if (!gameId) {
				console.error('[WSB] ❌ No gameId in game:started event!');
				return;
			}

			if (isTournamentMatch && tournamentId !== undefined && matchId !== undefined) {
				console.log('[WSB] 🏆 Tournament match detected, setting info:', { tournamentId, matchId });
				
				try {
					this.remote.setTournamentMatchInfo(tournamentId, matchId);
					this.renderer.setTournamentMatchInfo?.(tournamentId, matchId);
					console.log('[WSB] ✅ Tournament info set successfully in both RemoteGameController and GameRenderer');
				} catch (error) {
					console.error('[WSB] ❌ Error setting tournament match info:', error);
				}
			} else {
				console.log('[WSB] ⚔️ Standard 1v1 match detected');
			}

			try {
				sessionStorage.setItem('pendingRemoteGameId', String(gameId));
				console.log('[WSB] ✅ Stored pendingRemoteGameId:', gameId);
			} catch (e) {
				console.error('[WSB] ❌ sessionStorage failed:', e);
			}

			console.log('[WSB] ✅ Navigating to /game...');
			navigate('/game');
			
			const timer = setTimeout(() => {
				console.log('[WSB] ✅ Initializing remote game with gameId:', gameId);
				this.initRemote(gameId);
			}, 100);
			this.activeTimers.add(timer);
		});

		on('game:joined', (d) => {
			console.log('[WSB] ✅ game:joined');
			this.remote.handleGameSync(d, () => view());
		});

		on('game:finished', (d) => {
			const gs = d?.data?.gameState || null;
			const currentView = view();
			console.log('[WSB] ✅ game:finished', {
				isTournamentMatch: this.remote.isTournamentMatch()
			});
			
			if (gs && currentView === 'game') {
				this.renderer.renderFromServerState(gs);
			}
			
			const me = (window as any)?.pongApp?.authService?.getCurrentUser?.();
			if (me) {
				this.ws.getUserStats(me.id);
				this.ws.getMatchHistory(me.id, 10);
			}
			
			this.remote.showEscHintAndBind();
			this.remote.handleGameFinished(currentView === 'game', d?.data?.summary);
		});

		on('game:player_disconnected', () => {
			console.warn('[WSB] game:player_disconnected');
			
			if (document.querySelector('.overlay-game-invite')) {
				console.warn('[WSB] game:player_disconnected ignored (invitation overlay active)');
				return;
			}
			
			const currentView = view();
			if (currentView !== 'game') {
				console.log('[WSB] Not in game view (current:', currentView, '), ignoring player_disconnected');
				return;
			}
			
			this.remote.handleOpponentLeft();
		});

		on('game:left', () => {
			console.warn('[WSB] game:left (you left)');
			
			const currentView = view();
			if (currentView !== 'game') {
				console.log('[WSB] Not in game view (current:', currentView, '), ignoring game:left');
				return;
			}
			
			this.remote.handleYouLeft();
		});

		on('game:cancelled', () => {
			console.warn('[WSB] game:cancelled');
			this.remote.handleGameCancelled(i18n.t('game.online.gameCancelled'));
		});

		on('game:declined', () => {
			console.warn('[WSB] game:declined');
			this.remote.handleGameCancelled(i18n.t('game.online.invitationDeclined'));
		});

		on('presence:list', (msg) => {
			this.handlePresenceList(msg, rerender);
		});

		on('users:online_list', (msg) => {
			this.handlePresenceList(msg, rerender);
		});

		on('presence:update', (msg) => {
			this.handlePresenceUpdate(msg, rerender);
		});

		on('tournament:cancelled', (msg) => {
			console.warn('[WSB] tournament:cancelled received', msg?.data);
			try {
				const reason = msg?.data?.reason;
				const backendMessage = msg?.data?.message;
				let text = i18n.t('tournament.activity.cancelled');
				if (reason === 'invalid_winner_count') {
					text = i18n.t('tournament.activity.cancelled.notEnoughReady');
				} else if (typeof backendMessage === 'string' && backendMessage.trim().length > 0) {
					text = backendMessage;
				}
				this.ui.showErrorPopup(text);
			} catch {
				this.ui.showErrorPopup(i18n.t('tournament.activity.cancelled'));
			}
			
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (tournamentService) {
				console.log('[WSB] Resetting tournament state');
				tournamentService.resetTournament(false);
			}
			try {
				rerender();
			} catch (e) {
				console.warn('[WSB] rerender failed after tournament:cancelled', e);
			}
			});

		on('tournament:finished', (msg) => {
			try {
				const data = msg?.data || {};
				const eventTid = Number(data?.tournamentId) || Number(data?.tournament_id) || undefined;
				const champion = data?.champion || null;
				const tournamentService = (window as any)?.pongApp?.tournamentService;
				const currentTid = tournamentService?.getCurrentTournamentId?.();

				if (!currentTid || !eventTid || Number(currentTid) !== Number(eventTid)) {
					console.log('[WSB] Ignoring tournament:finished for another tournament', { currentTid, eventTid });
					return;
				}

				try { delete (window as any).__showTournamentWaitingAnimation; } catch {}

				if (champion) {
					this.ui.showSuccessPopup(i18n.t('tournament.activity.finishedChampion').replace('{champion}', String(champion)));
				}

				if (view() === 'tournament') {
					this.refreshTournamentSoon(rerender, 150);
				}
			} catch (e) {
				console.error('[WSB] Error handling tournament:finished:', e);
			}
		});

		on('tournament:match_finished', (msg) => {
			const now = Date.now();
			if (now < this.matchFinishedCooldownUntil) {
				console.warn('[WSB] ⏳ Ignoring duplicate tournament:match_finished (cooldown)');
				return;
			}
			this.matchFinishedCooldownUntil = now + 1000;

			const data = msg?.data;
			console.log('[WSB] 🏆 tournament:match_finished received:', data);

			try {
				const info = this.remote.getTournamentMatchInfo?.();
				const eventTid = Number(data?.tournamentId);
				const eventMid = Number(data?.matchId);
				const inGame = view() === 'game';
				const isSameMatch = !!info && Number(info.tournamentId) === eventTid && Number(info.matchId) === eventMid;
				if (inGame && !isSameMatch) {
					console.log('[WSB] 🔇 Ignoring match_finished for another match while I am playing', {
						current: info, event: { eventTid, eventMid }
					});
					return;
				}
			} catch (e) {
				console.warn('[WSB] Guard check failed in tournament:match_finished:', e);
			}

			// Detect forfeit-by-disconnect and if the current user is the winner
			let iAmWinnerByForfeit = false;
			try {
				const isForfeit = !!data?.forfeit && data?.reason === 'disconnected';
				const winnerAlias = data?.winnerAlias;
				const myAlias = (window as any)?.pongApp?.tournamentService?.getCurrentUserAlias?.();
				iAmWinnerByForfeit = isForfeit && !!winnerAlias && !!myAlias && winnerAlias === myAlias;
				if (iAmWinnerByForfeit) {
					this.ui.showSuccessPopup(i18n.t('tournament.activity.opponentDisconnectedAdvance'));
				}
			} catch {}
			
			if (view() === 'game') {
				this.remote.markTournamentRedirectPending();
				
				const displayMessage = iAmWinnerByForfeit
					? i18n.t('tournament.activity.matchFinished.opponentForfeited')
					: (data.winner 
						? i18n.t('tournament.activity.matchFinished.youWon') 
						: i18n.t('tournament.activity.matchFinished.returning'));
				
				this.ui.showSuccessPopup(displayMessage);
				
				const timer = setTimeout(() => {
					// Nettoyer pendingRemoteGameId du sessionStorage
					// Car le match de tournoi est terminé et on retourne à l'écran tournoi
					try {
						const oldGameId = sessionStorage.getItem('pendingRemoteGameId');
						if (oldGameId) {
							sessionStorage.removeItem('pendingRemoteGameId');
							console.log('[WSB] ✅ Cleaned pendingRemoteGameId after tournament match:', oldGameId);
						}
					} catch (e) {
						console.warn('[WSB] Failed to clean pendingRemoteGameId:', e);
					}
					
					console.log('[WSB] ✅ Setting global flag for waiting animation');
					(window as any).__showTournamentWaitingAnimation = true;
					
					console.log('[WSB] ✅ Navigating back to /tournament');
					navigate('/tournament');
					
					setTimeout(() => {
						this.remote.clearTournamentMatchInfo();
						this.renderer.clearTournamentMatchInfo?.();
						
						const checkBackend = async (attempt = 0) => {
							const tournamentService = (window as any)?.pongApp?.tournamentService;
							if (!tournamentService) return;
							
							try {
								await tournamentService.refreshCurrentTournament();
								const state = tournamentService.getTournamentState();
								
								const isReady = 
									(state.pairings && state.pairings.length > 0) || 
									(state.champion);
								
								if (isReady || attempt >= 10) {
									console.log('[WSB] ✅ Backend ready, clearing global flag');
									delete (window as any).__showTournamentWaitingAnimation;
									rerender();
								} else {
									console.log(`[WSB] ⏳ Backend not ready, retry ${attempt + 1}/10`);
									setTimeout(() => checkBackend(attempt + 1), 300);
								}
							} catch (error) {
								console.error('[WSB] ❌ Error:', error);
								if (attempt < 10) {
									setTimeout(() => checkBackend(attempt + 1), 300);
								} else {
									delete (window as any).__showTournamentWaitingAnimation;
									rerender();
								}
							}
						};
						
						checkBackend();
						
					}, 200);
					
				}, 2000);
				
				this.activeTimers.add(timer);
			}
			
			if (view() === 'tournament') {
				const isForfeitDisconnect = !!data?.forfeit && data?.reason === 'disconnected';
				if (isForfeitDisconnect && !iAmWinnerByForfeit) {
					console.log('[WSB] 🔇 Forfeit disconnect for another match - no UI refresh for non-involved players');
					return;
				}
				if (iAmWinnerByForfeit) {
					this.ui.showSuccessPopup(i18n.t('tournament.activity.opponentDisconnectedAdvance'));
				}
				(window as any).__showTournamentWaitingAnimation = true;
				rerender();
				
				setTimeout(() => {
					const checkBackend = async (attempt = 0) => {
						const tournamentService = (window as any)?.pongApp?.tournamentService;
						if (!tournamentService) return;
						
						try {
							await tournamentService.refreshCurrentTournament();
							const state = tournamentService.getTournamentState();
							
							const isReady = 
								(state.pairings && state.pairings.length > 0) || 
								(state.champion);
							
							if (isReady || attempt >= 5) {
								delete (window as any).__showTournamentWaitingAnimation;
								rerender();
							} else {
								setTimeout(() => checkBackend(attempt + 1), 300);
							}
						} catch (error) {
							if (attempt < 5) {
								setTimeout(() => checkBackend(attempt + 1), 300);
							} else {
								delete (window as any).__showTournamentWaitingAnimation;
								rerender();
							}
						}
					};
					
					checkBackend();
				}, 200);
			}
		});

		on('tournament:round_complete', (msg) => {
			const data = msg?.data;
			console.log('[WSB] 🏆 tournament:round_complete received:', data);
			
			const { tournamentId, completedRound, nextRound } = data;
			
			if (view() === 'tournament') {
				this.ui.showSuccessPopup(
					i18n.t('tournament.activity.roundComplete')
						.replace('{completedRound}', String(completedRound))
						.replace('{nextRound}', String(nextRound))
				);
				
				const tournamentService = (window as any)?.pongApp?.tournamentService;
				if (tournamentService) {
					console.log('[WSB] 🏆 Refreshing tournament for new round');
					tournamentService.refreshCurrentTournament()
						.then(() => {
							console.log('[WSB] ✅ Tournament refreshed for new round');
							rerender();
						})
						.catch((error: any) => {
							console.error('[WSB] ❌ Error refreshing tournament:', error);
						});
				}
			}
		});

		on('tournament:player_joined', (msg) => {
			const data = msg?.data;
			console.log('[WSB] 🏆 tournament:player_joined received:', data);
			
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (tournamentService && view() === 'tournament') {
				console.log('[WSB] 🏆 Queuing debounced refresh after player joined');
				this.refreshTournamentSoon(rerender);
			}
		});

		// Handle player leaving during matchmaking -> refresh bracket/UI
		on('tournament:player_left', (msg) => {
			console.info('[WSB] tournament:player_left received:', msg?.data);
			try {
				const tournamentService = (window as any)?.pongApp?.tournamentService;
				if (tournamentService) {
					// Debounced refresh to avoid multiple quick calls
					this.refreshTournamentSoon(rerender);
				} else {
					rerender();
				}
			} catch (e) {
				console.error('[WSB] Error handling tournament:player_left:', e);
			}
		});

		on('tournament:started', (msg) => {
			const data = msg?.data;
			console.log('[WSB] 🏆 tournament:started received:', data);
			
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (tournamentService && view() === 'tournament') {
				console.log('[WSB] 🏆 Refreshing tournament after start');
				
				// Attendre 200ms pour que le backend finisse de générer les pairings
				setTimeout(() => {
					tournamentService.refreshCurrentTournament()
						.then(() => {
							console.log('[WSB] ✅ Tournament refreshed after start');
							
							const state = tournamentService.getTournamentState();
							if (state.pairings && state.pairings.length > 0) {
								console.log('[WSB] ✅ Pairings loaded successfully');
							} else {
								console.warn('[WSB] ⚠️ No pairings loaded after tournament start');
							}
							
							rerender();
						})
						.catch((error: any) => {
							console.error('[WSB] ❌ Error refreshing tournament:', error);
							rerender();
						});
				}, 200);
			}
		});

		on('tournament:match_ready', (msg) => {
			const data = msg?.data;
			console.log('[WSB] 🏆 tournament:match_ready received:', data);
			
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (tournamentService && view() === 'tournament') {
				console.log('[WSB] 🏆 Refreshing tournament after match ready');
				this.refreshTournamentSoon(rerender);
			}
		});

		on('tournament:match_started', (msg) => {
			const data = msg?.data;
			console.log('[WSB] 🏁 tournament:match_started received:', data);
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (!tournamentService) return;

			// Afficher/rafraîchir UNIQUEMENT si on est bien sur CE tournoi
			const currentTid = tournamentService.getCurrentTournamentId?.();
			const eventTid = data?.tournamentId;
			if (!currentTid || !eventTid || Number(currentTid) !== Number(eventTid)) {
				console.log('[WSB] Ignoring match_started for another tournament or no current context', { currentTid, eventTid });
				return;
			}

			// Rafraîchir le bracket pour ce tournoi
			const doRefresh = () => this.refreshTournamentSoon(rerender);

			if (view() === 'tournament') {
				// Ne montrer le toast que si le match concerne l'utilisateur courant
				try {
					const myAlias = tournamentService.getCurrentUserAlias?.();
					const involvesMe = !!myAlias && (myAlias === data?.player1Alias || myAlias === data?.player2Alias);
					if (involvesMe) {
						this.ui.showSuccessPopup(i18n.t('tournament.activity.matchStarting'));
					}
				} catch {}
				doRefresh();
			} else {
				// Pas dans la vue tournoi: ignorer le toast, juste garder l'état cohérent si demandé plus tard
				doRefresh();
			}
		});

		on('tournament:player_eliminated', (msg: any) => {
			try {
				const reason = msg?.data?.reason || 'eliminated';
				console.warn('[WSB] 🏆 tournament:player_eliminated received:', { reason, raw: msg?.data });

				const pongApp = (window as any)?.pongApp;
				const tournamentService = pongApp?.tournamentService;

				try { this.remote.clearTournamentMatchInfo?.(); } catch {}
				try { this.renderer.clearTournamentMatchInfo?.(); } catch {}

				if (tournamentService) {
					tournamentService.resetTournament(false);
				}

				const messageMap: Record<string, string> = {
					'disconnected': i18n.t('tournament.activity.playerEliminated.disconnected'),
					'declined_invitation': i18n.t('tournament.activity.playerEliminated.declined'),
					'abandoned_game': i18n.t('tournament.activity.playerEliminated.abandoned'),
					'left_tournament': i18n.t('tournament.activity.playerEliminated.left'),
				};
				this.ui.showErrorPopup(messageMap[reason] || i18n.t('tournament.activity.playerEliminated.generic'));

				if (pongApp?.navigate) {
					setTimeout(() => pongApp.navigate('/welcome'), 300);
				}

				rerender();
			} catch (e) {
				console.error('[WSB] Error handling tournament:player_eliminated:', e);
			}
		});

		on('tournament:match_forfeited', (msg: any) => {
			console.log('[WSB] Match forfeited by deadline:', msg.data);
			
			try {
				const tournamentService = (window as any).pongApp?.tournamentService;
				const currentTid = tournamentService?.getCurrentTournamentId?.();
				const eventTid = msg?.data?.tournamentId;
				
				// Ignorer si pas sur le même tournoi
				if (!currentTid || !eventTid || Number(currentTid) !== Number(eventTid)) {
					console.log('[WSB] Ignoring match_forfeited for another tournament', { currentTid, eventTid });
					return;
				}

				// Rafraîchir seulement si on est sur la vue tournoi
				if ((window as any)?.pongApp?.currentView !== 'tournament') {
					console.log('[WSB] Not in tournament view, skipping immediate refresh for match_forfeited');
					return;
				}

				if (tournamentService) {
					this.refreshTournamentSoon(rerender);
				}
			} catch (e) {
				console.error('[WSB] Error handling tournament:match_forfeited:', e);
			}
		});

		on('tournament:match_cancelled', (msg: any) => {
			console.log('[WSB] Match cancelled (both players not ready):', msg.data);
			
			try {
				const tournamentService = (window as any).pongApp?.tournamentService;
				const currentTid = tournamentService?.getCurrentTournamentId?.();
				const eventTid = msg?.data?.tournamentId;

				// Ignorer si pas sur le même tournoi
				if (!currentTid || !eventTid || Number(currentTid) !== Number(eventTid)) {
					console.log('[WSB] Ignoring match_cancelled for another tournament', { currentTid, eventTid });
					return;
				}

				// Rafraîchir seulement si on est sur la vue tournoi
				if ((window as any)?.pongApp?.currentView !== 'tournament') {
					console.log('[WSB] Not in tournament view, skipping immediate refresh for match_cancelled');
					return;
				}

				if (tournamentService) {
					this.refreshTournamentSoon(rerender);
				}
			} catch (e) {
				console.error('[WSB] Error handling tournament:match_cancelled:', e);
			}
		});

		const ignoredTournamentEvents = [
			'tournament:created',
			'tournament:state',
			'tournament:match_result',
			'tournament:error',
			'tournament:invite',
			'tournament:start',
			'tournament:join',
			'tournament:leave',
			'tournament:bracket_updated',
			'tournament:round_started',
			'tournament:round_finished'
		];

		ignoredTournamentEvents.forEach(eventName => {
			on(eventName, () => {
				console.warn(`[WSB] IGNORED: ${eventName} event - tournaments use REST API only`);
			});
		});

		on('ranking_loaded', () => { });
		on('user_rank_loaded', () => { });
		on('pong', () => { });


		// Reconnexion FORCÉE pour guests
		window.addEventListener('guest-token-ready', async () => {
			console.log('[WSB] 🔔 Guest token ready event received');
			console.log('[WSB] 🔄 Force reconnecting WebSocket with guest token...');
			try {
				await this.ws.connect(true);
				console.log('[WSB] ✅ WebSocket force reconnected successfully for guest');
			} catch (error) {
				console.error('[WSB] ❌ Failed to reconnect WebSocket for guest:', error);
			}
		});

	}

	/* Traite la liste complète des utilisateurs en ligne */
	private handlePresenceList(msg: any, rerender: () => void): void {
		try {
			const arr = Array.isArray(msg?.data?.users) ? msg.data.users : [];
			this.onlineUsers = arr.map((u: any) => ({
				id: Number(u.id),
				username: String(u.username),
				is_online: !!u.is_online
			}));

			console.debug('[WSB] event: presence:list (size=', this.onlineUsers.length, ')');
			rerender();
		} catch (e) {
			console.error('[WSB] Error handling presence list:', e);
		}
	}

	/* Traite la mise à jour de présence d'un utilisateur individuel */
	private handlePresenceUpdate(msg: any, rerender: () => void): void {
		try {
			const u = msg?.data?.user;
			if (!u) return;

			const idx = this.onlineUsers.findIndex(x => x.id === Number(u.id));
			const next = {
				id: Number(u.id),
				username: String(u.username),
				is_online: !!u.is_online
			};

			if (idx >= 0) {
				this.onlineUsers[idx] = next;
			} else {
				this.onlineUsers.push(next);
			}

			console.debug('[WSB] event: presence:update', next);
			rerender();
		} catch (e) {
			console.error('[WSB] Error handling presence update:', e);
		}
	}

	/* Demande la liste de présence avec protection contre les appels trop fréquents */
	private requestPresenceListSafe(): void {
		const now = Date.now();
		if (now - this.lastPresenceRequest < this.PRESENCE_COOLDOWN) {
			console.debug('[WSB] Presence request skipped (cooldown)');
			return;
		}

		this.lastPresenceRequest = now;
		try {
			this.ws.sendMessage({ type: 'presence:list', data: {} });
			console.debug('[WSB] Presence list requested');
		} catch (e) {
			console.error('[WSB] Error requesting presence list:', e);
		}
	}

	/* Affiche une popup modale d'invitation de jeu avec options d'acceptation et de refus */
	private showInviteOverlay(
		title: string, msgHtml: string,
		acceptId: string, declineId: string,
		onAccept: () => void, onDecline: () => void
	): void {
		console.log('[WSB] ✅ showInviteOverlay:', { title, acceptId, declineId });

		const overlay = document.createElement('div');
		overlay.className = 'overlay-game-invite';
		overlay.style.cssText = [
			'position:fixed', 'inset:0',
			'background:rgba(0,0,0,.35)',
			'backdrop-filter:blur(2px)', '-webkit-backdrop-filter:blur(2px)',
			'display:flex', 'align-items:center', 'justify-content:center',
			'z-index:10000',
			'pointer-events:auto'
		].join(';');

		const box = document.createElement('div');
		box.style.cssText = [
			'background:rgba(10,10,20,.25)',
			'color:#fff',
			'border-radius:14px',
			'padding:1.25rem 1.5rem',
			'width:min(92vw,420px)',
			'box-shadow:0 12px 40px rgba(0,0,0,.45)',
			'border:1px solid rgba(255,255,255,.18)',
			'backdrop-filter:blur(10px) saturate(120%)',
			'-webkit-backdrop-filter:blur(10px) saturate(120%)',
			'pointer-events:auto'
		].join(';');

		box.innerHTML = `
      <h3 style="margin:0 0 .75rem 0;font-size:1rem;">${title}</h3>
      <p style="margin:0 0 1rem 0;color:#eaeaea;font-size:.9rem;">${msgHtml}</p>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;">
        <button id="${declineId}" style="
          background:rgba(255,255,255,.10);
          color:#fff;
          border:1px solid rgba(255,255,255,.25);
          padding:.5rem .9rem;border-radius:8px;cursor:pointer;font-size:.9rem;">Decline</button>
        <button id="${acceptId}"  style="
          background:#ffffff;
          color:#000;
          border:1px solid rgba(255,255,255,.35);
          padding:.5rem .9rem;border-radius:8px;cursor:pointer;font-size:.9rem;font-weight:600;">Accept</button>
      </div>`;

		overlay.appendChild(box);
		document.body.appendChild(overlay);

		try {
			(window as any).__lastInviteOverlay = overlay;
		} catch { }

		const nav = document.querySelector('nav') as HTMLElement | null;
		const prevNavPE = nav?.style.pointerEvents;
		if (nav) nav.style.pointerEvents = 'none';
		document.body.setAttribute('data-invite-open', '1');
		overlay.addEventListener('click', (e) => e.stopPropagation());

		const close = () => {
			console.log('[WSB] ✅ Closing invite overlay');
			if (nav) nav.style.pointerEvents = prevNavPE || 'auto';
			document.body.removeAttribute('data-invite-open');
			overlay.remove();
		};

		const btnDecl = box.querySelector('#' + declineId) as HTMLButtonElement;
		const btnAccept = box.querySelector('#' + acceptId) as HTMLButtonElement;

		const guardOnce = (fn: () => void) => () => {
			try {
				btnAccept.disabled = true;
				btnDecl.disabled = true;
			} catch { }
			try {
				fn();
			} finally {
			}
		};

		btnDecl.addEventListener('click', guardOnce(() => {
			onDecline();
			close();
		}));
		
		btnAccept.addEventListener('click', guardOnce(() => {
			onAccept();
			close();
		}));
	}

	/* Ferme la popup d'invitation en cours et restaure la navigation */
	private closeInvitationOverlay(): void {
		console.log('[WSB] closeInvitationOverlay: scanning ...');
		
		// Fermer via la référence globale si elle existe
		try {
			const lastOverlay = (window as any).__lastInviteOverlay;
			if (lastOverlay && lastOverlay.parentElement) {
				console.log('[WSB] closeInvitationOverlay: removing via global reference');
				lastOverlay.remove();
				
				// Restaurer la navigation
				const nav = document.querySelector('nav') as HTMLElement | null;
				if (nav) nav.style.pointerEvents = 'auto';
				document.body.removeAttribute('data-invite-open');
				
				delete (window as any).__lastInviteOverlay;
				return;
			}
		} catch (e) {
			console.warn('[WSB] Error using global overlay reference:', e);
		}
		
		// Fallback: chercher l'overlay dans le DOM
		const overlay = document.querySelector('.overlay-game-invite');
		if (overlay && overlay.parentElement) {
			console.log('[WSB] closeInvitationOverlay: removing via DOM search');
			overlay.remove();
			
			// Restaurer la navigation
			const nav = document.querySelector('nav') as HTMLElement | null;
			if (nav) nav.style.pointerEvents = 'auto';
			document.body.removeAttribute('data-invite-open');
		}
	}

	/* Affiche une popup d'attente de réponse pour un défi sortant */
	private showOutgoingChallengeOverlay(challengedId: number, challengedName: string): void {
		this.closeOutgoingChallengeOverlay();

		const overlay = document.createElement('div');
		overlay.className = 'overlay-outgoing-challenge';
		overlay.style.cssText = [
			'position:fixed','inset:0',
			'background:rgba(0,0,0,0.35)',
			'backdrop-filter:blur(2px)','-webkit-backdrop-filter:blur(2px)',
			'display:flex','align-items:center','justify-content:center',
			'pointer-events:auto',
			'z-index:10000'
		].join(';');

		const box = document.createElement('div');
		box.style.cssText = [
			'background:rgba(10,10,20,0.25)',
			'color:#fff',
			'border-radius:14px',
			'padding:1.25rem 1.5rem',
			'width:min(92vw,420px)',
			'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
			'border:1px solid rgba(255,255,255,0.18)',
			'backdrop-filter:blur(10px) saturate(120%)',
			'-webkit-backdrop-filter:blur(10px) saturate(120%)',
			'pointer-events:auto',
			'font-family:inherit',
			'animation:scaleIn .18s ease'
		].join(';');

		const waitingText = (i18n.t('game.online.challengeWaiting') || 'Waiting for {name} to respond...')
			.replace('{name}', challengedName || 'Player');

		box.innerHTML = `
			<h3 style="margin:0 0 .75rem 0;font-size:1rem;">${i18n.t('profile.challengeSent')}</h3>
			<p style="margin:0 0 1.25rem 0;color:#eaeaea;font-size:.95rem;font-weight:600;">
				${waitingText}
			</p>
			<div style="display:flex;gap:.5rem;justify-content:flex-end;">
				<button id="cancel-outgoing-challenge"
					style="
						background:#ffffff;
						color:#000;
						border:1px solid rgba(255,255,255,0.35);
						padding:.5rem .9rem;
						border-radius:8px;
						cursor:pointer;
						font-size:.9rem;
						font-weight:600;
					">
					${i18n.t('game.online.cancelChallenge')}
				</button>
			</div>
		`;

		overlay.appendChild(box);
		document.body.appendChild(overlay);
		document.body.setAttribute('data-outgoing-challenge', '1');

		const cancelBtn = box.querySelector('#cancel-outgoing-challenge') as HTMLButtonElement | null;
		cancelBtn?.addEventListener('click', () => {
			this.ws.cancelChallenge(challengedId);
			this.ui.showSuccessPopup(i18n.t('game.online.challengeCancelled'));
			this.closeOutgoingChallengeOverlay();
		});

		this.outgoingChallengeOverlay = overlay;
	}

	/* Ferme la popup de défi sortant */
	private closeOutgoingChallengeOverlay(): void {
		if (this.outgoingChallengeOverlay) {
			try { this.outgoingChallengeOverlay.remove(); } catch {}
			this.outgoingChallengeOverlay = null;
			document.body.removeAttribute('data-outgoing-challenge');
		}
	}

	/* Initialise une partie distante en mode multijoueur avec ID de jeu */
	private initRemote(gameId: string): void {
		let me = (window as any)?.pongApp?.authService?.getCurrentUser?.();
		
		// Si pas de user via authService, vérifier si c'est un guest
		if (!me || !me.id) {
			const guestUserId = sessionStorage.getItem('guest_user_id');
			if (guestUserId) {
				me = { id: Number(guestUserId), username: 'Guest' };
				console.log('[WSB] ✅ Using guest userId from sessionStorage:', me.id);
			}
		}
		
		console.log('[WSB] ✅ initRemote START with gameId:', gameId, 'userId:', me?.id);

		if (me) {
			console.log('[WSB] ✅ Calling initializeRemoteMode');
			try {
				(window as any)?.pongApp?.gameEngine?.initializeRemoteMode?.(gameId, this.ws, me.id);
				console.log('[WSB] ✅ initializeRemoteMode SUCCESS');
			} catch (e) {
				console.error('[WSB] ❌ initializeRemoteMode FAILED:', e);
			}

			console.log('[WSB] ✅ Calling joinRemoteGame');
			try {
				this.ws.joinRemoteGame(gameId);
				console.log('[WSB] ✅ joinRemoteGame SUCCESS');
			} catch (e) {
				console.error('[WSB] ❌ joinRemoteGame FAILED:', e);
			}
			
			console.log('[WSB] ✅ initRemote DONE');
		} else {
			console.error('[WSB] ❌ initRemote FAILED - no user');
		}
	}

	/* Demande la liste des utilisateurs en ligne */
	public requestOnlineUsers(): void {
		this.requestPresenceListSafe();
	}

	/* Notifie une mise à jour de tournoi en mode REST */
	public notifyTournamentUpdate(tournamentId: number, updateType: string, data?: any): void {
		console.info('[WSB] Tournament update notification (REST mode):', {
			tournamentId,
			updateType,
			data
		});
	}

	/* Vérifie si l'utilisateur est actuellement dans un tournoi */
	public isUserInTournament(): boolean {
		try {
			const pongApp = (window as any)?.pongApp;
			const tournamentService = pongApp?.tournamentService;
			return !!(tournamentService?.getCurrentTournamentId?.());
		} catch {
			return false;
		}
	}

	/* Nettoie tous les timers actifs et réinitialise l'état */
	public cleanup(): void {
		for (const timer of this.activeTimers) {
			clearTimeout(timer);
		}
		this.activeTimers.clear();
		if (this.refreshDebounceTimer) {
			clearTimeout(this.refreshDebounceTimer);
			this.refreshDebounceTimer = null;
		}
		console.debug('[WSB] Cleanup completed');
	}

	/* Retourne le timestamp de la dernière requête de présence */
	public getLastPresenceRequest(): number {
		return this.lastPresenceRequest;
	}

	/* Retourne le nombre de timers actifs */
	public getActiveTimersCount(): number {
		return this.activeTimers.size;
	}

	/* Vérifie si les gestionnaires principaux ont été attachés */
	public isCorebound(): boolean {
		return this.coreBound;
	}

	/* Retourne une copie de la liste des utilisateurs en ligne */
	public getOnlineUsers(): OnlineUser[] {
		return [...this.onlineUsers];
	}

	/* Réinitialise les données lors de la déconnexion WebSocket */
	public resetOnDisconnect(): void {
		this.onlineUsers = [];
		this.lastPresenceRequest = 0;
		console.debug('[WSB] Data reset on disconnect');
	}

	/* Planifie un rafraîchissement du tournoi avec debounce pour éviter les appels multiples */
	private refreshTournamentSoon(rerender: () => void, delayMs: number = 150): void {
		try {
			const tournamentService = (window as any)?.pongApp?.tournamentService;
			if (!tournamentService) return;
			if (this.refreshDebounceTimer) {
				clearTimeout(this.refreshDebounceTimer);
			}
			this.refreshDebounceTimer = setTimeout(() => {
				this.refreshDebounceTimer = null;
				tournamentService.refreshCurrentTournament()
					.then(() => { rerender(); })
					.catch((e: any) => { console.error('[WSB] Debounced tournament refresh failed:', e); });
			}, Math.max(0, Number(delayMs) || 0));
		} catch (e) {
			console.warn('[WSB] Failed to schedule debounced tournament refresh:', e);
		}
	}
}
