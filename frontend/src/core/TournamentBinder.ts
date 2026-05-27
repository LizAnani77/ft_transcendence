import { TournamentService } from './TournamentService';
import { Navigation } from '../components/Navigation';
import { UIUtils } from './UIUtils';
import { i18n } from './I18n';
import type { WebSocketService } from '../services/WebSocketService';

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

export class TournamentBinder {
	private lastRenderState: string = '';
	private renderCount: number = 0;
	private refreshInterval: number | null = null;
	private showWaitingAnimation: boolean = false;
	private didEnterRefresh: boolean = false;

	/* Initialise le binder de tournoi avec les services et callbacks nécessaires */
	constructor(
		private svc: TournamentService,
		private getCurrentUser: () => any | null,
		private putHtml: (html: string) => void,
		private wsService?: WebSocketService
	) {
		if ((window as any).__showTournamentWaitingAnimation) {
			console.log('[TournamentBinder] Global waiting animation flag detected');
			this.showWaitingAnimation = true;
		}
	}

	/* Force l'affichage de l'animation d'attente */
	public forceWaitingAnimation(): void {
		console.log('[TournamentBinder] Forcing waiting animation display');
		this.showWaitingAnimation = true;
	}

	/* Efface le flag d'animation d'attente */
	public clearWaitingAnimation(): void {
		console.log('[TournamentBinder] Clearing waiting animation flag');
		this.showWaitingAnimation = false;
	}

	/* Rend l'interface de tournoi et attache les gestionnaires d'événements */
	public renderAndBind(): void {
		this.renderCount++;
		const user = this.getCurrentUser?.() || null;
		const state = this.svc.getTournamentState();

		if (!this.didEnterRefresh && this.svc.getCurrentTournamentId()) {
			this.didEnterRefresh = true;
			Promise.resolve()
				.then(() => this.svc.refreshCurrentTournament())
				.then(() => {
					this.lastRenderState = '';
					this.renderAndBind();
				})
				.catch(() => {
				})
			return;
		}

		const stateHash = this.generateStateHash(state, user);
		if (stateHash === this.lastRenderState) {
			console.debug('[TournamentBinder] State unchanged, skipping re-render', {
				renderCount: this.renderCount,
				hash: stateHash
			});
			return;
		}
		this.lastRenderState = stateHash;

		console.debug('[TournamentBinder] renderAndBind - état reçu:', {
			renderCount: this.renderCount,
			active: state.active,
			currentMatch: !!state.currentMatch,
			champion: state.champion,
			currentRound: state.currentRound,
			playersCount: state.players?.length || 0,
			matchesCount: state.matches?.length || 0,
			pairingsCount: state.pairings?.length || 0,
			userAlias: this.svc.getCurrentUserAlias(),
			isOwner: this.svc.isCurrentUserOwner(),
			currentTournamentId: this.svc.getCurrentTournamentId(),
			canStartTournament: this.svc.canStartTournament(),
			showWaitingAnimation: this.showWaitingAnimation,
			stateHash
		});

		try {

			 console.debug('[TournamentBinder] DEBUG - État complet:', {
				active: state.active,
				champion: state.champion,
				tournamentStatus: state.tournamentStatus,
				shouldShowFinished: this.shouldShowFinished(state),
				userAlias: this.svc.getCurrentUserAlias(),
				currentTournamentId: this.svc.getCurrentTournamentId()
			});
			
			if (this.shouldShowFinished(state)) {
				console.log('[TournamentBinder] Case: Tournament finished with champion');
				this.renderFinished(user, state);
				return;
			}

			if (this.showWaitingAnimation) {
				console.log('[TournamentBinder] Case: Forced waiting animation (from match end)');
				const html = this.renderWaitingForOtherMatchScreen(user, state);
				this.putHtml(html);
				this.bindWaitingForMatchActions();
				this.startAutoRefresh();
				return;
			}

			if (this.shouldShowWaitingForOtherMatch(state)) {
				console.log('[TournamentBinder] Case: Waiting for other match to finish');
				const html = this.renderWaitingForOtherMatchScreen(user, state);
				this.putHtml(html);
				this.bindWaitingForMatchActions();
				this.startAutoRefresh();
				return;
			}

			if (this.shouldShowMatchmaking(state)) {		
				console.log('[TournamentBinder] Case: Matchmaking interface (active tournament)');
				this.renderMatchmaking(user, state);
				return;
			}

			if (this.shouldShowActiveMatch(state)) {
				console.log('[TournamentBinder] Case: Active match in progress');
				this.renderActiveMatch(user, state);
				return;
			}

			if (this.shouldShowWaitingOrSetup(state)) {
				console.log('[TournamentBinder] Case: Waiting for players or ready to start');
				this.renderWaiting(user, state);
				return;
			}

			console.log('[TournamentBinder] Case: Setup/Create screen (default fallback)');
			this.renderSetup(user);

		} catch (error) {
			console.error('[TournamentBinder] Error during render:', error);
			this.renderError(user, error);
		}
	}

	/* Génère un hash de l'état actuel pour détecter les changements */
	private generateStateHash(state: any, user: any): string {
		const key = [
			state.active ? '1' : '0',
			state.champion || '',
			state.currentRound || '0',
			state.players?.length || '0',
			state.matches?.length || '0',
			state.currentMatch ? `${state.currentMatch.player1}_${state.currentMatch.player2}` : '',
			state.pairings ? JSON.stringify(state.pairings) : '',
			this.svc.getCurrentUserAlias() || '',
			this.svc.getCurrentTournamentId() || '0',
			this.svc.isCurrentUserOwner() ? '1' : '0',
			this.svc.canStartTournament() ? '1' : '0',
			this.showWaitingAnimation ? '1' : '0'
		].join('|');
		return key;
	}

	/* Détermine si l'interface de matchmaking doit être affichée */
	private shouldShowMatchmaking(state: any): boolean {
		const userAlias = this.svc.getCurrentUserAlias();
		
		if (state.active && !state.champion && state.pairings && state.pairings.length > 0) {
			const userMatch = state.pairings.find((p: any) =>
				p.player1Alias === userAlias || p.player2Alias === userAlias
			);
			
			const shouldShow = userMatch && (userMatch.status === 'pending' || userMatch.status === 'active');
			
			console.log('[TournamentBinder] Matchmaking check:', {
				userAlias,
				userMatch: userMatch ? { status: userMatch.status, matchId: userMatch.matchId } : null,
				shouldShow
			});
			
			return shouldShow;
		}
		
		return false;
	}

	/* Vérifie si un match actif doit être affiché */
	private shouldShowActiveMatch(state: any): boolean {
		return state.active &&
			state.currentMatch &&
			state.currentMatch.player1 &&
			state.currentMatch.player2 &&
			!state.champion;
	}

	/* Détermine si l'écran de fin de tournoi doit être affiché */
	private shouldShowFinished(state: any): boolean {
		return (!!state.champion)
			|| state.tournamentStatus === 'finished'
			|| state.tournamentStatus === 'cancelled'
			|| state.tournamentComplete === true
			|| (!state.active && (!!state.champion || state.tournamentStatus === 'finished' || state.tournamentStatus === 'cancelled'));
	}

	/* Vérifie si l'écran d'attente ou de configuration doit être affiché */
	private shouldShowWaitingOrSetup(state: any): boolean {
		const hasTournamentContext = this.svc.getCurrentTournamentId() && this.svc.getCurrentUserAlias();

		if (hasTournamentContext) {
			console.debug('[TournamentBinder] Has tournament context - showing waiting interface');
			return true;
		}

		if (state.active && !state.currentMatch && !state.champion) {
			return true;
		}

		if (!state.active && state.players && state.players.length > 0 && !state.champion) {
			return true;
		}

		return false;
	}

	/* Vérifie si l'utilisateur doit attendre la fin d'autres matchs */
	private shouldShowWaitingForOtherMatch(state: any): boolean {
		const userAlias = this.svc.getCurrentUserAlias();
		if (!userAlias || !state.active || state.champion) return false;

		const pairings = state.pairings || [];
		if (pairings.length === 0) return false;

		const userMatch = pairings.find((p: any) =>
			p.player1Alias === userAlias || p.player2Alias === userAlias
		);

		const userHasPendingMatch = userMatch && userMatch.status === 'pending';

		const otherOngoingMatch = pairings.find((p: any) =>
			(p.status === 'pending' || p.status === 'active') &&
			p.player1Alias !== userAlias &&
			p.player2Alias !== userAlias
		);

		// Afficher "Waiting for other matches..." SEULEMENT si:
		// - Le user a FINI son match (status: 'finished')
		// - ET il y a d'autres matchs en cours
		const userFinishedMatch = userMatch && userMatch.status === 'finished';
		const shouldShowWaiting = userFinishedMatch && !!otherOngoingMatch;

		console.log('[TournamentBinder] Waiting check:', {
			userAlias,
			userMatch: userMatch ? { status: userMatch.status, id: userMatch.matchId } : null,
			userHasPendingMatch,
			userFinishedMatch,
			otherOngoingMatch: otherOngoingMatch ? { status: otherOngoingMatch.status } : null,
			shouldShowWaiting
		});

		return shouldShowWaiting;
	}

	/* Rend l'interface de matchmaking et attache les handlers */
	private renderMatchmaking(user: any, state: any): void {
		this.stopAutoRefresh();
		const html = this.renderMatchmakingInterface(user, state);
		this.putHtml(html);
		this.bindMatchmakingActions();
		this.startAutoRefresh();
	}

	/* Rend l'interface de match actif et attache les handlers */
	private renderActiveMatch(user: any, state: any): void {
		this.stopAutoRefresh();
		const html = this.renderCurrentMatch(user, state);
		this.putHtml(html);
		this.bindMatchActions();
		this.startAutoRefresh();
	}

	/* Rend l'interface de tournoi terminé et attache les handlers */
	private renderFinished(user: any, state: any): void {
		const html = this.renderFinishedInterface(user, state);
		this.putHtml(html);
		this.bindFinishedActions();
		this.stopAutoRefresh();
	}

	/* Rend l'interface d'attente et attache les handlers */
	private renderWaiting(user: any, state: any): void {
		this.stopAutoRefresh();
		const html = this.renderWaitingForNextRound(user, state);
		this.putHtml(html);
		this.bindWaitingActions();
		this.startAutoRefresh();
	}

	/* Rend l'interface de configuration et de création de tournoi */
	private renderSetup(user: any): void {
		this.putHtml(this.renderSetupCreate(user));
		this.bindCreateHandlers();
		this.stopAutoRefresh();
	}

	/* Rend une page d'erreur avec le message d'erreur */
	private renderError(user: any, error: any): void {
		const html = `
			<div style="color:#ffffff;min-height:100vh;">
				${Navigation.render(user)}
				<div class="main-content" style="max-width:460px;margin:0 auto;padding:2rem;text-align:center;">
					<h1 style="margin-bottom:1.5rem;font-size:1.5rem;">${i18n.t('tournament.ui.errorPage.title')}</h1>
					<div style="background:rgba(255,0,0,0.1);border-radius:8px;padding:2rem;margin-bottom:2rem;">
						<p style="color:#ff6b6b;margin-bottom:1rem;">${i18n.t('tournament.ui.errorPage.message')}</p>
						<p style="opacity:.8;font-size:.9rem;">${error?.message || i18n.t('tournament.ui.unknown')}</p>
						<button data-action="reload" style="margin-top:1rem;background:#6366f1;color:white;border:none;padding:.5rem 1rem;border-radius:6px;cursor:pointer;">
							${i18n.t('tournament.ui.errorPage.reload')}
						</button>
					</div>
				</div>
			</div>`;
		this.putHtml(html);
		this.stopAutoRefresh();
	}

	/* Génère le HTML de l'interface de matchmaking avec les pairings */
	private renderMatchmakingInterface(currentUser: any, state: any): string {
		const pairings: MatchPairing[] = state.pairings || [];
		const currentRound = state.currentRound || 1;
		const tournamentName = state.tournamentName || 'Tournament';
		const tournamentId = this.svc.getCurrentTournamentId();
		const userAlias = this.svc.getCurrentUserAlias();

		const userMatch = pairings.find(p => p.isCurrentUserMatch);
		const hasMatch = !!userMatch;

		console.log('[TournamentBinder] Rendering matchmaking interface', {
			pairingsCount: pairings.length,
			currentRound,
			userAlias,
			hasMatch,
			userMatch,
			tournamentId
		});

		return `
      <div style="color:#ffffff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div class="main-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;max-width:600px;margin:0 auto;text-align:center;">
					<h1 style="margin-bottom:1.5rem;font-size:1.5rem;">${i18n.t('tournament.ui.matchmaking.title').replace('{name}', tournamentName).replace('{n}', String(currentRound))}</h1>
          
          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:2rem;margin-bottom:2rem;width:100%;">
						<h2 style="margin-bottom:1.5rem;font-size:1.2rem;">${i18n.t('tournament.ui.matchmaking.currentMatches')}</h2>
            
            ${pairings.length > 0 ? pairings.map(pairing => {
			const isPlayer1 = pairing.player1Alias === userAlias;
			const opponentUserId = isPlayer1 ? pairing.player2UserId : pairing.player1UserId;
			const opponentAlias = isPlayer1 ? pairing.player2Alias : pairing.player1Alias;

			console.log('[TournamentBinder] Pairing details:', {
				matchId: pairing.matchId,
				player1: { alias: pairing.player1Alias, userId: pairing.player1UserId },
				player2: { alias: pairing.player2Alias, userId: pairing.player2UserId },
				currentUserAlias: userAlias,
				isPlayer1,
				opponentUserId,
				opponentAlias,
				isCurrentUserMatch: pairing.isCurrentUserMatch
			});

			return `
              <div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:1rem;margin-bottom:1rem;${pairing.isCurrentUserMatch ? 'border:2px solid #0ea5e9;' : ''}">
                <div style="font-size:1rem;margin-bottom:0.5rem;">
                  <span style="font-weight:600;">${pairing.player1Alias}</span>
                  <span style="margin:0 1rem;opacity:.7;">VS</span>
                  <span style="font-weight:600;">${pairing.player2Alias}</span>
                </div>

                ${pairing.isCurrentUserMatch && pairing.status === 'pending' ? (() => {
					const iAmP1 = userAlias === pairing.player1Alias;
					const iAmReady = iAmP1 ? !!pairing.p1Ready : !!pairing.p2Ready;
					const oppReady = iAmP1 ? !!pairing.p2Ready : !!pairing.p1Ready;
					const disabled = iAmReady ? 'disabled' : '';
					const label = iAmReady ? i18n.t('tournament.ui.button.readyChecked') : i18n.t('tournament.ui.button.ready');
					const deadline = pairing.readyDeadline ? pairing.readyDeadline : '';
					const countdown = deadline
						? `<span class="countdown"
                            data-countdown
                            data-deadline="${deadline}"
                            style="font-variant-numeric:tabular-nums;font-weight:700;min-width:52px;display:inline-block;margin-right:.75rem;">00:10</span>`
						: '';
					const hint =
						(() => {
							let opponentOnline: boolean | null = null;
							try {
								const online = (window as any)?.pongApp?.wsBinder?.getOnlineUsers?.() || [];
								if (opponentUserId !== null && opponentUserId !== undefined) {
									const oppIdNum = Number(opponentUserId);
									opponentOnline = online.some((u: any) => Number(u?.id) === oppIdNum && u?.is_online === true);
								}
							} catch {}

							if (!iAmReady && !oppReady) {
								return `<div style="font-size:0.85rem;margin-top:.25rem;color:#60a5fa;">${i18n.t('tournament.ui.match.waitBothReady')}</div>`;
							}

							if (iAmReady && !oppReady) {
									if (opponentOnline === false) {
										return `<div style="font-size:.75rem;margin-top:.25rem;color:#ffffff;background:rgba(251,191,36,0.15);padding:.2rem .5rem;border-radius:4px;font-weight:600;">${i18n.t('tournament.ui.match.opponentOffline')}</div>`;
									}
									return `<div style="font-size:0.85rem;margin-top:.25rem;color:#60a5fa;">${i18n.t('tournament.ui.match.waitOpponent')}</div>`;
							}

							return `<div style=\"font-size:.75rem;opacity:.7;margin-top:.25rem;\">${i18n.t('tournament.ui.match.oppReadyClickReady')}</div>`;
						})()

					return `
                    <div
					  class="match-ctx"
					  data-match-id="${pairing.matchId}"
					  data-tournament-id="${tournamentId ?? ''}"
					  data-opponent-id="${opponentUserId ?? ''}"
					  data-p1-ready="${pairing.p1Ready ? '1' : '0'}"
					  data-p2-ready="${pairing.p2Ready ? '1' : '0'}"
    				  data-i-am-p1="${iAmP1 ? '1' : '0'}"
    				  style="margin-top:.75rem;display:flex;flex-direction:column;align-items:center;">
                      <div style="display:flex;align-items:center;gap:.5rem;">
                        ${countdown}
                        <button class="btn-ready"
                                data-action="ready"
                                data-match-id="${pairing.matchId}"
                                style="padding:.6rem 1rem;background:#064c48ff;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;"
                                ${disabled}>
                          ${label}
                        </button>
                      </div>
                      ${hint}
                    </div>
                  `;
				})() : ''}
                
                ${pairing.isCurrentUserMatch && pairing.status === 'active' && opponentUserId ? `
				<!-- ✅ Both ready countdown visible jusqu'à 0 -->
				<div
					class="match-ctx"
					data-match-id="${pairing.matchId}"
					data-tournament-id="${tournamentId ?? ''}"
					data-opponent-id="${opponentUserId ?? ''}"
					data-p1-ready="${pairing.p1Ready ? '1' : '0'}"
					data-p2-ready="${pairing.p2Ready ? '1' : '0'}"
					data-i-am-p1="${pairing.player1Alias === userAlias ? '1' : '0'}"
					style="margin-top:0.5rem;padding:0.5rem;background:transparent;border-radius:4px;display:flex;flex-direction:column;align-items:center;gap:.4rem;justify-content:center;">
					${pairing.readyDeadline ? `
						<span class="countdown"
							data-countdown
							data-deadline="${pairing.readyDeadline}"
								style="font-variant-numeric:tabular-nums;font-weight:700;min-width:52px;display:inline-block;">00:10</span>
					` : ''}
						<span data-ready-msg style="color:#60a5fa;font-size:0.85rem;">${i18n.t('tournament.ui.match.readyCountdownMsg')}</span>
					</div>
				` : pairing.isCurrentUserMatch && !opponentUserId ? `
				<!-- ✅ Erreur : Si opponent user ID manquant -->
				<div style="margin-top:0.5rem;padding:0.5rem;background:rgba(255,165,0,0.1);border-radius:4px;">
					<span style="color:#ffa500;font-size:0.85rem;">${i18n.t('tournament.ui.match.opponentIdMissing')}</span>
				</div>
				` : ''}
              </div>
            `;
		}).join('') : `
              <div style="opacity:.6;font-size:.9rem;">${i18n.t('tournament.ui.noMatches')}</div>
            `}
            
            ${!hasMatch ? `
              <div style="margin-top:1.5rem;padding:1rem;background:rgba(255,255,0,0.1);border-radius:6px;">
				<p style="color:#fbbf24;margin:0;font-size:.9rem;">${i18n.t('tournament.ui.waitingOtherMatches')}</p>
              </div>
            ` : ''}
            
          </div>
        </div>
      </div>`;
	}

	/* Génère le HTML de l'interface de tournoi terminé avec le champion */
	private renderFinishedInterface(currentUser: any, state: any): string {
		const tournamentName = state.tournamentName || 'Tournament';
		const tournamentId = this.svc.getCurrentTournamentId();
		
		const isCancelled = state.tournamentStatus === 'cancelled';
		const champion = state.champion || state?.winner?.alias || null;

		console.log('[TournamentBinder] Rendering finished interface', {
			tournamentName,
			champion,
			isCancelled,
			tournamentId
		});

		// Si tournoi annulé
		if (isCancelled) {
			return `
				<div style="color:#ffffff;min-height:100vh;">
					${Navigation.render(currentUser)}
					<div class="main-content" style="max-width:600px;margin:0 auto;padding:2rem;text-align:center;"></div>
				</div>`;
		}

		// Si tournoi terminé normalement
		return `
			<div style="color:#ffffff;min-height:100vh;">
				${Navigation.render(currentUser)}
				<div class="main-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;max-width:600px;margin:0 auto;text-align:center;">

					<h1 style="margin-bottom:2rem;font-size:1.5rem;letter-spacing:0.05em;">${i18n.t('tournament.ui.results.title') || 'Résultats du Tournoi'}</h1>

					<div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:2rem;margin-bottom:2rem;width:100%;">
						<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:2rem;margin-bottom:1.5rem;">
							<div style="margin-bottom:1rem;">
								<span class="material-symbols-outlined" style="font-size:3rem;color:#ffffff;">emoji_events</span>
							</div>
							<h2 style="margin-bottom:1rem;font-size:1.2rem;color:#ffffff;">${i18n.t('tournament.ui.finished.complete.title')}</h2>
							<div style="font-size:1.1rem;font-weight:700;margin-bottom:0.5rem;color:#ffffff;">
								${i18n.t('tournament.ui.finished.complete.winner').replace('{name}', champion || i18n.t('tournament.ui.unknown'))}
							</div>
							<div style="font-size:1.1rem;opacity:0.8;color:#ffffff;margin-top:1rem;">
								${tournamentName}
							</div>
						</div>

						<div style="margin-top:2rem;display:flex;justify-content:center;">
							<button id="btn-quit-tournament"
								style="padding:1rem 2rem;background:#c6209d;color:white;border:none;border-radius:8px;cursor:pointer;font-size:1rem;font-weight:600;transition:all 0.2s;">
								${i18n.t('tournament.ui.quit.button')}
							</button>
						</div>
					</div>
				</div>
			</div>`;
	}

	/* Génère le HTML de l'interface de création et de jointure de tournoi */
	private renderSetupCreate(currentUser: any): string {
		const isAuthenticated = !!currentUser?.id;
		const username = currentUser?.username || '';

		return `
      <div style="color:#ffffff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div class="main-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;max-width:960px;margin:0 auto;">

          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:1.5rem;max-width:600px;width:100%;margin:0 auto;">
            
						<h2 style="margin-bottom:2rem;text-align:center;font-size:1.25rem;">${i18n.t('tournament.ui.title')}</h2>
            
            <div style="margin-bottom:2rem;padding:1.5rem;background:rgba(255,255,255,0.05);border-radius:8px;">
							<h3 style="margin-bottom:1rem;font-size:1.1rem;">${i18n.t('tournament.ui.create.title')}</h3>
              
              <div style="margin-bottom:1rem;">
								<label style="display:block;margin-bottom:.5rem;font-size:.9rem;opacity:.9;">${i18n.t('tournament.ui.create.nameLabel')}</label>
								<input id="tournament-name" type="text" placeholder="${i18n.t('tournament.ui.create.namePlaceholder')}" 
                  style="width:100%;padding:.75rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;font-size:.9rem;" 
                  maxlength="20" />
                <div id="tournament-name-error" style="color:#c6209d;font-size:.8rem;margin-top:.25rem;display:none;"></div>
              </div>

              ${isAuthenticated ? `
              <div style="margin-bottom:1rem;">
								<label style="display:block;margin-bottom:.5rem;font-size:.9rem;opacity:.9;">${i18n.t('tournament.ui.alias.label')}</label>
                <input id="creator-alias" type="text" value="${username}" readonly
                  style="width:100%;padding:.75rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;font-size:.9rem;opacity:0.7;cursor:not-allowed;" />
								<div style="font-size:.75rem;opacity:.6;margin-top:.25rem;">${i18n.t('tournament.ui.alias.readonlyHint')}</div>
              </div>
              ` : `
              <div style="margin-bottom:1rem;">
								<label style="display:block;margin-bottom:.5rem;font-size:.9rem;opacity:.9;">${i18n.t('tournament.ui.alias.label')}</label>
									<input id="creator-alias" type="text" placeholder="${i18n.t('tournament.ui.alias.placeholder')}" 
                  style="width:100%;padding:.75rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;font-size:.9rem;" 
                  maxlength="10" />
                <div id="creator-alias-error" style="color:#c6209d;font-size:.8rem;margin-top:.25rem;display:none;"></div>
								<div style="font-size:.75rem;opacity:.6;margin-top:.25rem;">${i18n.t('tournament.ui.alias.formatHint')}</div>
              </div>
              `}

              <!-- Au lieu de height:40px, utilise padding:12px -->
			<button id="btn-create-tournament"
					style="width:100%;padding:12px;background:#0ea5e999;color:white;border:none;border-radius:6px;cursor:pointer;font-size:.9rem;font-weight:600;">
			${i18n.t('tournament.ui.create.button')}
			</button>
            </div>

            <div style="margin-bottom:1.5rem;padding:1.5rem;background:rgba(255,255,255,0.05);border-radius:8px;">
							<h3 style="margin-bottom:1rem;font-size:1.1rem;">${i18n.t('tournament.ui.join.title')}</h3>
              
              ${isAuthenticated ? `
              <div style="margin-bottom:1rem;">
								<label style="display:block;margin-bottom:.5rem;font-size:.9rem;opacity:.9;">${i18n.t('tournament.ui.alias.label')}</label>
                <input id="join-alias" type="text" value="${username}" readonly
                  style="width:100%;padding:.75rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;font-size:.9rem;opacity:0.7;cursor:not-allowed;" />
								<div style="font-size:.75rem;opacity:.6;margin-top:.25rem;">${i18n.t('tournament.ui.alias.readonlyHint')}</div>
              </div>
              ` : `
              <div style="margin-bottom:1rem;">
								<label style="display:block;margin-bottom:.5rem;font-size:.9rem;opacity:.9;">${i18n.t('tournament.ui.alias.label')}</label>
									<input id="join-alias" type="text" placeholder="${i18n.t('tournament.ui.alias.placeholder')}" 
                  style="width:100%;padding:.75rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;font-size:.9rem;" 
                  maxlength="10" />
                <div id="join-alias-error" style="color:#c6209d;font-size:.8rem;margin-top:.25rem;display:none;"></div>
								<div style="font-size:.75rem;opacity:.6;margin-top:.25rem;">${i18n.t('tournament.ui.alias.formatHint')}</div>
              </div>
              `}

              <button id="btn-list-tournaments"
						style="width:100%;padding:12px;background:rgba(255,255,255,0.1);color:white;border:1px solid rgba(255,255,255,0.6);border-radius:6px;cursor:pointer;font-size:.85rem;margin-bottom:1rem;font-weight:600;">
			  ${i18n.t('tournament.ui.list.button')}
			  </button>

              <button id="btn-tournament-history"
        		style="width:100%;padding:12px;background:rgba(99,102,241,0.2);color:#ffffff;border:1px solid #7e89f2ff ;border-radius:6px;cursor:pointer;font-size:.85rem;margin-bottom:1rem;font-weight:600;">
  				${i18n.t('tournament.ui.history.button')}
			  </button>

              <div id="tournaments-list" style="display:none;">
								<div style="font-size:.9rem;opacity:.9;margin-bottom:.5rem;">${i18n.t('tournament.ui.list.availableTitle')}</div>
                <div id="tournaments-container" style="max-height:200px;overflow-y:auto;"></div>
              </div>

              <div id="history-list" style="display:none;">
								<div style="font-size:.9rem;opacity:.9;margin-bottom:.5rem;">${i18n.t('tournament.ui.history.title')}</div>
                <div id="history-container" style="max-height:300px;overflow-y:auto;"></div>
              </div>
            </div>

            <div style="font-size:.85rem;opacity:.8;text-align:center;">
							${i18n.t('tournament.ui.note.start')}<br/>
							<span style="opacity:.6;">Note: ${isAuthenticated ? i18n.t('tournament.ui.note.authenticated') : i18n.t('tournament.ui.note.guest')}</span>
            </div>
          </div>
        </div>
      </div>`;
	}

	/* Génère le HTML du match en cours avec possibilité de reporter le résultat */
	private renderCurrentMatch(currentUser: any, state: any): string {
		const match = state.currentMatch;
		if (!match) return this.renderWaitingForNextRound(currentUser, state);

		return `
      <div style="color:#ffffff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div class="main-content" style="max-width:560px;margin:0 auto;padding:2rem;text-align:center;">
					<h1 style="margin-bottom:1.5rem;font-size:1.5rem;">${i18n.t('tournament.ui.round.title').replace('{n}', String(state.currentRound))}</h1>
          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:2rem;margin-bottom:2rem;">
            <div style="font-size:1.2rem;margin-bottom:1.5rem;">
              <span style="font-weight:600;">${match.player1}</span> 
							<span style="margin:0 1rem;opacity:.7;">VS</span> 
              <span style="font-weight:600;">${match.player2}</span>
            </div>
            
            ${this.svc.canReportMatch() ? `
            <div style="margin-bottom:2rem;">
							<div style="font-size:.9rem;opacity:.8;margin-bottom:1rem;">${i18n.t('tournament.ui.report.title')}</div>
              
              <div style="display:flex;gap:1rem;justify-content:center;margin-bottom:1rem;">
                <button id="btn-winner-p1" data-winner="1" 
                  style="padding:.75rem 1.5rem;background:rgba(34,197,94,0.2);border:2px solid #22c55e;color:#22c55e;border-radius:8px;cursor:pointer;font-size:.9rem;font-weight:600;">
									${i18n.t('tournament.ui.report.win').replace('{name}', match.player1)}
                </button>
                <button id="btn-winner-p2" data-winner="2"
                  style="padding:.75rem 1.5rem;background:rgba(34,197,94,0.2);border:2px solid #22c55e;color:#22c55e;border-radius:8px;cursor:pointer;font-size:.9rem;font-weight:600;">
									${i18n.t('tournament.ui.report.win').replace('{name}', match.player2)}
                </button>
              </div>

              <div style="margin-top:1.5rem;">
								<label style="display:block;font-size:.85rem;opacity:.8;margin-bottom:.5rem;">${i18n.t('tournament.ui.report.optionalScores')}</label>
                <div style="display:flex;gap:.5rem;justify-content:center;align-items:center;">
                  <input id="score-p1" type="number" min="0" max="50" placeholder="0" 
                    style="width:60px;padding:.5rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;text-align:center;font-size:.9rem;" />
                  <span style="opacity:.7;">-</span>
                  <input id="score-p2" type="number" min="0" max="50" placeholder="0"
                    style="width:60px;padding:.5rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;text-align:center;font-size:.9rem;" />
                </div>
								<div style="font-size:.75rem;opacity:.6;margin-top:.25rem;">${i18n.t('tournament.ui.report.maxPointsHint')}</div>
              </div>
            </div>
            ` : `
            <div style="margin-bottom:2rem;padding:1rem;background:rgba(255,255,0,0.1);border-radius:6px;">
							<p style="color:#fbbf24;margin:0;font-size:.9rem;">${i18n.t('tournament.ui.report.inProgress')}</p>
            </div>
            `}
          </div>

          <div style="margin-top:1rem;">
						<h3 style="font-size:1rem;margin-bottom:1rem;">${i18n.t('tournament.ui.completedMatches.title')}</h3>
            <div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:1rem;">
              ${state.matches.length > 0 ?
				state.matches.map((m: any) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                    <span style="font-size:.9rem;">${m.player1} vs ${m.player2}</span>
										<span style="font-size:.85rem;color:#22c55e;font-weight:600;">${i18n.t('tournament.ui.completedMatches.listWinner').replace('{name}', m.winner)}</span>
                  </div>
                `).join('') :
				`<div style="opacity:.6;font-size:.9rem;">${i18n.t('tournament.ui.completedMatches.empty')}</div>`
			}
            </div>
          </div>
        </div>
      </div>`;
	}

	/* Génère le HTML de l'écran d'attente du prochain round */
	private renderWaitingForNextRound(currentUser: any, state: any): string {
		const completedMatches = state.matches || [];
		const lastMatch = completedMatches[completedMatches.length - 1];
		const waitingMessage = this.svc.getWaitingMessage();
		const canStart = this.svc.canStartTournament();
		const isOwner = this.svc.isCurrentUserOwner();
		const playersCount = state.players?.length || 0;

		console.debug('[TournamentBinder] renderWaitingForNextRound:', {
			playersCount,
			isOwner,
			canStart,
			active: state.active,
			waitingMessage,
			tournamentId: this.svc.getCurrentTournamentId(),
			userAlias: this.svc.getCurrentUserAlias()
		});

		return `
      <div style="color:#ffffff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div class="main-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;max-width:500px;margin:0 auto;text-align:center;">
					<h1 style="margin-bottom:1.5rem;font-size:1.5rem;">${i18n.t('tournament.ui.status.title')}</h1>
          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:2rem;margin-bottom:2rem;">
            
            ${waitingMessage ? `
            <div style="margin-bottom:1.5rem;padding:1rem;background:rgba(255,255,255,0.05);border-radius:6px;">
              <p style="margin:0;font-size:.95rem;opacity:.9;">${waitingMessage}</p>
            </div>
            ` : ''}

            ${canStart ? `
            <div style="margin-bottom:1.5rem;">
              <button id="btn-start-tournament"
                style="padding:1rem 2rem;background:#064c48ff;color:white;border:none;border-radius:8px;cursor:pointer;font-size:1.1rem;font-weight:700;transition:all 0.2s;">
								${i18n.t('tournament.ui.status.start.button')}
              </button>
							<div style="font-size:.8rem;opacity:.7;margin-top:.5rem;">${i18n.t('tournament.ui.status.start.allReadyHint')}</div>
            </div>
            ` : (!state.active && playersCount < 4 && isOwner) ? `
            <div style="margin-bottom:1.5rem;padding:1rem;background:rgba(99,102,241,0.2);border-radius:6px;">
							<div style="color:#ffffff;font-size:.9rem;">${i18n.t('tournament.ui.status.waitingMore').replace('{count}', String(playersCount))}</div>
            </div>
            ` : (!state.active && playersCount === 4 && !isOwner) ? `
            <div style="margin-bottom:1.5rem;padding:1rem;background:rgba(99,102,241,0.2);border-radius:6px;">
							<div style="color:#ffffff;font-size:.9rem;">${i18n.t('tournament.ui.status.fullWaitingCreator')}</div>
            </div>
            ` : `
            <div style="margin-bottom:1.5rem;padding:1rem;background:rgba(99,102,241,0.2);border-radius:6px;">
							<div style="color:#ffffff;font-size:.9rem;">${i18n.t('tournament.ui.status.inProgress')}</div>
            </div>
            `}

            ${lastMatch ? `
            <div style="margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.2);">
							<div style="font-size:.9rem;opacity:.8;margin-bottom:.5rem;">${i18n.t('tournament.ui.lastMatch.title')}</div>
              <div style="font-size:1rem;">${lastMatch.player1} vs ${lastMatch.player2}</div>
							<div style="font-size:.9rem;margin-top:.5rem;color:#22c55e;">${i18n.t('tournament.ui.completedMatches.listWinner').replace('{name}', lastMatch.winner)}</div>
            </div>
            ` : ''}
            
            ${this.svc.getCurrentTournamentId() && !state.active ? `
            <div style="margin-top:1rem;display:flex;justify-content:center;">
              <button id="btn-leave-tournament"
                style="padding:.75rem 1.5rem;background:rgba(198,32,157,0.2);color:#ffffff;border:1px solid #c6209d;border-radius:6px;cursor:pointer;font-size:.9rem;">
								${i18n.t('tournament.ui.leave.button')}
              </button>
            </div>
            ` : ''}
          </div>

          <div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:1rem;">
						<h3 style="font-size:1rem;margin-bottom:1rem;">${i18n.t('tournament.ui.players.title').replace('{count}', String(playersCount))}</h3>
            ${state.players?.length > 0 ?
				state.players.map((p: any, i: number) => `
                <div style="padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:.9rem;">${p.alias}</span>
                  <div style="display:flex;align-items:center;gap:.5rem;">
                    ${isOwner && i === 0 ?
						`<span class=\"material-symbols-outlined\" style=\"font-size:1.2rem;color:#fbbf24;vertical-align:middle;font-variation-settings:'FILL' 1;\">star</span>` :
						''}
                  </div>
                </div>
              `).join('') :
				`<div style="opacity:.6;font-size:.9rem;">${i18n.t('tournament.ui.players.empty')}</div>`
			}
          </div>
        </div>
      </div>`;
	}

	/* Génère le HTML de l'écran d'attente pendant qu'un autre match est en cours */
	private renderWaitingForOtherMatchScreen(user: any, state: any): string {
		const userAlias = this.svc.getCurrentUserAlias();

		const pairings = state.pairings || [];
		const ongoingMatch = pairings.find((p: any) =>
			p.status !== 'finished' &&
			p.player1Alias !== userAlias &&
			p.player2Alias !== userAlias
		);

		return `
      <div style="color:#ffffff;min-height:100vh;">
        ${Navigation.render(user)}
        <div class="main-content" style="position:fixed;inset:0;background:rgba(1,4,14,0.88);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:100000;pointer-events:auto;">

          <div style="background:linear-gradient(120deg,rgba(5,15,30,0.98) 0%,rgba(2,8,18,0.99) 100%);border:1px solid rgba(14,165,233,0.7);border-radius:14px;padding:1.15rem 1.3rem;width:min(32vw,480px);color:#ffffff;text-align:center;box-shadow:0 12px 48px rgba(0,0,0,0.45);font-family:'Jura',sans-serif;">
            <div style="font-size:.60rem;letter-spacing:.25em;text-transform:uppercase;color:#ffffff;opacity:.75;margin-bottom:.5rem;">
              ${i18n.t('tournament.ui.matchInProgress') || 'MATCH EN COURS'}
            </div>
            <h3 style="margin:0 0 1.2rem 0;font-size:1.2rem;color:#ffffff;">
              ${i18n.t('tournament.ui.waitingForMatchToEnd')}
            </h3>

            ${ongoingMatch ? `
            <div style="display:flex;justify-content:center;align-items:center;gap:1.5rem;font-size:1rem;margin-bottom:1rem;">
              <span style="font-weight:600;">${ongoingMatch.player1Alias}</span>
              <span style="opacity:0.6;">VS</span>
              <span style="font-weight:600;">${ongoingMatch.player2Alias}</span>
            </div>
            ` : `
            <div style="opacity:0.7;font-size:0.95rem;margin-bottom:1rem;">${i18n.t('tournament.ui.loadingInfo')}</div>
            `}

            <div style="width:100%;height:3px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden;">
              <div style="width:100%;height:100%;background:linear-gradient(90deg,rgba(14,165,233,0.6),rgba(255,255,255,0.4));animation:waitingBar 3s ease infinite;"></div>
            </div>
            <div style="margin-top:.75rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.2em;color:#ffffff;opacity:.8;animation:waitingPulse 1.6s ease-in-out infinite;">
              ${i18n.t('tournament.ui.pleaseWait') || 'VEUILLEZ PATIENTER'}
            </div>
          </div>
        </div>
      </div>

      <style>
        @keyframes waitingBar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0); }
          100% { transform: translateX(100%); }
        }
        @keyframes waitingPulse {
          0% { opacity: .45; }
          50% { opacity: 1; }
          100% { opacity: .45; }
        }
      </style>
    `;
	}

	/* Affiche une popup de confirmation avant de quitter le tournoi */
	private confirmLeaveTournament(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const overlay = document.createElement('div');
			overlay.setAttribute('data-leave-confirm', '1');
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

			box.innerHTML = `
				<h3 style="margin:0 0 .75rem 0;font-size:1rem;">${i18n.t('tournament.ui.leave.dialog.title') || i18n.t('tournament.ui.leave.button')}</h3>
				<p style="margin:0 0 1rem 0;color:#eaeaea;font-size:.9rem;">${i18n.t('tournament.ui.confirm.leave')}</p>
				<div style="display:flex;gap:.5rem;justify-content:flex-end;">
					<button data-action="cancel" 
						style="
							background:rgba(255,255,255,0.10);
							color:#fff;
							border:1px solid rgba(255,255,255,0.25);
							padding:.5rem .9rem;
							border-radius:8px;
							cursor:pointer;
							font-size:.9rem;
						">
						${i18n.t('friends.decline')}
					</button>
					<button data-action="ok" 
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
						${i18n.t('friends.accept')}
					</button>
				</div>
			`;

			const nav = document.querySelector('nav') as HTMLElement | null;
			const prevNavPointerEvents = nav?.style.pointerEvents;
			if (nav) nav.style.pointerEvents = 'none';

			const handleKeyDown = (ev: KeyboardEvent) => {
				if (ev.key === 'Escape') {
					ev.preventDefault();
					close(false);
				}
			};
			document.addEventListener('keydown', handleKeyDown);

			const close = (val: boolean) => {
				document.removeEventListener('keydown', handleKeyDown);
				if (nav) nav.style.pointerEvents = prevNavPointerEvents || 'auto';
				try { document.body.removeChild(overlay); } catch {}
				resolve(val);
			};

			box.querySelector('[data-action="cancel"]')?.addEventListener('click', () => close(false));
			box.querySelector('[data-action="ok"]')?.addEventListener('click', () => close(true));

			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) close(false);
			});

			overlay.appendChild(box);
			document.body.appendChild(overlay);
		});
	}

	/* Attache les gestionnaires d'événements pour la création et la jointure de tournoi */
	private bindCreateHandlers(): void {
		const ui = new UIUtils();
		const currentUser = this.getCurrentUser?.() || null;
		const isAuthenticated = !!currentUser?.id;

		const nameInput = document.getElementById('tournament-name') as HTMLInputElement;
		const creatorAliasInput = document.getElementById('creator-alias') as HTMLInputElement;
		const joinAliasInput = document.getElementById('join-alias') as HTMLInputElement;
		const createBtn = document.getElementById('btn-create-tournament') as HTMLButtonElement;
		const listBtn = document.getElementById('btn-list-tournaments') as HTMLButtonElement;
		const historyBtn = document.getElementById('btn-tournament-history') as HTMLButtonElement;

		if (!nameInput || !creatorAliasInput || !createBtn) {
			console.error('[TournamentBinder] Required elements not found for create handlers');
			return;
		}

		const validateTournamentName = () => {
			const errorEl = document.getElementById('tournament-name-error');
			if (!errorEl) return true;

			const value = nameInput.value.trim();
			if (!this.svc.isValidTournamentName(value)) {
				errorEl.textContent = i18n.t('tournament.validation.nameInvalidFormat');
				errorEl.style.display = 'block';
				nameInput.style.borderColor = '#c6209d';
				return false;
			}

			errorEl.style.display = 'none';
			nameInput.style.borderColor = 'rgba(255,255,255,0.2)';
			return true;
		};

		const validateCreatorAlias = () => {
			if (isAuthenticated) return true;

			const errorEl = document.getElementById('creator-alias-error');
			if (!errorEl) return true;

			const value = creatorAliasInput.value.trim();
			if (!this.svc.isValidAlias(value)) {
				errorEl.textContent = i18n.t('tournament.validation.aliasInvalidFormat');
				errorEl.style.display = 'block';
				creatorAliasInput.style.borderColor = '#c6209d';
				return false;
			}

			errorEl.style.display = 'none';
			creatorAliasInput.style.borderColor = 'rgba(255,255,255,0.2)';
			return true;
		};

		const validateJoinAlias = () => {
			if (isAuthenticated) return true;

			const errorEl = document.getElementById('join-alias-error');
			if (!errorEl) return true;

			const value = joinAliasInput?.value?.trim();
			if (value && !this.svc.isValidAlias(value)) {
				errorEl.textContent = i18n.t('tournament.validation.aliasInvalidFormat');
				errorEl.style.display = 'block';
				joinAliasInput.style.borderColor = '#c6209d';
				return false;
			}

			errorEl.style.display = 'none';
			joinAliasInput.style.borderColor = 'rgba(255,255,255,0.2)';
			return true;
		};

		nameInput.addEventListener('input', validateTournamentName);
		nameInput.addEventListener('blur', validateTournamentName);

		if (!isAuthenticated) {
			creatorAliasInput.addEventListener('input', validateCreatorAlias);
			creatorAliasInput.addEventListener('blur', validateCreatorAlias);
			if (joinAliasInput) {
				joinAliasInput.addEventListener('input', validateJoinAlias);
				joinAliasInput.addEventListener('blur', validateJoinAlias);
			}
		}

		const handleCreate = async () => {
			if (createBtn.disabled) return;

			try {
				const name = nameInput.value.trim();
				const creatorAlias = creatorAliasInput.value.trim();

				if (!validateTournamentName() || !validateCreatorAlias()) {
					return;
				}

				const validationError = this.svc.getValidationError(name, creatorAlias);
				if (validationError) {
					ui.showErrorPopup(validationError);
					return;
				}

				createBtn.disabled = true;
				createBtn.textContent = i18n.t('tournament.ui.create.creating');

				const userId = isAuthenticated ? currentUser.id : undefined;
				await this.svc.createTournament(name, creatorAlias, userId);

				console.log('[TournamentBinder] Tournament created, immediate re-render');

				// Envoyer un message d'invitation au chat global
				console.log('[TournamentBinder] wsService:', !!this.wsService, 'tournamentId:', this.svc.currentTournamentId);
				if (this.wsService && this.svc.currentTournamentId) {
					const username = isAuthenticated ? currentUser.username : creatorAlias;
					this.wsService.sendMessage({
						type: 'chat:global_message',
						data: {
							content: `🏆 ${username}`,
							messageType: 'tournament_invite',
							metadata: JSON.stringify({
								tournament_id: this.svc.currentTournamentId,
								tournament_name: name
							})
						}
					});
					console.log('[TournamentBinder] Tournament invitation sent to global chat');
				} else {
					console.warn('[TournamentBinder] Cannot send invitation - wsService:', !!this.wsService, 'tournamentId:', this.svc.currentTournamentId);
				}

				this.renderAndBind();

			} catch (error: any) {
				console.error('[TournamentBinder] Error creating tournament:', error);
				ui.showErrorPopup(error.message || i18n.t('tournament.error.failedCreate'));
			} finally {
				createBtn.disabled = false;
				createBtn.textContent = i18n.t('tournament.ui.create.button');
			}
		};

		const handleList = async () => {
			try {
				const tournaments = await this.svc.listTournaments();
				const listDiv = document.getElementById('tournaments-list');
				const container = document.getElementById('tournaments-container');

				if (!listDiv || !container) return;

				if (tournaments.length === 0) {
					container.innerHTML = `<div style="opacity:.6;font-size:.9rem;padding:.5rem;">${i18n.t('tournament.ui.list.empty')}</div>`;
				} else {
					container.innerHTML = tournaments.slice(0, 10).map((t: any) => `
            <div class="tournament-item" data-tournament-id="${t.id}" style="padding:.75rem;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:.5rem;cursor:pointer;border:1px solid rgba(255,255,255,0.1);transition:all 0.2s;">
              <div style="font-size:.9rem;font-weight:600;">${t.name}</div>
              <div style="font-size:.8rem;opacity:.7;margin-top:.25rem;">
								${i18n.t('tournament.ui.list.playersCount').replace('{count}', String(t.current_players || 0))}
								${t.status === 'waiting' ? '• <span style="color:#0ea5e9;">' + i18n.t('tournament.ui.list.status.open') + '</span>' : '• <span style="color:#ffffff;">' + i18n.t('tournament.ui.list.status.inProgress') + '</span>'}
              </div>
              <button class="join-tournament-btn" data-tournament-id="${t.id}" style="margin-top:.5rem;width:100%;padding:.5rem;background:#064c48ff;color:white;border:none;border-radius:4px;cursor:pointer;font-size:.8rem;">
								${i18n.t('tournament.ui.list.joinButton')}
              </button>
            </div>
          `).join('');

					container.querySelectorAll('.join-tournament-btn').forEach(btn => {
						btn.addEventListener('click', (e) => {
							e.stopPropagation();
							const tournamentId = parseInt((e.target as HTMLElement).getAttribute('data-tournament-id') || '0');
							if (tournamentId > 0) {
								this.handleJoinTournament(tournamentId, joinAliasInput, ui);
							}
						});
					});

					container.querySelectorAll('.tournament-item').forEach(item => {
						item.addEventListener('mouseenter', () => {
							(item as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
						});
						item.addEventListener('mouseleave', () => {
							(item as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
						});
					});
				}

				listDiv.style.display = listDiv.style.display === 'none' ? 'block' : 'none';

			} catch (error) {
				console.error('[TournamentBinder] Error listing tournaments:', error);
				ui.showErrorPopup(i18n.t('tournament.error.failedLoadList'));
			}
		};

		const handleHistory = async () => {
			try {
				const userId = isAuthenticated ? currentUser.id : undefined;
				const alias = !isAuthenticated && joinAliasInput ? joinAliasInput.value.trim() : undefined;

				console.log('[TournamentBinder] [HISTORY] Loading history', { userId, alias });

				const history = await this.svc.getTournamentHistory(userId, alias, 20);
				const historyDiv = document.getElementById('history-list');
				const container = document.getElementById('history-container');

				if (!historyDiv || !container) return;

				if (history.length === 0) {
					container.innerHTML = `<div style=\"opacity:.6;font-size:.9rem;padding:.5rem;\">${i18n.t('tournament.ui.history.empty')}</div>`;
				} else {
					container.innerHTML = history.map((entry: TournamentHistoryEntry) => {
						const date = new Date(entry.createdAt);
						const formattedDate = date.toLocaleDateString('en-US', {
							year: 'numeric',
							month: 'short',
							day: 'numeric'
						});

						const statusColor = entry.status === 'finished' ? '#7e89f2ff' : '#c6209d';
						const statusText = entry.status === 'finished' ? i18n.t('tournament.ui.history.completed') : i18n.t('tournament.ui.history.cancelled');

						return `
              <div style="padding:.75rem;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:.5rem;border-left:3px solid ${statusColor};">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.5rem;">
                  <div style="font-size:.9rem;font-weight:600;">${entry.name}</div>
                  <div style="font-size:.75rem;opacity:.7;">${formattedDate}</div>
                </div>
                <div style="font-size:.8rem;opacity:.8;margin-bottom:.25rem;">
                  ${entry.winner ?
							`<span style=\"color:#ffd700;\"><span class=\"material-symbols-outlined\" style=\"font-size:.9rem;vertical-align:middle;\">emoji_events</span> ${i18n.t('tournament.ui.finished.complete.winner').replace('{name}', entry.winner.alias)}</span>` :
							`<span style=\"color:${statusColor};\">${statusText}</span>`
						}
                </div>
                  <div style="font-size:.75rem;opacity:.6;">
                    Status: <span style="color:${statusColor};font-weight:900;">${statusText}</span>
                  </div>
              </div>
            `;
					}).join('');
				}

				historyDiv.style.display = historyDiv.style.display === 'none' ? 'block' : 'none';

			} catch (error) {
				console.error('[TournamentBinder] [HISTORY] Error loading history:', error);
				ui.showErrorPopup(i18n.t('tournament.error.failedLoadHistory'));
			}
		};

		createBtn.addEventListener('click', handleCreate);
		if (listBtn) listBtn.addEventListener('click', handleList);
		if (historyBtn) historyBtn.addEventListener('click', handleHistory);

		(window as any).tournamentBinder = {
			joinTournament: (tournamentId: number) => this.handleJoinTournament(tournamentId, joinAliasInput, ui)
		};
	}

	/* Attache les gestionnaires d'événements pour l'interface de matchmaking */
	private bindMatchmakingActions(): void {
		const ui = new UIUtils();
		const leaveBtn = document.getElementById('btn-leave-tournament') as HTMLButtonElement;

		console.debug('[TournamentBinder] bindMatchmakingActions - Elements found:', {
			leaveBtn: !!leaveBtn
		});

		const handleLeaveTournament = async () => {
			try {
				const confirmed = await this.confirmLeaveTournament();
				if (confirmed) {
					await this.svc.leaveTournament();
					this.renderAndBind();
				}
			} catch (error: any) {
				console.error('[TournamentBinder] Error leaving tournament:', error);
				ui.showErrorPopup(error.message || i18n.t('tournament.error.failedLeave'));
			}
		};

		if (leaveBtn) {
			leaveBtn.addEventListener('click', handleLeaveTournament);
			console.debug('[TournamentBinder] Leave button bound');
		}

		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}

		this.refreshInterval = window.setInterval(() => {
			document.querySelectorAll<HTMLElement>('[data-countdown][data-deadline]').forEach(el => {
				const dl = el.getAttribute('data-deadline') || '';
				const target = new Date(dl.replace(' ', 'T') + 'Z').getTime();
				const now = Date.now();
				const ms = Math.max(0, target - now);
				const sec = Math.floor(ms / 1000);
				const s = String(sec % 60).padStart(2, '0');
				const m = String(Math.floor(sec / 60)).padStart(2, '0');
				el.textContent = `${m}:${s}`;

				if (ms === 0) {
					if (el.getAttribute('data-fired') === '1') return;
					el.setAttribute('data-fired', '1');
					console.log('[TournamentBinder] ⏱️ Countdown reached 0 - waiting for server to start the match');

					try {
						const ctx = el.closest('.match-ctx') as HTMLElement | null;
						const msg = ctx?.querySelector('[data-ready-msg]') as HTMLElement | null;
						if (ctx) {
							ctx.style.background = 'transparent';
						}
						if (msg && msg.getAttribute('data-state') !== 'loading') {
							msg.textContent = i18n.t('tournament.ui.countdown.loading');
							msg.setAttribute('data-state', 'loading');
							msg.setAttribute('style', [
								'font-size:0.85rem',
								'background:transparent',
								'color:#60a5fa',
								'padding:.15rem .5rem',
								'border-radius:4px',
								'font-weight:600'
							].join(';'));
						}
					} catch {}
				}
			});
		}, 200);

		document.querySelectorAll<HTMLElement>('[data-action="ready"][data-match-id]').forEach(btn => {
			btn.addEventListener('click', async (e) => {
				const el = e.currentTarget as HTMLElement;
				const id = Number(el.getAttribute('data-match-id') || '0');
				if (!id) return;
				el.setAttribute('disabled', 'true');
				try {
					await this.svc.markReady(id);
					this.renderAndBind();
				} catch (err: any) {
					el.removeAttribute('disabled');
					(window as any).pongApp?.uiUtils?.showErrorPopup?.(err?.message || i18n.t('tournament.ui.markReady.failed'));
				}
			}, { once: true });
		});
	}

	/* Attache les gestionnaires d'événements pour l'écran de tournoi terminé */
	private bindFinishedActions(): void {
		const ui = new UIUtils();
		const quitBtn = document.getElementById('btn-quit-tournament') as HTMLButtonElement;

		console.debug('[TournamentBinder] bindFinishedActions - Elements found:', {
			quitBtn: !!quitBtn
		});

		const handleQuitTournament = async () => {
			if (!quitBtn) return;

			try {
				quitBtn.disabled = true;
				quitBtn.textContent = i18n.t('tournament.ui.quit.quitting');

				console.log('[TournamentBinder] [QUIT] Quit button clicked');

				await this.svc.quitTournament();

				console.log('[TournamentBinder] [QUIT] Tournament quit successfully, navigating to /tournament');

				const pongApp = (window as any)?.pongApp;
				if (pongApp?.navigate) {
					pongApp.navigate('/tournament');
				} else {
					this.renderAndBind();
				}

			} catch (error: any) {
				console.error('[TournamentBinder] [QUIT] Error quitting tournament:', error);
				ui.showErrorPopup(error.message || i18n.t('tournament.error.failedQuit'));
			} finally {
				if (quitBtn) {
					quitBtn.disabled = false;
					quitBtn.textContent = i18n.t('tournament.ui.quit.button');
				}
			}
		};

		if (quitBtn) {
			quitBtn.addEventListener('click', handleQuitTournament);
			console.debug('[TournamentBinder] [QUIT] Quit button bound successfully');
		}
	}

	/* Attache les gestionnaires d'événements pour l'écran d'attente */
	private bindWaitingActions(): void {
		const ui = new UIUtils();
		const leaveBtn = document.getElementById('btn-leave-tournament') as HTMLButtonElement;
		const startBtn = document.getElementById('btn-start-tournament') as HTMLButtonElement;

		console.debug('[TournamentBinder] bindWaitingActions - Elements found:', {
			leaveBtn: !!leaveBtn,
			startBtn: !!startBtn
		});

		const handleStartTournament = async () => {
			if (!startBtn) return;

			console.log('[TournamentBinder] Start tournament button clicked');

			try {
				startBtn.disabled = true;
				startBtn.textContent = i18n.t('tournament.ui.start.starting');

				await this.svc.startTournamentAsOwner();
				console.log('[TournamentBinder] Tournament started successfully, re-rendering');
				this.renderAndBind();
			} catch (error: any) {
				console.error('[TournamentBinder] Error starting tournament:', error);
				ui.showErrorPopup(error.message || i18n.t('tournament.error.failedStart'));
			} finally {
				if (startBtn) {
					startBtn.disabled = false;
					startBtn.textContent = i18n.t('tournament.ui.status.start.button');
				}
			}
		};

		const handleLeaveTournament = async () => {
			try {
				const confirmed = await this.confirmLeaveTournament();
				if (confirmed) {
					await this.svc.leaveTournament();
					this.renderAndBind();
				}
			} catch (error: any) {
				console.error('[TournamentBinder] Error leaving tournament:', error);
				ui.showErrorPopup(error.message || i18n.t('tournament.error.failedLeave'));
			}
		};

		if (leaveBtn) {
			leaveBtn.addEventListener('click', handleLeaveTournament);
			console.debug('[TournamentBinder] Leave button bound');
		}

		if (startBtn) {
			startBtn.addEventListener('click', handleStartTournament);
			console.debug('[TournamentBinder] Start tournament button bound successfully');
		} else {
			console.debug('[TournamentBinder] No start tournament button found (normal if not owner or not ready)');
		}
	}

	/* Attache les gestionnaires pour l'écran d'attente de match (aucune action requise) */
	private bindWaitingForMatchActions(): void {
		console.debug('[TournamentBinder] Waiting screen bound (no actions needed)');
	}

	/* Gère la jointure d'un tournoi avec validation de l'alias */
	private async handleJoinTournament(tournamentId: number, joinAliasInput: HTMLInputElement | null, ui: UIUtils): Promise<void> {
		try {
			const currentUser = this.getCurrentUser?.() || null;
			const isAuthenticated = !!currentUser?.id;

			const alias = joinAliasInput?.value?.trim();
			if (!alias) {
				ui.showErrorPopup(i18n.t('tournament.validation.pleaseEnterAlias'));
				return;
			}

			if (!isAuthenticated && !this.svc.isValidAlias(alias)) {
				ui.showErrorPopup(i18n.t('tournament.validation.aliasInvalidFormat'));
				return;
			}

			if (this.svc.getCurrentTournamentId()) {
				ui.showErrorPopup(i18n.t('tournament.validation.alreadyInTournament'));
				return;
			}

			const userId = isAuthenticated ? currentUser.id : undefined;
			await this.svc.joinTournament(tournamentId, alias, userId);

			console.log('[TournamentBinder] Tournament joined, immediate re-render');
			this.renderAndBind();

		} catch (error: any) {
			ui.showErrorPopup(error.message || i18n.t('tournament.error.failedJoin'));
		}
	}

	/* Attache les gestionnaires d'événements pour reporter les résultats de match */
	private bindMatchActions(): void {
		const ui = new UIUtils();
		const winnerP1Btn = document.getElementById('btn-winner-p1') as HTMLButtonElement;
		const winnerP2Btn = document.getElementById('btn-winner-p2') as HTMLButtonElement;
		const scoreP1Input = document.getElementById('score-p1') as HTMLInputElement;
		const scoreP2Input = document.getElementById('score-p2') as HTMLInputElement;

		const handleWinner = async (winnerPlayerNumber: 1 | 2) => {
			try {
				if (!this.svc.canReportMatch()) {
					ui.showErrorPopup(i18n.t('tournament.error.cannotReport'));
					return;
				}

				let score1: number | undefined;
				let score2: number | undefined;

				if (scoreP1Input?.value) {
					score1 = parseInt(scoreP1Input.value);
					if (isNaN(score1) || score1 < 0 || score1 > 50) {
						ui.showErrorPopup(i18n.t('tournament.ui.validation.scoreP1Range'));
						return;
					}
				}

				if (scoreP2Input?.value) {
					score2 = parseInt(scoreP2Input.value);
					if (isNaN(score2) || score2 < 0 || score2 > 50) {
						ui.showErrorPopup(i18n.t('tournament.ui.validation.scoreP2Range'));
						return;
					}
				}

				if (score1 !== undefined && score2 !== undefined) {
					if (winnerPlayerNumber === 1 && score1 <= score2) {
						ui.showErrorPopup(i18n.t('tournament.ui.validation.winnerHigher'));
						return;
					}
					if (winnerPlayerNumber === 2 && score2 <= score1) {
						ui.showErrorPopup(i18n.t('tournament.ui.validation.winnerHigher'));
						return;
					}
				}

				const currentMatch = this.svc.getCurrentMatch();
				if (!currentMatch) {
					ui.showErrorPopup(i18n.t('tournament.error.noCurrentMatch'));
					return;
				}

				const mockMatchId = 1;

				await this.svc.reportMatchResult(mockMatchId, winnerPlayerNumber, score1, score2);
				this.renderAndBind();

			} catch (error: any) {
				console.error('[TournamentBinder] Error reporting winner:', error);
				ui.showErrorPopup(error.message || i18n.t('tournament.ui.report.failedReport'));
			}
		};

		if (winnerP1Btn) {
			winnerP1Btn.addEventListener('click', () => handleWinner(1));
		}

		if (winnerP2Btn) {
			winnerP2Btn.addEventListener('click', () => handleWinner(2));
		}
	}

	/* Démarre le rafraîchissement automatique (désactivé au profit de WebSocket) */
	private startAutoRefresh(): void {
		console.log('[TournamentBinder] Auto-refresh DISABLED - using WebSocket sync');
	}

	/* Arrête le rafraîchissement automatique et nettoie le timer */
	private stopAutoRefresh(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = null;
			console.log('[TournamentBinder] Auto-refresh stopped');
		}
	}

	/* Retourne le nombre de rendus effectués */
	public getRenderCount(): number {
		return this.renderCount;
	}

	/* Retourne le hash du dernier état rendu */
	public getLastRenderState(): string {
		return this.lastRenderState;
	}

	/* Nettoie les ressources et arrête les timers actifs */
	public cleanup(): void {
		console.log('[TournamentBinder] Cleanup called - stopping auto-refresh');
		this.stopAutoRefresh();
		this.showWaitingAnimation = false;
		try {
			delete (window as any).tournamentBinder;
		} catch { }
	}
}

export default { TournamentBinder };
