import { UIUtils } from './UIUtils';
import { GuestAuthService } from '../services/GuestAuthService';
import { i18n } from './I18n';

interface BackendTournament {
	id: number;
	name: string;
	status: string;
	max_players: number;
	current_round: number;
	created_at: string;
	started_at?: string;
	ended_at?: string;
	updated_at: string;
	owner_id?: number;
	current_players?: number;
}

interface BackendParticipant {
	tournament_id: number;
	player_alias: string;
	is_owner: boolean;
	joined_at: string;
	user_id?: number | null;
}

interface MatchPairing {
	matchId: number;
	player1Alias: string;
	player2Alias: string;
	player1UserId: number | null;
	player2UserId: number | null;
  player1GuestToken: string | null;
  player2GuestToken: string | null;
	status: string;
	isCurrentUserMatch: boolean;
	p1Ready?: boolean;
	p2Ready?: boolean;
	readyDeadline?: string | null;
}

interface SimplifiedTournamentState {
	active: boolean;
	players: Array<{ alias: string; userId?: number | null }>;
	champion: string | null;
	tournamentId: number | null;
	tournamentName?: string;
	tournamentStatus?: string;
	currentRound?: number;
	pairings?: MatchPairing[];
	matches?: Array<{ player1: string; player2: string; winner: string }>;
	currentMatch?: { player1: string; player2: string } | null;
}

interface TournamentHistoryEntry {
	id: number;
	name: string;
	status: 'finished' | 'cancelled';
	createdAt: string;
	startedAt?: string;
	endedAt?: string;
	winner: {
		alias: string;
		userId?: number | null;
	} | null;
}

export class TournamentService {
	private state: SimplifiedTournamentState;
	private uiUtils: UIUtils;
	public currentTournamentId: number | null = null;
	private currentUserAlias: string | null = null;
	private isOwner: boolean = false;
	private failureCount: number = 0;
	private readonly MAX_FAILURES: number = 3;

	/* Initialise le service de tournoi avec les utilitaires d'interface */
	constructor(uiUtils: UIUtils) {
		this.uiUtils = uiUtils;
		this.state = this.getEmptyState();
	}

	/* Déclare le forfait du joueur avec la raison spécifiée */
	public async declareForfeit(reason: 'declined_invitation' | 'abandoned_game' | 'left_tournament' | 'disconnected'): Promise<void> {
		try {
			if (!this.currentTournamentId) {
				throw new Error('No active tournament');
			}

			if (!this.currentUserAlias) {
				throw new Error('No user alias found');
			}

			console.log('[TournamentService] [FORFAIT] Declaring forfeit:', {
				tournamentId: this.currentTournamentId,
				playerAlias: this.currentUserAlias,
				reason
			});

			const response = await fetch(`https://localhost:3443/api/tournaments/${this.currentTournamentId}/forfeit`, {
				method: 'POST',
				headers: this.getAuthHeaders(),
				keepalive: true,
				body: JSON.stringify({
					playerAlias: this.currentUserAlias,
					reason
				})
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to declare forfeit');
			}

			const data = await response.json();

			console.log('[TournamentService] [FORFAIT] Forfeit declared:', data);

			if (data.tournamentCancelled) {
				this.uiUtils.showErrorPopup(i18n.t('tournament.activity.cancelled'));
				this.resetTournament(false);
			} else {
				this.uiUtils.showErrorPopup(i18n.t('tournament.activity.playerEliminated.generic'));
				this.resetTournament(false);
			}

		} catch (error: any) {
			console.error('[TournamentService] [FORFAIT] Error declaring forfeit:', error);
			throw error;
		}
	}

	/* Quitte le tournoi actif en utilisant l'endpoint de forfait */
	public async leaveTournament(): Promise<void> {
		try {
			if (!this.currentTournamentId) {
				throw new Error('No active tournament to leave');
			}

      console.log('[TournamentService] [LEAVE] Using forfeit endpoint for any status');
      await this.declareForfeit('left_tournament');

		} catch (error: any) {
			console.error('[TournamentService] [LEAVE] Error leaving tournament:', error);
			this.uiUtils.showErrorPopup(error.message || 'Failed to leave tournament');
			throw error;
		}
	}

	/* Quitte un tournoi terminé pour libérer l'alias */
	public async quitTournament(): Promise<void> {
		try {
			if (!this.currentTournamentId) {
				throw new Error('No tournament to quit');
			}

			if (!this.currentUserAlias) {
				throw new Error('No user alias found');
			}

			const state = this.getTournamentState();

			if (state.active) {
				throw new Error('Cannot quit an active tournament. Use leave instead.');
			}

			console.log('[TournamentService] [QUIT] Quitting finished tournament:', {
				tournamentId: this.currentTournamentId,
				playerAlias: this.currentUserAlias,
				status: state.active ? 'active' : 'finished/cancelled'
			});

			const response = await fetch(`https://localhost:3443/api/tournaments/${this.currentTournamentId}/quit`, {
				method: 'POST',
				headers: this.getAuthHeaders(),
				body: JSON.stringify({
					playerAlias: this.currentUserAlias
				})
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to quit tournament');
			}

			const data = await response.json();

			console.log('[TournamentService] [QUIT] Tournament quit successful:', data);

      this.resetTournament(false);
      
      const isGuest = GuestAuthService.isGuest();
			if (isGuest) {
				this.uiUtils.showSuccessPopup(i18n.t('tournament.activity.completed.guest'));
			} else {
				this.uiUtils.showSuccessPopup(i18n.t('tournament.activity.completed.user'));
			}

		} catch (error: any) {
			console.error('[TournamentService] [QUIT] Error quitting tournament:', error);
			this.uiUtils.showErrorPopup(error.message || 'Failed to quit tournament');
			throw error;
		}
	}

	/* Marque le joueur comme prêt pour le match spécifié */
	public async markReady(matchId: number): Promise<void> {
		if (!Number.isInteger(matchId) || matchId <= 0) {
			throw new Error('Invalid match ID');
		}
		const tid = this.getCurrentTournamentId();
		const alias = this.getCurrentUserAlias();

		if (!tid) throw new Error('No active tournament');
		if (!alias) throw new Error('No player alias');

		const res = await fetch(`https://localhost:3443/api/tournaments/${tid}/match/${matchId}/ready`, {
			method: 'POST',
			headers: this.getAuthHeaders(),
			body: JSON.stringify({ playerAlias: alias })
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err?.error || 'Failed to mark ready');
		}

		try {
			await this.refreshCurrentTournament();
		} catch { }
	}

	/* Récupère l'historique des tournois pour un utilisateur ou alias donné */
	public async getTournamentHistory(userId?: number, alias?: string, limit: number = 10): Promise<TournamentHistoryEntry[]> {
		try {
			console.log('[TournamentService] [HISTORY] Fetching tournament history:', {
				userId: userId || 'none',
				alias: alias || 'none',
				limit
			});

			const params = new URLSearchParams();
			if (userId) params.append('userId', userId.toString());
			if (alias) params.append('alias', alias);
			params.append('limit', limit.toString());

			const response = await fetch(`https://localhost:3443/api/tournaments/history?${params.toString()}`, {
				method: 'GET',
				headers: this.getAuthHeaders()
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to fetch tournament history');
			}

			const data = await response.json();

			console.log('[TournamentService] [HISTORY] History fetched successfully:', {
				count: data.tournaments?.length || 0
			});

			return data.tournaments || [];

		} catch (error: any) {
			console.error('[TournamentService] [HISTORY] Error fetching history:', error);
			return [];
		}
	}

	/* Vérifie si un utilisateur peut rejoindre un tournoi */
	private async checkCanJoinTournament(tournamentId: number, userId?: number): Promise<boolean> {
		try {
			if (!userId) {
				return true;
			}

			const response = await fetch(
				`https://localhost:3443/api/tournaments/${tournamentId}/check-participation?userId=${userId}`,
				{
					method: 'GET',
					headers: this.getAuthHeaders()
				}
			);

			if (!response.ok) {
				console.warn('[TournamentService] Failed to check participation');
				return true;
			}

			const data = await response.json();

			if (!data.canJoin) {
				console.warn('[TournamentService] User already in another tournament:', data.currentTournament);
				this.uiUtils.showErrorPopup(
					i18n.t('tournament.activity.alreadyInAnother').replace('{name}', String(data.currentTournament?.name || ''))
				);
				return false;
			}

			return true;

		} catch (error) {
			console.error('[TournamentService] Error checking participation:', error);
			return true;
		}
	}

	/* Crée un nouveau tournoi avec le nom et l'alias du créateur */
	public async createTournament(name: string, creatorAlias: string, userId?: number): Promise<void> {
		try {
			if (!name.trim()) {
				throw new Error(i18n.t('tournament.validation.nameRequired'));
			}

			if (!creatorAlias.trim()) {
				throw new Error(i18n.t('tournament.validation.aliasRequired'));
			}

			if (name.trim().length > 20) {
				throw new Error(i18n.t('tournament.validation.nameTooLong'));
			}

			if (creatorAlias.trim().length > 10) {
				throw new Error(i18n.t('tournament.validation.aliasTooLong'));
			}

			const nameRegex = /^[a-zA-Z0-9\s\-_\.]+$/;
			const aliasRegex = /^[a-zA-Z0-9\-_\.]+$/;

			if (!nameRegex.test(name.trim())) {
				throw new Error(i18n.t('tournament.validation.nameInvalid'));
			}

			if (!aliasRegex.test(creatorAlias.trim())) {
				throw new Error(i18n.t('tournament.validation.aliasInvalid'));
			}

			let requestUserId = userId;
			let guestToken: string | undefined;

			if (!requestUserId) {
				console.log('[TournamentService] 🔄 Initializing guest before tournament creation...');
				const guestData = await GuestAuthService.initializeGuest();
				guestToken = guestData.token;
				requestUserId = guestData.userId;
				console.log('[TournamentService] ✅ Guest initialized:', guestData);
				GuestAuthService.setGuestAlias(creatorAlias.trim());
			}

			if (requestUserId && requestUserId !== 0) {
				const canCreate = await this.checkCanJoinTournament(0, requestUserId);
				if (!canCreate) {
				return;
				}
			}

			const payload: any = { 
				name: name.trim(), 
				creatorAlias: creatorAlias.trim()
			};
			
			if (requestUserId !== undefined) {
				payload.userId = requestUserId;
			}

			if (guestToken) {
				payload.guestToken = guestToken;
			}

			const response = await fetch('https://localhost:3443/api/tournaments', {
				method: 'POST',
				headers: GuestAuthService.getAuthHeaders(),
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to create tournament');
			}

			const data = await response.json();
			
			this.currentTournamentId = data.tournament.id;
			this.currentUserAlias = creatorAlias.trim();
			this.isOwner = true;

			if (guestToken) {
				GuestAuthService.setGuestAlias(creatorAlias.trim());
			}

			console.log('[TournamentService] Tournament created:', {
				tournamentId: this.currentTournamentId,
				userAlias: this.currentUserAlias,
				isOwner: this.isOwner,
				userId: requestUserId || 'guest'
			});

			this.state = {
				active: false,
				players: [{ alias: creatorAlias.trim(), userId: requestUserId || null }],
				champion: null,
				tournamentId: this.currentTournamentId,
				tournamentName: name.trim(),
				tournamentStatus: 'waiting',
				currentRound: 1,
				pairings: [],
				matches: [],
				currentMatch: null
			};

			await this.loadTournamentState(data.tournament.id);

						this.uiUtils.showSuccessPopup(
							i18n.t('tournament.activity.createdAwaiting')
								.replace('{name}', name.trim())
								.replace('{count}', '3')
						);

		} catch (error: any) {
			console.error('[TournamentService] Error creating tournament:', error);
			this.uiUtils.showErrorPopup(error.message || i18n.t('tournament.error.failedCreate'));
			throw error;
		}
	}

	/* Rejoint un tournoi existant avec l'alias du joueur */
	public async joinTournament(tournamentId: number, playerAlias: string, userId?: number): Promise<void> {
		try {
			if (!playerAlias.trim()) {
				throw new Error(i18n.t('tournament.validation.aliasRequired'));
			}

				if (playerAlias.trim().length > 10) {
					throw new Error(i18n.t('tournament.validation.aliasTooLong'));
				}

			const aliasRegex = /^[a-zA-Z0-9\-_\.]+$/;
			if (!aliasRegex.test(playerAlias.trim())) {
				throw new Error(i18n.t('tournament.validation.aliasInvalid'));
			}

			let requestUserId = userId;
			let guestToken: string | undefined;

			if (!requestUserId) {
				console.log('[TournamentService] 🔄 Initializing guest before joining tournament...');
				const guestData = await GuestAuthService.initializeGuest();
				guestToken = guestData.token;
				requestUserId = guestData.userId;
				console.log('[TournamentService] ✅ Guest initialized:', guestData);
				GuestAuthService.setGuestAlias(playerAlias.trim());
			}
			
			if (guestToken) {
				console.log('[TournamentService] 🔄 Forcing WebSocket reconnection for guest...');
				await new Promise(resolve => setTimeout(resolve, 100));
				window.dispatchEvent(new CustomEvent('guest-token-ready'));
				console.log('[TournamentService] 🔔 guest-token-ready event dispatched');
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			if (requestUserId && requestUserId !== 0) {
				const canJoin = await this.checkCanJoinTournament(tournamentId, requestUserId);
				if (!canJoin) {
				return;
				}
			}

					if (this.currentTournamentId && this.currentTournamentId !== tournamentId) {
						throw new Error('You are already in another tournament. Please leave it first.');
					}

			const payload: any = { 
				playerAlias: playerAlias.trim()
			};
			
			if (requestUserId !== undefined) {
				payload.userId = requestUserId;
			}

			if (guestToken) {
				payload.guestToken = guestToken;
			}

			const response = await fetch(`https://localhost:3443/api/tournaments/${tournamentId}/join`, {
				method: 'POST',
				headers: GuestAuthService.getAuthHeaders(),
				body: JSON.stringify(payload)
			});

					if (!response.ok) {
						const error = await response.json();
						throw new Error(error.error || 'Failed to join tournament');
					}

			const data = await response.json();
			
			this.currentTournamentId = tournamentId;
			this.currentUserAlias = playerAlias.trim();
			this.isOwner = false;

			if (guestToken) {
				GuestAuthService.setGuestAlias(playerAlias.trim());
			}

			console.log('[TournamentService] Tournament joined:', {
				tournamentId: this.currentTournamentId,
				userAlias: this.currentUserAlias,
				isOwner: this.isOwner,
				userId: requestUserId || 'guest'
			});

			await this.loadTournamentState(tournamentId);

						this.uiUtils.showSuccessPopup(
							i18n.t('tournament.activity.joinedPlayers')
								.replace('{count}', String(data.playerCount ?? '0'))
						);

		} catch (error: any) {
			console.error('[TournamentService] Error joining tournament:', error);
			this.uiUtils.showErrorPopup(error.message || i18n.t('tournament.error.failedJoin'));
			throw error;
		}
	}

	/* Démarre le tournoi en tant que propriétaire */
	public async startTournamentAsOwner(): Promise<void> {
		try {
			if (!this.currentTournamentId) {
				throw new Error(i18n.t('tournament.error.noActiveTournament'));
			}

			if (!this.isOwner) {
				throw new Error(i18n.t('tournament.error.onlyOwnerCanStart'));
			}

			if (!this.currentUserAlias) {
				throw new Error(i18n.t('tournament.error.noPlayerAlias'));
			}

			const state = this.getTournamentState();
			if (state.active) {
				throw new Error(i18n.t('tournament.error.tournamentAlreadyStarted'));
			}

			if (state.players.length !== 4) {
				throw new Error(i18n.t('tournament.error.needsExactlyFour').replace('{count}', String(state.players.length)));
			}

			console.log('[TournamentService] Starting tournament:', {
				tournamentId: this.currentTournamentId,
				creatorAlias: this.currentUserAlias,
				playersCount: state.players.length,
				isOwner: this.isOwner
			});

			const response = await fetch(`https://localhost:3443/api/tournaments/${this.currentTournamentId}/start`, {
				method: 'POST',
				headers: this.getAuthHeaders(),
				body: JSON.stringify({ creatorAlias: this.currentUserAlias })
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to start tournament');
			}

			const data = await response.json();
			this.uiUtils.showSuccessPopup(data.message || i18n.t('tournament.activity.started'));

			await this.loadTournamentState(this.currentTournamentId);
			
		} catch (error: any) {
			console.error('[TournamentService] Error starting tournament:', error);
			this.uiUtils.showErrorPopup(error.message || 'Failed to start tournament');
			throw error;
		}
	}

	/* Charge l'état complet du bracket d'un tournoi avec circuit breaker */
	public async loadTournamentState(tournamentId: number): Promise<void> {
		try {
			if (this.failureCount >= this.MAX_FAILURES) {
				const error = new Error(`Circuit breaker open: too many failures (${this.failureCount}/${this.MAX_FAILURES})`);
				console.error('[TournamentService] ❌ Circuit breaker preventing request:', error);
				throw error;
			}

			console.log('[TournamentService] Loading tournament state (attempt', this.failureCount + 1, ')');

			const response = await fetch(`https://localhost:3443/api/tournaments/${tournamentId}/bracket`, {
				method: 'GET',
				headers: this.getAuthHeaders()
			});

			if (!response.ok) {
				this.failureCount++;

				if (response.status === 404) {
					throw new Error(i18n.t('tournament.error.tournamentNotFound'));
				}

				if (response.status === 503) {
					console.error('[TournamentService] ❌ 503 Service Unavailable detected');
					throw new Error(i18n.t('tournament.error.serviceUnavailable'));
				}

				const error = await response.json();
				throw new Error(error.error || 'Failed to load tournament');
			}

			const data = await response.json();

			this.failureCount = 0;
			console.log('[TournamentService] ✅ Load successful, failure count reset');

			console.log('[TournamentService] Raw data from server:', {
				tournament: data.tournament,
				participants: data.participants,
				champion: data.champion
			});

			let calculatedIsOwner = false;
			if (this.currentUserAlias && data.participants) {
				const ownerParticipant = data.participants.find((p: BackendParticipant) => p.is_owner);
				calculatedIsOwner = ownerParticipant?.player_alias === this.currentUserAlias;

				console.log('[TournamentService] Owner calculation:', {
					currentUserAlias: this.currentUserAlias,
					ownerParticipantAlias: ownerParticipant?.player_alias,
					calculatedIsOwner,
					previousIsOwner: this.isOwner
				});

				if (this.isOwner !== calculatedIsOwner) {
					console.log(`[TournamentService] Updating owner status: ${this.isOwner} -> ${calculatedIsOwner}`);
					this.isOwner = calculatedIsOwner;
				}
			}

			const state = this.convertToSimplifiedState(data.tournament, data.participants, data.champion);

			if (state.active && tournamentId) {
				const pairings = await this.loadCurrentRoundPairings(tournamentId);
				state.pairings = pairings;
				console.log('[TournamentService] Pairings loaded:', {
					tournamentId,
					pairingsCount: pairings.length,
					currentRound: state.currentRound
				});
			}

			if (!state.active && state.tournamentStatus === 'cancelled' && !state.champion) {
				console.log('[TournamentService] Tournament cancelled before start, resetting local state');
				this.resetTournament(false);
				return;
			}

			this.state = state;
			this.currentTournamentId = tournamentId;

			console.log('[TournamentService] State loaded successfully:', {
				tournamentId: this.currentTournamentId,
				userAlias: this.currentUserAlias,
				isOwner: this.isOwner,
				tournamentActive: state.active,
				tournamentStatus: state.tournamentStatus,
				playersCount: state.players.length,
				pairingsCount: state.pairings?.length || 0,
				champion: state.champion,
				canStart: this.canStartTournament()
			});

		} catch (error: any) {
			this.failureCount++;

			console.error('[TournamentService] ❌ Error loading tournament state:', {
				error: error.message,
				failureCount: this.failureCount,
				maxFailures: this.MAX_FAILURES
			});

			const errorMessage = error?.message || '';
			const isJsonError = errorMessage.includes('JSON') || errorMessage.includes('Unexpected token');

			if (isJsonError) {
				console.error('[TournamentService] ❌ JSON parse error detected');
			}

			this.uiUtils.showErrorPopup(error.message || i18n.t('tournament.error.failedLoad'));
			throw error;
		}
	}

	/* Charge les pairings du round actuel avec gestion des tentatives et timeout */
	private async loadCurrentRoundPairings(tournamentId: number): Promise<MatchPairing[]> {
		const maxRetries = 2;

		const retryDelayMs = (attempt: number) => 200 * attempt;

		const perRequestTimeoutMs = 1200;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), perRequestTimeoutMs);

			try {
				console.log(
					`[TournamentService] Loading pairings attempt ${attempt}/${maxRetries} for tournament ${tournamentId}`
				);

				const response = await fetch(
					`https://localhost:3443/api/tournaments/${tournamentId}/pairings`,
					{
						method: 'GET',
						headers: this.getAuthHeaders(),
						cache: 'no-store',
						signal: controller.signal,
					}
				);

				if (response.status === 503) {
					if (attempt < maxRetries) {
						const d = retryDelayMs(attempt + 1);
						console.warn(
							`[TournamentService] Pairings load attempt ${attempt} got 503, retrying in ${d}ms...`
						);
						await new Promise((r) => setTimeout(r, d));
						continue;
					} else {
						console.error('[TournamentService] Pairings load failed with 503 after all retries');
						return [];
					}
				}

				if (!response.ok) {
					console.warn('[TournamentService] Failed to load pairings:', response.status);
					if (attempt < maxRetries) {
						const d = retryDelayMs(attempt + 1);
						await new Promise((r) => setTimeout(r, d));
						continue;
					}
					return [];
				}

				const data = await response.json();

				console.log('[TournamentService] Pairings data received:', {
					tournamentId,
					currentRound: data.currentRound,
					matchesCount: data.matches?.length || 0,
					attempt,
				});

				const pairings: MatchPairing[] = (data.matches || []).map((match: any) => {
					const isCurrentUserMatch = this.isUserInMatch(match);
					return {
						matchId: match.matchId,
						player1Alias: match.player1Alias,
						player2Alias: match.player2Alias,
						player1UserId: match.player1UserId,
						player2UserId: match.player2UserId,
						player1GuestToken: match.player1GuestToken || null,
						player2GuestToken: match.player2GuestToken || null,
						status: match.status,
						isCurrentUserMatch,
						p1Ready: !!match.p1Ready,
						p2Ready: !!match.p2Ready,
						readyDeadline: match.readyDeadline || null,
					};
				});

				console.log(
					`[TournamentService] ✅ Pairings loaded successfully on attempt ${attempt}`,
					{ tournamentId, pairingsCount: pairings.length }
				);
				return pairings;
			} catch (error: any) {
				if (attempt < maxRetries) {
					const d = retryDelayMs(attempt + 1);
					console.warn(
						`[TournamentService] Pairings load attempt ${attempt} failed (${error?.name || 'Error'}: ${error?.message || error}). Retrying in ${d}ms...`
					);
					await new Promise((r) => setTimeout(r, d));
				} else {
					console.error('[TournamentService] Error loading pairings after all retries:', error);
					return [];
				}
			} finally {
				clearTimeout(timer);
			}
		}
		return [];
	}

	/* Vérifie si l'utilisateur actuel participe au match donné */
	private isUserInMatch(match: any): boolean {
		if (!this.currentUserAlias) return false;

		if (match.player1Alias === this.currentUserAlias ||
			match.player2Alias === this.currentUserAlias) {
			return true;
		}

		return false;
	}

	/* Récupère la liste de tous les tournois disponibles */
	public async listTournaments(): Promise<BackendTournament[]> {
		try {
			const response = await fetch('https://localhost:3443/api/tournaments', {
				method: 'GET',
				headers: this.getAuthHeaders()
			});

			if (!response.ok) {
				throw new Error('Failed to fetch tournaments');
			}

			const data = await response.json();
			return data.tournaments || [];
		} catch (error) {
			console.error('[TournamentService] Error listing tournaments:', error);
			return [];
		}
	}

  /* Convertit l'état backend en état simplifié pour l'affichage */
  private convertToSimplifiedState(
    tournament: BackendTournament,
    participants: BackendParticipant[],
    championFromBackend?: string | null
  ): SimplifiedTournamentState {
    const players = participants
      .sort((a, b) => {
        if (a.is_owner && !b.is_owner) return -1;
        if (!a.is_owner && b.is_owner) return 1;
        return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
      })
      .map(p => ({
        alias: p.player_alias,
        userId: p.user_id || null
      }));

    const champion = championFromBackend || null;

		const active = tournament.status === 'active';

		console.log('[TournamentService] Converted simplified state:', {
			active,
			playersCount: players.length,
			champion,
			tournamentStatus: tournament.status,
			tournamentName: tournament.name,
			currentRound: tournament.current_round
		});

		return {
			active,
			players,
			champion,
			tournamentId: tournament.id,
			tournamentName: tournament.name,
			tournamentStatus: tournament.status,
			currentRound: tournament.current_round,
			pairings: [],
			matches: [],
			currentMatch: null
		};
	}

	/* Retourne l'état actuel du tournoi */
	public getTournamentState(): SimplifiedTournamentState {
		return this.state;
	}

	/* Retourne l'identifiant du tournoi actuel */
	public getCurrentTournamentId(): number | null {
		return this.currentTournamentId;
	}

	/* Retourne l'alias de l'utilisateur actuel dans le tournoi */
	public getCurrentUserAlias(): string | null {
		return this.currentUserAlias;
	}

	/* Vérifie si l'utilisateur actuel est le propriétaire du tournoi */
	public isCurrentUserOwner(): boolean {
		const result = this.isOwner && !!this.currentUserAlias && !!this.currentTournamentId;
		console.debug('[TournamentService] isCurrentUserOwner check:', {
			isOwner: this.isOwner,
			hasAlias: !!this.currentUserAlias,
			hasTournamentId: !!this.currentTournamentId,
			result
		});
		return result;
	}

	/* Rafraîchit les données du tournoi actuel */
	public async refreshCurrentTournament(): Promise<void> {
		if (!this.currentTournamentId) return;
		try {
			await this.loadTournamentState(this.currentTournamentId);
		} catch (e) {
			console.warn('[TournamentService] refreshCurrentTournament failed:', e);
		}
	}

  /* Génère les en-têtes d'authentification pour les requêtes API */
  private getAuthHeaders(): HeadersInit {
    return GuestAuthService.getAuthHeaders();
  }

	/* Retourne un état de tournoi vide par défaut */
	private getEmptyState(): SimplifiedTournamentState {
		return {
			active: false,
			players: [],
			champion: null,
			tournamentId: null,
			tournamentName: undefined,
			tournamentStatus: undefined,
			currentRound: undefined,
			pairings: [],
			matches: [],
			currentMatch: null
		};
	}

  /* Réinitialise l'état du tournoi et le circuit breaker */
  public resetTournament(showToast: boolean = true): void {
    this.state = this.getEmptyState();
    this.currentTournamentId = null;
    this.currentUserAlias = null;
    this.isOwner = false;
    this.failureCount = 0;
    
    if (GuestAuthService.isGuest()) {
      console.log('[TournamentService] 🔄 Clearing guest alias only (keeping token for next tournament)...');
      
      sessionStorage.removeItem('guest_tournament_alias');
      
      console.log('[TournamentService] ✅ Guest alias cleared, token preserved for reuse');
    }
    
    if (showToast) {
	this.uiUtils.showSuccessPopup(i18n.t('tournament.activity.reset'));
    }
    
    console.debug('[TournamentService] Tournament reset (circuit breaker reset)');
  }

	/* Vérifie si le tournoi peut être démarré selon plusieurs critères */
	public canStartTournament(): boolean {
		const state = this.getTournamentState();

		const conditions = {
			isOwner: this.isCurrentUserOwner(),
			notActive: !state.active,
			exactlyFourPlayers: state.players.length === 4,
			noChampion: !state.champion,
			hasTournamentId: !!this.currentTournamentId,
			hasUserAlias: !!this.currentUserAlias
		};

		const canStart = conditions.isOwner &&
			conditions.notActive &&
			conditions.exactlyFourPlayers &&
			conditions.noChampion &&
			conditions.hasTournamentId &&
			conditions.hasUserAlias;

		console.debug('[TournamentService] canStartTournament detailed check:', {
			...conditions,
			result: canStart,
			tournamentStatus: state.active ? 'active' : 'waiting'
		});

		return canStart;
	}

	/* Valide le nom d'un tournoi */
	public isValidTournamentName(name: string): boolean {
		if (!name || name.trim().length === 0) return false;
		if (name.trim().length > 20) return false;
			const nameRegex = /^[a-zA-Z0-9\s\-_\.]+$/;
			return nameRegex.test(name.trim());
		}

	/* Valide un alias de joueur */
	public isValidAlias(alias: string): boolean {
			if (!alias || alias.trim().length === 0) return false;
			if (alias.trim().length > 10) return false;
		const aliasRegex = /^[a-zA-Z0-9\-_\.]+$/;
		return aliasRegex.test(alias.trim());
	}

	/* Retourne une erreur de validation pour le nom et l'alias */
	public getValidationError(name: string, alias: string): string | null {
		if (!this.isValidTournamentName(name)) {
			return i18n.t('tournament.validation.nameInvalidFormat');
		}
		if (!this.isValidAlias(alias)) {
			return i18n.t('tournament.validation.aliasInvalidFormat');
		}
		return null;
	}

	/* Génère le message d'attente approprié selon le statut du tournoi */
	public getWaitingMessage(): string | null {
		const state = this.getTournamentState();

		if (!state.active && state.players.length < 4) {
			const missing = 4 - state.players.length;
			return i18n.t('tournament.activity.wait.waitingPlayers')
				.replace('{n}', String(missing))
				.replace('(s)', missing > 1 ? 's' : '');
		}

		if (!state.active && state.players.length === 4 && !this.isOwner) {
			return i18n.t('tournament.activity.wait.waitingCreator');
		}

		if (state.active && state.pairings && state.pairings.length === 0) {
			return i18n.t('tournament.activity.wait.loadingMatches');
		}

		return null;
	}

	/* Retourne le match actuel du joueur */
	public getCurrentMatch(): { player1: string; player2: string } | null {
		return this.state.currentMatch || null;
	}

	/* Vérifie si un match peut être reporté */
	public canReportMatch(): boolean {
		return false;
	}

	/* Reporte le résultat d'un match */
	public async reportMatchResult(matchId: number, winnerPlayerNumber: 1 | 2, score1?: number, score2?: number): Promise<void> {
		console.warn('[TournamentService] reportMatchResult called but not implemented in REST mode');
	}

	/* Ajoute un joueur au tournoi */
	public addPlayer(): void {
		console.warn('[TournamentService] addPlayer is deprecated in REST mode');
	}

	/* Retire un joueur du tournoi */
	public removePlayer(index: number): void {
		console.warn('[TournamentService] removePlayer is deprecated in REST mode');
	}

	/* Génère le prochain match du bracket */
	public generateNextMatch(): void {
		console.warn('[TournamentService] generateNextMatch is deprecated in REST mode');
	}

	/* Lance le match actuel */
	public playCurrentMatch(): void {
		console.warn('[TournamentService] playCurrentMatch is deprecated in REST mode');
	}

  /* Déclare le gagnant d'un match */
  public declareWinner(winner: string): void {
    console.warn('[TournamentService] declareWinner is deprecated in REST mode');
  }

  /* Retourne le type d'utilisateur actuel */
  public getUserType(): 'registered' | 'guest' | 'none' {
    if (GuestAuthService.isGuest()) {
      return 'guest';
    }
    
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token');
      if (token && !token.startsWith('guest_')) {
        return 'registered';
      }
    } catch (e) {
      console.warn('[TournamentService] Failed to check user type:', e);
    }
    
    return 'none';
  }

  /* Retourne l'identifiant de l'utilisateur actuel */
  public getCurrentUserIdentifier(): { userId?: number; guestToken?: string } {
    return GuestAuthService.getUserIdentifier();
  }
}
