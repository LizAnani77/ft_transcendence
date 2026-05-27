import { WebSocketService } from '../services/WebSocketService';
import { GameEngine } from '../game/GameEngine';
import { GameRenderer } from './GameRenderer';
import { UIUtils } from './UIUtils';
import { i18n } from './I18n';

export class RemoteGameController {
  private remoteGameId: string | null = null;
  private mySide: 'left' | 'right' | null = null;
  private keyHold = { up: false, down: false };
  private boundKeyHandlers = false;
  private keydownHandler?: (e: KeyboardEvent) => void;
  private keyupHandler?: (e: KeyboardEvent) => void;
  private escBound = false;
  private escHandler?: (e: KeyboardEvent) => void;

  /* Métadonnées du match de tournoi en cours */
  private currentTournamentId: number | null = null;
  private currentMatchId: number | null = null;

  /* Flag pour indiquer qu'une redirection tournoi est en cours */
  private tournamentRedirectPending: boolean = false;
  private gameFinished: boolean = false;
  private postGameRedirectTimer: number | null = null;
  private postGameOverlay: HTMLElement | null = null;

  /* Initialise le contrôleur de jeu distant avec les services nécessaires */
  constructor(
    private ws: WebSocketService,
    private engine: GameEngine,
    private renderer: GameRenderer,
    private ui: UIUtils,
    private goHome: () => void
  ) {}

  /* Enregistre un message de log avec préfixe [RGC] */
  private log(...args: any[]) { try { console.log('[RGC]', ...args); } catch {} }
  /* Enregistre un avertissement avec préfixe [RGC] */
  private warn(...args: any[]) { try { console.warn('[RGC]', ...args); } catch {} }
  /* Enregistre une note publique dans les logs */
  public  logNote(msg: string) { this.log(msg); }

  /* Configure les métadonnées d'un match de tournoi */
  public setTournamentMatchInfo(tournamentId: number, matchId: number): void {
    this.currentTournamentId = tournamentId;
    this.currentMatchId = matchId;
    this.tournamentRedirectPending = false; // Reset du flag
    this.clearPostGameRedirectTimer();
    this.gameFinished = false;
    console.log('[RGC] 🏆 Tournament match info set:', {
      tournamentId,
      matchId
    });
  }

  /* Nettoie les métadonnées du tournoi */
  public clearTournamentMatchInfo(): void {
    console.log('[RGC] Clearing tournament match info');
    this.currentTournamentId = null;
    this.currentMatchId = null;
    this.tournamentRedirectPending = false; // Reset du flag
  }

  /* Vérifie si le match actuel est un match de tournoi */
  public isTournamentMatch(): boolean {
    const isTournament = this.currentTournamentId !== null && this.currentMatchId !== null;
    console.log('[RGC] isTournamentMatch check:', {
      currentTournamentId: this.currentTournamentId,
      currentMatchId: this.currentMatchId,
      result: isTournament
    });
    return isTournament;
  }

  /* Indique si un match de tournoi est en cours (non terminé) côté client */
  public isActiveTournamentGame(): boolean {
    return this.isTournamentMatch() && !this.gameFinished;
  }

  /* Retourne les infos du tournoi */
  public getTournamentMatchInfo(): { tournamentId: number; matchId: number } | null {
    if (this.currentTournamentId !== null && this.currentMatchId !== null) {
      return {
        tournamentId: this.currentTournamentId,
        matchId: this.currentMatchId
      };
    }
    return null;
  }

  /* Marque qu'une redirection tournoi est en cours */
  public markTournamentRedirectPending(): void {
    this.tournamentRedirectPending = true;
    console.log('[RGC] 🏆 Tournament redirect marked as PENDING');
  }

  private clearPostGameRedirectTimer(): void {
    if (this.postGameRedirectTimer !== null) {
      clearTimeout(this.postGameRedirectTimer);
      this.postGameRedirectTimer = null;
    }
    this.hidePostGameOverlay();
  }

  /* Synchronise l'état et détermine mon côté (gauche/droite) */
  public handleGameSync(msg: any, currentViewGetter: () => string): void {
    const gs = (msg?.data?.gameState ?? msg?.data) || null; 
    if (!gs) return;
    
    console.log('[RGC] handleGameSync', { 
      gameId: gs.gameId, 
      view: currentViewGetter?.(),
      isTournamentMatch: this.isTournamentMatch()
    });

    this.renderer.resetGameEndData();
    this.remoteGameId = gs.gameId || this.remoteGameId;
    this.clearPostGameRedirectTimer();
    this.gameFinished = gs.gameStatus === 'finished';

    const p1 = gs.players?.player1?.id, p2 = gs.players?.player2?.id;
    
    // Récupérer le userId en priorité depuis sessionStorage pour les guests
    let meId = (window as any)?.pongApp?.authService?.getCurrentUser?.()?.id;
    
    // Si authService ne retourne pas d'ID (cas guest), vérifier sessionStorage
    if (!meId || !Number.isFinite(Number(meId))) {
      const guestUserId = sessionStorage.getItem('guest_user_id');
      if (guestUserId) {
        meId = Number(guestUserId);
        console.log('[RGC] ✅ Using guest userId from sessionStorage:', meId);
      }
    }
    
    // Convertir en number si c'est une string
    if (typeof meId === 'string') {
      meId = parseInt(meId, 10);
    }
    
    if (!Number.isFinite(meId) || (typeof p1 !== 'number' && typeof p2 !== 'number')) {
      this.warn('handleGameSync: invalid players or meId', { meId, p1, p2 });
      return;
    }
    this.mySide = meId === p1 ? 'left' : (meId === p2 ? 'right' : null);
    console.log('[RGC] handleGameSync: mySide resolved', { mySide: this.mySide });

    this.updateControlsText(gs);
    this.bindRemoteControls();
    if (currentViewGetter() === 'game') this.renderer.renderFromServerState(gs);
  }

  /* Ne PAS rediriger si redirection tournoi en cours */
  public async handleOpponentLeft(): Promise<void> {
    this.warn('[RGC] handleOpponentLeft: opponent disconnected');

    // Vérifier d'abord si une redirection tournoi est en cours
    if (this.tournamentRedirectPending) {
      console.log('[RGC] 🏆 Tournament redirect pending - IGNORING opponent left');
      return;
    }

    // Si c'est un match de tournoi ET pas de redirection en cours, NE PAS rediriger
    if (this.isTournamentMatch()) {
      console.log('[RGC] 🏆 Tournament match - opponent disconnected, staying on page');
      this.ui.showErrorPopup('Opponent disconnected. Tournament system will handle this...');
      return;
    }

    // Match 1v1 normal : redirection vers home
    console.log('[RGC] ⚔️ 1v1 match - opponent left, returning home');
    try { (this.engine as any)?.reset?.(); } catch {}
    this.unbindRemoteControls();
    this.clearTournamentMatchInfo();
    this.ui.showErrorPopup('Opponent left the game.');
    this.clearPostGameRedirectTimer();
    setTimeout(() => {
      this.goHome();
    }, 2000);
  }

  /* Ne PAS rediriger si redirection tournoi en cours */
  public async handleYouLeft(): Promise<void> {
    console.log('[RGC] handleYouLeft: you left the game');

    // Vérifier d'abord si une redirection tournoi est en cours
    if (this.tournamentRedirectPending) {
      console.log('[RGC] 🏆 Tournament redirect pending - IGNORING you left');
      return;
    }

    // Si c'est un match de tournoi, BLOQUER la sortie
    if (this.isTournamentMatch()) {
      console.log('[RGC] 🏆 Tournament match - manual leave blocked');
      this.ui.showErrorPopup('Cannot leave during tournament match');
      return;
    }

    // Match 1v1 normal : redirection vers home
    console.log('[RGC] ⚔️ 1v1 match - you left, returning home');
    try { (this.engine as any)?.reset?.(); } catch {}
    this.unbindRemoteControls();
    this.clearTournamentMatchInfo();
    this.clearPostGameRedirectTimer();
    this.goHome();
  }

  /* Ne PAS rediriger si redirection tournoi en cours */
  public handleGameCancelled(message: string): void {
    this.warn('[RGC] handleGameCancelled CALLED', { 
      message, 
      isTournamentMatch: this.isTournamentMatch(),
      redirectPending: this.tournamentRedirectPending
    });

    // Vérifier d'abord si une redirection tournoi est en cours
    if (this.tournamentRedirectPending) {
      console.log('[RGC] 🏆 Tournament redirect pending - IGNORING game cancelled');
      return;
    }

    this.closeInvitationOverlays();
    try { (this.engine as any)?.reset?.(); } catch {}
    this.unbindRemoteControls(); 
    this.unbindEscape(); 
    this.removeEscHint();
    
    // Si c'est un match de tournoi, NE PAS rediriger
    if (this.isTournamentMatch()) {
      console.log('[RGC] 🏆 Tournament match cancelled - staying on page');
      this.ui.showErrorPopup(message);
      this.clearTournamentMatchInfo();
      return;
    }
    
    // Match 1v1 normal : redirection vers home
    console.log('[RGC] ⚔️ 1v1 match cancelled - returning home');
    this.clearTournamentMatchInfo();
    this.ui.showErrorPopup(message);
    this.clearPostGameRedirectTimer();
    setTimeout(() => {
      this.goHome();
    }, 2000);
  }

  /* Met à jour l'affichage des noms des joueurs et leurs contrôles */
  private updateControlsText(gs: any): void {
    const leftName = gs.players?.player1?.username ?? 'Player 1';
    const rightName = gs.players?.player2?.username ?? 'Player 2';
    const leftEl = document.querySelector<HTMLElement>('[data-player-name="left"]');
    const rightEl = document.querySelector<HTMLElement>('[data-player-name="right"]');
    console.log('[RGC] updateControlsText target', { leftFound: !!leftEl, rightFound: !!rightEl });
    if (leftEl) leftEl.textContent = leftName;
    if (rightEl) rightEl.textContent = rightName;
  }

  /* Installe les listens clavier pour le remote */
  public bindRemoteControls(): void {
    if (this.boundKeyHandlers || !this.remoteGameId || !this.mySide) { 
      console.log('[RGC] bindRemoteControls skipped', { 
        bound: this.boundKeyHandlers, 
        gid: this.remoteGameId, 
        mySide: this.mySide 
      }); 
      return; 
    }

    console.log('[RGC] bindRemoteControls', { 
      gameId: this.remoteGameId, 
      mySide: this.mySide,
      isTournamentMatch: this.isTournamentMatch()
    });
    
    const left = { up: 'w', down: 's' }, right = { up: 'o', down: 'k' };
    const send = (cmd: 'up'|'down'|'stop') => { 
      console.log('[RGC] sendGameInput', { cmd }); 
      this.ws.sendGameInput(this.remoteGameId!, cmd); 
    };

    this.keydownHandler = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();

      // Touche P pour rematch en remote (au lieu de SPACE)
      if (k === 'p') {
        e.preventDefault();
        const gid = this.remoteGameId;
        if (!gid) return;

        if (this.isTournamentMatch()) {
          console.log('[RGC] 🏆 Tournament match - rematch shortcut disabled');
          return;
        }

        if (this.gameFinished) {
          console.log('[RGC] ⚔️ Rematch shortcut ignored - game already finished');
          return;
        }

        console.log('[RGC] keydown P → game:start (rematch)', { gid });
        this.ws.sendMessage({ type:'game:start', data:{ gameId: gid } });
        return;
      }

      // SPACE bloqué complètement en remote
      if (e.code === 'Space' || k === ' ') {
        e.preventDefault();
        console.log('[RGC] SPACE blocked in remote mode - use P for rematch');
        return;
      }

      // Quitter - BLOQUER si tournoi OU si redirection en cours
      if (e.key === 'Escape') {
        e.preventDefault();
        
        // Bloquer si redirection tournoi en cours
        if (this.tournamentRedirectPending) {
          console.log('[RGC] 🏆 Tournament redirect pending - ESC blocked');
          return;
        }
        
        const gid = this.remoteGameId;
        this.warn('[RGC] keydown Escape → attempt to leave', { 
          gid, 
          isTournament: this.isTournamentMatch() 
        });
        
        // BLOQUER la sortie si match de tournoi
        if (this.isTournamentMatch()) {
          console.log('[RGC] 🏆 Tournament match - ESC blocked');
          this.ui.showErrorPopup('Cannot leave during tournament match. Please wait for automatic redirect.');
          return;
        }
        
        // Match 1v1 normal : autoriser la sortie
        console.log('[RGC] ⚔️ 1v1 match - ESC pressed, leaving game');
        try {
          if (gid) this.ws.leaveRemoteGame();
        } finally {
          this.unbindRemoteControls(false);
          this.clearTournamentMatchInfo();
          this.ui.showErrorPopup('You left the game.');
          this.clearPostGameRedirectTimer();
          this.goHome();
        }
        return;
      }

      // Contrôles
      const keys = this.mySide === 'left' ? left : right;
      if (k === keys.up   && !this.keyHold.up)   { this.keyHold.up = true; send('up'); }
      if (k === keys.down && !this.keyHold.down) { this.keyHold.down = true; send('down'); }
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const upRel   = (this.mySide === 'left'  && k === 'w') || (this.mySide === 'right' && k === 'o');
      const downRel = (this.mySide === 'left'  && k === 's') || (this.mySide === 'right' && k === 'k');
      if (upRel) this.keyHold.up = false; if (downRel) this.keyHold.down = false;
      console.log('[RGC] keyup', { up: this.keyHold.up, down: this.keyHold.down });
      if (!this.keyHold.up && !this.keyHold.down) send('stop');
      else if (this.keyHold.up && !this.keyHold.down) send('up');
      else if (this.keyHold.down && !this.keyHold.up) send('down');
    };

    document.addEventListener('keydown', this.keydownHandler);
    document.addEventListener('keyup', this.keyupHandler);
    this.boundKeyHandlers = true;
    console.log('[RGC] bindRemoteControls: listeners attached');
  }

  /* Retire les listens clavier remote (option: notifier serveur) */
  public unbindRemoteControls(notifyServer: boolean = false): void {
    console.log('[RGC] unbindRemoteControls', { 
      notifyServer, 
      bound: this.boundKeyHandlers, 
      gid: this.remoteGameId 
    });
    
    if (!this.boundKeyHandlers && !this.remoteGameId) return;
    
    const gid = this.remoteGameId;
    if (this.keydownHandler) document.removeEventListener('keydown', this.keydownHandler);
    if (this.keyupHandler)   document.removeEventListener('keyup', this.keyupHandler);
    this.boundKeyHandlers = false; 
    this.keyHold.up = this.keyHold.down = false;
    
    if (notifyServer && gid) {
      try { this.ws.leaveRemoteGame(); } catch {}
    }
    
    this.remoteGameId = null; 
    this.mySide = null;
    
    // Nettoyer les métadonnées du tournoi
    this.clearTournamentMatchInfo();
  }

  /* Affiche l'indice ESC et binde la touche pour les matchs 1v1 normaux */
  public showEscHintAndBind(): void {
    console.log('[RGC] showEscHintAndBind called', {
      isTournamentMatch: this.isTournamentMatch(),
      redirectPending: this.tournamentRedirectPending
    });
    
    // Si match de tournoi, NE PAS binder ESC
    // La redirection est automatique via WebSocketBinder
    if (this.isTournamentMatch() || this.tournamentRedirectPending) {
      console.log('[RGC] 🏆 Tournament match - skipping ESC bind (auto-redirect active)');
      return;
    }
    
    // Match 1v1 normal : binder ESC normalement
    console.log('[RGC] ⚔️ 1v1 match - binding ESC');
    this.bindEscapeToHome();
  }

  /* Supprime l'indice ESC (no-op car dessiné dans le canvas) */
  public removeEscHint(): void {
    /* no-op: hint désormais dessiné dans le canvas par GameRenderer */
  }

  /* Vérifie si une partie distante est active */
  public hasActiveRemoteGame(): boolean {
    return !!this.remoteGameId;
  }

  /* Binde la touche Escape pour retourner à l'accueil (sauf tournoi) */
  public bindEscapeToHome(): void {
    // Ne pas binder si match de tournoi OU si redirection en cours
    if (this.isTournamentMatch() || this.tournamentRedirectPending) {
      console.log('[RGC] 🏆 Tournament match or redirect pending - ESC binding blocked');
      return;
    }
    
    if (this.escBound) { 
      console.log('[RGC] bindEscapeToHome skipped (already bound)'); 
      return; 
    }
    
    this.escHandler = (e: KeyboardEvent) => { 
      if (e.key !== 'Escape') return; 
      e.preventDefault(); 
      console.log('[RGC] ESC pressed (bindEscapeToHome) → goHome'); 
      
      this.clearTournamentMatchInfo();
      this.clearPostGameRedirectTimer();
      this.goHome();
    };
    
    document.addEventListener('keydown', this.escHandler); 
    this.escBound = true;
    console.log('[RGC] ⚔️ bindEscapeToHome: listener attached for 1v1 match');
  }

  /* Retire le listener de la touche Escape */
  public unbindEscape(): void {
    if (!this.escBound) { 
      console.log('[RGC] unbindEscape skipped'); 
      return; 
    }
    if (this.escHandler) document.removeEventListener('keydown', this.escHandler);
    this.escBound = false; 
    this.escHandler = undefined;
    console.log('[RGC] unbindEscape: listener removed');
  }

  /* Gère la fin d'une partie distante et lance la redirection appropriée */
  public handleGameFinished(
    isInGameView: boolean,
    summary?: { winner?: { username?: string }; winnerName?: string; score1?: number; score2?: number }
  ): void {
    this.gameFinished = true;

    if (!isInGameView) {
      console.log('[RGC] handleGameFinished skipped (not in game view)');
      return;
    }

    if (this.isTournamentMatch()) {
      console.log('[RGC] 🏆 Tournament match finished - waiting for tournament redirect');
      return;
    }

    if (this.postGameRedirectTimer !== null) {
      console.log('[RGC] handleGameFinished: redirect already scheduled');
      return;
    }

    const winnerName =
      summary?.winner?.username ||
      (typeof summary?.winnerName === 'string' ? summary.winnerName : null);
    this.showPostGameOverlay(winnerName);

    console.log('[RGC] ⚔️ Standard match finished - redirecting to /welcome');
    this.postGameRedirectTimer = window.setTimeout(() => {
      this.postGameRedirectTimer = null;
      this.unbindRemoteControls(false);
      this.hidePostGameOverlay();
      this.goHome();
    }, 3000);
  }

  /* Affiche l'overlay de fin de partie avec animation de redirection */
  private showPostGameOverlay(winnerName: string | null): void {
    try {
      this.hidePostGameOverlay();
      const overlay = document.createElement('div');
      overlay.className = 'remote-postgame-overlay';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(1,4,14,0.88)',
        'backdrop-filter:blur(3px)',
        '-webkit-backdrop-filter:blur(3px)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'z-index:100000',
        'pointer-events:auto'
      ].join(';');

      const styleEl = document.createElement('style');
      styleEl.textContent = `
        @keyframes remotePostGameBar {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes remotePostGamePulse {
          0% { opacity: .45; }
          50% { opacity: 1; }
          100% { opacity: .45; }
        }
      `;
      overlay.appendChild(styleEl);

      const escape = (value: string) =>
        String(value).replace(/[&<>"']/g, (c) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[c] || c));

      const title = winnerName ? i18n.t('game.winShout').replace('{winner}', winnerName) : i18n.t('game.online.matchFinished');
      const card = document.createElement('div');
      card.style.cssText = [
        'background:linear-gradient(120deg,rgba(40,8,30,0.98) 0%,rgba(25,5,20,0.99) 100%)',
        'border:1px solid rgba(198,32,157,0.7)',
        'border-radius:14px',
        'padding:1.15rem 1.3rem',
        'width:min(32vw,480px)',
        'color:#ffffff',
        'text-align:center',
        'box-shadow:0 12px 48px rgba(0,0,0,0.45)',
        "font-family:'Jura',sans-serif"
      ].join(';');

      card.innerHTML = `
        <div style="font-size:.60rem;letter-spacing:.25em;text-transform:uppercase;color:#ffffff;opacity:.75;margin-bottom:.5rem;">
          ${i18n.t('game.online.matchComplete')}
        </div>
        <h3 style="margin:0 0 1.2rem 0;font-size:1.2rem;color:#ffffff;">${escape(title)}</h3>
        <div style="width:100%;height:3px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden;">
          <div style="width:100%;height:100%;background:linear-gradient(90deg,#c6209d,#ff69b4,#ffc4ed);animation:remotePostGameBar 3s ease forwards;"></div>
        </div>
        <div style="margin-top:.75rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.2em;color:#ffffff;animation:remotePostGamePulse 1.6s ease-in-out infinite;">
          ${i18n.t('game.online.redirecting')}
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);
      document.body.setAttribute('data-postgame-overlay', '1');
      this.postGameOverlay = overlay;
    } catch (error) {
      console.error('[RGC] Failed to show post-game overlay:', error);
      this.postGameOverlay = null;
    }
  }

  /* Masque et supprime l'overlay de fin de partie */
  private hidePostGameOverlay(): void {
    if (this.postGameOverlay?.parentElement) {
      try {
        this.postGameOverlay.parentElement.removeChild(this.postGameOverlay);
      } catch (error) {
        console.warn('[RGC] Failed to remove post-game overlay:', error);
      }
    }
    this.postGameOverlay = null;
    try {
      document.body.removeAttribute('data-postgame-overlay');
    } catch {}
  }

  /* Ferme tous les overlays d'invitation en cours */
  private closeInvitationOverlays(): void {
    console.log('[RGC] closeInvitationOverlays: scanning ...');
    for (const id of ['inv-decline','inv-accept','join-decline','join-accept']) {
      const btn = document.getElementById(id); 
      if (!btn) continue;
      const overlay = btn.closest('div')?.parentElement?.parentElement as HTMLElement | null;
      if (overlay?.parentElement) {
        console.log('[RGC] closeInvitationOverlays: removing overlay', { 
          debugId: overlay.getAttribute?.('data-debug-id') 
        });
        try { overlay.parentElement.removeChild(overlay); } catch {}
      }
    }
  }
}
