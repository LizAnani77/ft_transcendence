// frontend/src/core/GameRenderer.ts

/* Rendu du jeu (REMOTE – tournoi & challenge) avec le style LOCAL (typo/filet/overlays identiques) */

import { Navigation } from '../components/Navigation';
import { TournamentState, TournamentMatch } from './interfaces';
import { WebSocketService } from '../services/WebSocketService';
import { UIUtils } from './UIUtils';
import { NeonFrameRenderer } from './NeonFrameRenderer';

export class GameRenderer {
  /* Contexte canvas pour le rendu (remote) */
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  /* Garde-fous */
  private wsBound = false;

  /* UI utils pour les avatars */
  private uiUtils = new UIUtils();

  /* Dernier état serveur connu (pour fallback noms/scores) */
  private lastServerState: {
    gameId: string;
    ball: { x: number; y: number; radius: number };
    paddle1: { x: number; y: number; width: number; height: number; score: number };
    paddle2: { x: number; y: number; width: number; height: number; score: number };
    gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
    players?: {
      player1?: { id: number; username: string; avatar_url?: string; avatarUrl?: string };
      player2?: { id: number; username: string; avatar_url?: string; avatarUrl?: string };
    };
  } | null = null;

  /* Overlay de fin */
  private finalSummary: { winnerName: string; score1: number; score2: number } | null = null;

  /* Rendu – noms affichés côté canvas */
  private lastNameLeft = 'Player 1';
  private lastNameRight = 'Player 2';

  /* Mémoire avatars (persiste entre ticks serveur) */
  private lastAvatars = {
    left:  { username: 'Player 1', avatar_url: '' as string },
    right: { username: 'Player 2', avatar_url: '' as string }
  };

  /* HTML écrit dans les slots joueurs (permet d'éviter les réécritures inutiles) */
  private lastPlayerSlotMarkup = {
    left: '',
    right: ''
  };

  /* Mémo d'avatars connus par pseudo (ex: currentUser) */
  private initialAvatarByUsername: Record<string, string> = {};

  /* Anti-flicker overlay (stabilise l'affichage de WAITING/PAUSED) */
  private lastStatus: 'waiting' | 'playing' | 'paused' | 'finished' | null = null;
  private lastStatusChangeAt = 0;
  private waitingOverlayVisible = false;

  /* Flag UI : sommes-nous dans un écran de tournoi ? (pour le message de fin) */
  private isTournamentUI = false;

  /* Animation du cadre néon */
  private neonFrame = new NeonFrameRenderer({
    speed: 0.35,
    trailLengthRatio: 0.7,
    persistence: 0.97,
    padding: 0
  });

  /* Timer pour la redirection automatique en tournoi */
  private tournamentRedirectTimer: number | null = null;

  /* Métadonnées du match de tournoi (simplifiées - 2 paramètres) */
  private currentTournamentId: number | null = null;
  private currentMatchId: number | null = null;

  /* Réinitialise les données de fin de partie (à appeler au début d'une nouvelle partie) */
  public resetGameEndData(): void { 
    this.finalSummary = null;
    // Nettoie le timer de redirection si il existe
    if (this.tournamentRedirectTimer) {
      clearTimeout(this.tournamentRedirectTimer);
      this.tournamentRedirectTimer = null;
    }
  }

  /* Configure les métadonnées du match de tournoi (seulement 2 paramètres) */
  public setTournamentMatchInfo(tournamentId: number, matchId: number): void {
    this.currentTournamentId = tournamentId;
    this.currentMatchId = matchId;
    this.isTournamentUI = true;
    console.log('[GameRenderer] 🏆 Tournament match info set:', {
      tournamentId,
      matchId
    });
  }

  /* Nettoie les métadonnées du tournoi */
  public clearTournamentMatchInfo(): void {
    console.log('[GameRenderer] Clearing tournament match info:', {
      tournamentId: this.currentTournamentId,
      matchId: this.currentMatchId
    });
    this.currentTournamentId = null;
    this.currentMatchId = null;
    this.isTournamentUI = false;
    
    // Nettoyer aussi le timer de redirection
    if (this.tournamentRedirectTimer) {
      clearTimeout(this.tournamentRedirectTimer);
      this.tournamentRedirectTimer = null;
    }
  }

  /* Vérifie si on est en match de tournoi */
  public isTournamentMatch(): boolean {
    return this.isTournamentUI && this.currentTournamentId !== null && this.currentMatchId !== null;
  }

  /* Affiche l'écran du jeu Pong (match simple ou tournoi) – style aligné LOCAL */
  public renderGame(currentUser: any, currentMatch: TournamentMatch | null): string {
    this.initialAvatarByUsername = {};
    this.isTournamentUI = !!currentMatch;

    const isMatch = !!currentMatch;
    const leftUser = isMatch
      ? { username: currentMatch!.player1, avatar_url: '' }
      : (currentUser ? { username: currentUser.username, avatar_url: currentUser.avatar_url || '' } : { username: 'Player 1', avatar_url: '' });
    const rightUser = isMatch
      ? { username: currentMatch!.player2, avatar_url: '' }
      : { username: 'Player 2', avatar_url: '' };

    if (currentUser?.username) this.initialAvatarByUsername[currentUser.username] = currentUser.avatar_url || '';
    this.lastAvatars.left = leftUser; this.lastAvatars.right = rightUser;

    const responsiveStyles = `
      <style>
        .game-screen-layout { width:100%;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem; }
        .game-screen-layout .players-row { margin-bottom:.75rem; }
        .game-screen-layout canvas { margin-bottom:1rem; }
        .player-controls-chip { display:inline-flex;align-items:center;gap:.3rem;padding:.25rem .55rem;border-radius:999px;font-size:.8rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);backdrop-filter:blur(4px); }
        .player-controls-chip .material-symbols-outlined { font-size:1rem;color:#ffffff; }
        .player-slot-info { display:flex;flex-direction:column;align-items:center;text-align:center;gap:.4rem; }
        .player-slot-info .player-avatar { display:flex;justify-content:center; }
        @media (max-height: 780px) {
          .game-screen-layout { justify-content:flex-start; padding-top:1rem; padding-bottom:1.25rem; }
          .game-screen-layout .players-row { margin-bottom:.35rem; }
          .game-screen-layout canvas { margin-bottom:.5rem; }
        }
      </style>
    `;
    const leftSlotMarkup = this.buildPlayerSlot('left', leftUser);
    const rightSlotMarkup = this.buildPlayerSlot('right', rightUser);
    this.lastPlayerSlotMarkup.left = leftSlotMarkup;
    this.lastPlayerSlotMarkup.right = rightSlotMarkup;

    return `
      ${Navigation.render(currentUser)}
      ${responsiveStyles}
      <div class="game-screen-layout">
        <div style="text-align:center;">
          <h2 style="font-size:1.5rem;margin-bottom:1rem;">${isMatch ? 'Tournament Match' : ''}</h2>
          <!-- Players row (avatars + noms) -->
          <div
            class="players-row"
            style="
              display:grid;
              grid-template-columns:1fr auto 1fr;
              align-items:center;
              gap:1rem;
            "
          >
            <div id="player-left" style="display:flex;align-items:center;gap:.75rem;justify-self:start;">
              ${leftSlotMarkup}
            </div>
            <div id="vs-label" style="opacity:.8;font-size:.85rem;justify-self:center;white-space:nowrap;flex:0 0 auto;">VS</div>
            <div id="player-right" style="display:flex;align-items:center;gap:.75rem;justify-self:end;">
              ${rightSlotMarkup}
            </div>
          </div>
          <canvas id="game-canvas" width="800" height="600" tabindex="0" style="margin-bottom:1rem;background:transparent;outline:none;"></canvas>
          <div>${isMatch ? `<a href="/tournament" data-link="/tournament" style="color:#ffffff;text-decoration:none;font-size:.85rem;margin-right:1rem;">Back to Tournament</a>` : ''}</div>
        </div>
      </div>`;
  }

  /* Prépare et mémorise le canvas (à appeler juste après l'injection HTML) */
  public mountCanvas(): void {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    this.ctx = this.canvas?.getContext('2d') ?? null;

    if (this.canvas && this.ctx) {
      this.neonFrame.attach(this.canvas, this.ctx);
    } else {
      this.neonFrame.detach();
    }

    if (this.ctx && this.canvas) {
      try { this.canvas.focus(); } catch {}
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawNetLocalStyle();
    }
  }

  /* Lie les messages WebSocket liés au jeu pour le rendu remote (une seule fois) */
  public bindWebSocket(ws: WebSocketService): void {
    if (this.wsBound) return; 
    this.wsBound = true;

    ws.onMessage('game:state_update', (msg: any) => {
      const st = msg?.data; if (!st) return;
      if (st.gameStatus === 'finished' && this.finalSummary) return;
      this.renderFromServerState(st);
    });

    ws.onMessage('game:started', (msg: any) => {
      this.resetGameEndData();
      const st = (msg?.data?.gameState ?? msg?.data) || null;
      if (st) this.renderFromServerState(st);
    });

    ws.onMessage('game:joined', (msg: any) => {
      this.resetGameEndData();
      const st = (msg?.data?.gameState ?? msg?.data) || null;
      if (st) this.renderFromServerState(st);
    });

    ws.onMessage('game:finished', (msg: any) => {
      const d = msg?.data; if (!d || !d.gameId) return;
      const st = d.gameState ?? null;
      const s1 = st?.paddle1?.score ?? d.summary?.score1 ?? 0;
      const s2 = st?.paddle2?.score ?? d.summary?.score2 ?? 0;
      const winner = d.summary?.winner?.username
        ?? (s1 >= s2 ? (st?.players?.player1?.username || 'Player 1')
                     : (st?.players?.player2?.username || 'Player 2'));
      this.finalSummary = { winnerName: String(winner), score1: Number(s1), score2: Number(s2) };
      if (st) this.renderFromServerState({ ...st, gameStatus: 'finished' });
    });
  }

  /* Dessine l'overlay de fin avec détection du contexte tournoi */
  private drawFinishedOverlayDetailed(): void {
    if (!this.ctx || !this.canvas) return;
    const s = this.finalSummary;
    const winner = s?.winnerName ?? 'Winner';
    const s1 = s?.score1 ?? 0;
    const s2 = s?.score2 ?? 0;
    const isT = this.isTournamentMatch();

    console.log('[GameRenderer] drawFinishedOverlayDetailed:', {
      isTournamentMatch: isT,
      tournamentId: this.currentTournamentId,
      matchId: this.currentMatchId,
      winner,
      score: `${s1}-${s2}`
    });

    this.ctx.save();
    // Fenêtre de fin transparente : pas de fillRect noir
    this.ctx.fillStyle = '#ffffff'; 
    this.ctx.textAlign = 'center';
    
    // Affichage spécial pour les matchs de tournoi
    if (isT) {
      console.log('[GameRenderer] 🏆 Rendering TOURNAMENT match finished overlay');

      // Nom du gagnant
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 20px Jura';
      this.ctx.fillText(`${winner} WINS!`, this.canvas.width/2, this.canvas.height/2 - 30);

      // Score final
      this.ctx.font = '20px Jura';
      this.ctx.fillText(`${s1} - ${s2}`, this.canvas.width/2, this.canvas.height/2 + 10);

      // Message de redirection
      this.ctx.font = '18px Jura';
      this.ctx.fillText('Returning to tournament in 3 seconds...', this.canvas.width/2, this.canvas.height/2 + 50);

      // PAS de hint ESC pour les matchs de tournoi
      // La redirection est automatique via WebSocketBinder (tournament:match_finished)

    } else {
      // Match normal 1v1 en remote
      console.log('[GameRenderer] ⚔️ Rendering STANDARD 1v1 match finished overlay');
      
      this.ctx.font = '20px Jura'; 
      this.ctx.fillText(`${winner} WINS!`, this.canvas.width/2, this.canvas.height/2 - 50);
      this.ctx.font = '15px Jura'; 
      this.ctx.fillText(`Final Score: ${s1} - ${s2}`, this.canvas.width/2, this.canvas.height/2 - 20);
      this.ctx.font = '20px Jura'; 
      this.ctx.fillStyle = '#ffffff';
      // En remote mode 1v1, utiliser ESC au lieu de SPACE/P
      // this.ctx.fillText('Press ESC to return Home', this.canvas.width/2, this.canvas.height/2 + 25);
      
      // Hint ESC (affiché en bas)
      this.drawEscHint();
    }
    
    this.ctx.restore();
  }

  /* Rendu complet à partir de l'état serveur (autoritaire) – style LOCAL */
  public renderFromServerState(state: {
    gameId: string;
    ball: { x: number; y: number; radius: number };
    paddle1: { x: number; y: number; width: number; height: number; score: number };
    paddle2: { x: number; y: number; width: number; height: number; score: number };
    gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
    players?: { player1?: { id: number; username: string; avatar_url?: string; avatarUrl?: string }; player2?: { id: number; username: string; avatar_url?: string; avatarUrl?: string } };
  }): void {
    if (!this.canvas || !this.ctx) return;
    this.lastServerState = state;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
    let displayStatus = state.gameStatus;
    if (displayStatus === 'paused') {
      displayStatus = 'playing';
      console.log('[GameRenderer] Server sent paused, ignoring completely in remote mode');
    }
    
    if (this.lastStatus !== displayStatus) {
      this.lastStatus = displayStatus;
      this.lastStatusChangeAt = now;
      if (displayStatus !== 'waiting') this.waitingOverlayVisible = false;
    }

    const nameL = state.players?.player1?.username ?? this.lastNameLeft;
    const nameR = state.players?.player2?.username ?? this.lastNameRight;
    this.lastNameLeft = nameL; 
    this.lastNameRight = nameR;

    const serverAvatarL = state.players?.player1?.avatar_url ?? state.players?.player1?.avatarUrl ?? '';
    const serverAvatarR = state.players?.player2?.avatar_url ?? state.players?.player2?.avatarUrl ?? '';
    const a1 = this.resolveAvatar('left', nameL, serverAvatarL);
    const a2 = this.resolveAvatar('right', nameR, serverAvatarR);
    this.lastAvatars.left = { username: nameL, avatar_url: a1 }; 
    this.lastAvatars.right = { username: nameR, avatar_url: a2 };
    this.updatePlayerChips(this.lastAvatars.left, this.lastAvatars.right);

    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    // fond local
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
    ctx.fillRect(0, 0, width, height);
    this.neonFrame.render(now);

    // filet + entités (style local)
    this.drawNetLocalStyle();
    this.drawScoresAndNamesLocal(state.paddle1.score, state.paddle2.score, nameL, nameR);
    this.drawPaddle(state.paddle1.x, state.paddle1.y, state.paddle1.width, state.paddle1.height);
    this.drawPaddle(state.paddle2.x, state.paddle2.y, state.paddle2.width, state.paddle2.height);
    this.drawBall(state.ball.x, state.ball.y, state.ball.radius);

    // Overlays d'état avec détection du contexte tournoi
    if (state.gameStatus === 'finished') {
      if (!this.finalSummary) {
        this.finalSummary = {
          winnerName: state.paddle1.score >= state.paddle2.score ? nameL : nameR,
          score1: state.paddle1.score, 
          score2: state.paddle2.score
        };
      }
      this.drawFinishedOverlayDetailed();
    } 
    // Supprimer complètement le cas 'paused'
    // Le jeu continue en remote quoi qu'il arrive
    else if (state.gameStatus === 'waiting') {
      if (this.waitingOverlayVisible || (now - this.lastStatusChangeAt) >= 250) {
        this.waitingOverlayVisible = true;
        this.drawOverlayLocal('Waiting for opponent...'); // remote : en attente serveur
        
        // ✅ Afficher ESC hint même en waiting (sauf si tournoi)
        if (!this.isTournamentMatch()) {
          this.drawEscHint();
        }
      }
    } else {
      // En jeu : afficher discrètement le hint ESC (sauf si tournoi)
      if (!this.isTournamentMatch()) {
        this.drawEscHint();
      }
    }
  }

  /* Résout l'avatar à afficher pour un côté donné sans "mauvais héritage" */
  private resolveAvatar(side: 'left' | 'right', username: string, serverUrl?: string): string {
    if (serverUrl && serverUrl.trim() !== '') return serverUrl;
    const prev = this.lastAvatars[side]; 
    if (prev && prev.username === username && prev.avatar_url) return prev.avatar_url;
    const known = this.initialAvatarByUsername[username]; 
    if (known) return known;
    return '';
  }

  /* Met à jour la ligne "avatars + noms" au-dessus du canvas */
  private updatePlayerChips(leftUser: { username: string; avatar_url?: string }, rightUser: { username: string; avatar_url?: string }): void {
    const leftEl = document.getElementById('player-left');
    const rightEl = document.getElementById('player-right');
    const nextLeftMarkup = this.buildPlayerSlot('left', leftUser);
    const nextRightMarkup = this.buildPlayerSlot('right', rightUser);

    if (leftEl && nextLeftMarkup !== this.lastPlayerSlotMarkup.left) {
      leftEl.innerHTML = nextLeftMarkup;
      this.lastPlayerSlotMarkup.left = nextLeftMarkup;
    }
    if (rightEl && nextRightMarkup !== this.lastPlayerSlotMarkup.right) {
      rightEl.innerHTML = nextRightMarkup;
      this.lastPlayerSlotMarkup.right = nextRightMarkup;
    }
  }

  private buildPlayerSlot(side: 'left' | 'right', user: { username: string; avatar_url?: string }): string {
    const avatar = this.uiUtils.renderAvatar(user, 60);
    const keys = side === 'left' ? 'W • S' : 'O • K';
    const chip = `
      <span class="player-controls-chip" data-player-chip="${side}">
        <span class="material-symbols-outlined" aria-hidden="true">keyboard</span>
        <span>${keys}</span>
      </span>
    `;
    const slot = `
      <div class="player-slot-info" data-player-side="${side}">
        <span class="player-avatar">${avatar}</span>
        <span class="player-name" data-player-name="${side}">${user.username}</span>
        ${chip}
      </div>
    `;
    return slot;
  }

  /* Exposé public : utilisé par PongApp après login/profile update */
  public syncCurrentUserAvatar(user: any): void {
    if (!user) return;
    const name = user.username;
    const url = user.avatar_url || '';
    if (name) this.initialAvatarByUsername[name] = url;

    if (this.lastServerState) {
      const nameL = this.lastNameLeft;
      const nameR = this.lastNameRight;
      const serverAvatarL = this.lastServerState.players?.player1?.avatar_url ?? this.lastServerState.players?.player1?.avatarUrl ?? '';
      const serverAvatarR = this.lastServerState.players?.player2?.avatar_url ?? this.lastServerState.players?.player2?.avatarUrl ?? '';
      const a1 = this.resolveAvatar('left', nameL, serverAvatarL);
      const a2 = this.resolveAvatar('right', nameR, serverAvatarR);
      this.lastAvatars.left = { username: nameL, avatar_url: a1 }; 
      this.lastAvatars.right = { username: nameR, avatar_url: a2 };
      this.updatePlayerChips(this.lastAvatars.left, this.lastAvatars.right);
    }
  }

  /* Dessine le filet central façon LOCAL */
  private drawNetLocalStyle(): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([5, 15]); // local
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(this.canvas.width / 2, 0);
    ctx.lineTo(this.canvas.width / 2, this.canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* Dessine un paddle blanc. */
  private drawPaddle(x: number, y: number, w: number, h: number): void {
    if (!this.ctx) return; 
    this.ctx.fillStyle = '#fff'; 
    this.ctx.fillRect(x, y, w, h);
  }

  /* Dessine la balle. */
  private drawBall(x: number, y: number, r: number): void {
    if (!this.ctx) return; 
    this.ctx.fillStyle = '#fff'; 
    this.ctx.beginPath(); 
    this.ctx.arc(x, y, r, 0, Math.PI*2); 
    this.ctx.fill();
  }

  /* Dessine scores & noms façon LOCAL (positions fixes 200/600, Jura) */
  private drawScoresAndNamesLocal(score1: number, score2: number, name1: string, name2: string): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#fff'; 
    ctx.textAlign = 'center';
    ctx.font = '600 20px Jura'; 
    ctx.fillText(String(score1), 200, 60); 
    ctx.fillText(String(score2), 600, 60);
  }

  /* Dessine un overlay façon LOCAL (texte principal + sous-texte éventuel) */
  private drawOverlayLocal(main: string, sub?: string): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    ctx.fillStyle = '#fff'; 
    ctx.textAlign = 'center';
    ctx.font = '20px Jura';
    if (sub) {
      ctx.fillText(main, this.canvas.width/2, this.canvas.height/2 - 20);
      ctx.fillText(sub,  this.canvas.width/2, this.canvas.height/2 + 20);
    } else {
      ctx.fillText(main, this.canvas.width/2, this.canvas.height/2);
    }
    ctx.restore();
  }

  /* Petit hint "ESC → Home" dessiné dans le canvas (pas pour les matchs de tournoi) */
  private drawEscHint(): void {
    if (!this.ctx || !this.canvas) return;
    
    // Ne pas afficher le hint ESC si c'est un match de tournoi
    if (this.isTournamentMatch()) {
      return;
    }
    
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '20px Jura';
    ctx.restore();
  }

  /* Tournoi (UI finale uniquement) – pas de setup ni de bracket local */

  public renderTournament(currentUser: any, tournamentState: TournamentState): string {
    const inner = tournamentState.champion
      ? this.renderTournamentComplete(tournamentState)
      : `
        <div class="main-content" style="max-width:560px;margin:0 auto;padding:2rem;text-align:center;margin-left:-125px;">
          <h1 style="margin-bottom:1.5rem;font-size:1.5rem;">Tournament</h1>
          <p style="opacity:.8">Tournament is in progress. You'll be redirected automatically when it finishes.</p>
        </div>`;
    return `<div style="background-color:transparent;color:#ffffff;min-height:100vh;">${Navigation.render(currentUser)}${inner}</div>`;
  }

  public renderTournamentComplete(tournamentState: TournamentState): string {
    const completedMatches = tournamentState.matches.filter(m => m.played);
    return `
      <div style="max-width:300px;margin:0 auto;padding:2rem;text-align:center;margin-left:-125px;">
        <div style="height:5rem;"></div>
        <div style="background:#064c48ff;border-radius:8px;padding:1.5rem;margin-bottom:2rem;">
          <h2 style="font-size:1rem;margin-bottom:.5rem;color:white;">WINNER</h2>
          <div style="font-size:1rem;color:#ffffff;margin-bottom:1rem;">${tournamentState.champion}</div>
          <p style="color:rgba(255,255,255,1);font-size:1rem;">Congratulations!</p>
        </div>
        ${completedMatches.length?`
          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:.85rem;margin-bottom:2rem;">
            <h3 style="margin-bottom:1.5rem;font-size:1rem;">Tournament Summary</h3>
            <div style="max-height:300px;overflow-y:auto;">
              ${completedMatches.map((m,i)=>`<div style="background:rgba(255,255,255,0.1);padding:1rem;border-radius:4px;margin-bottom:.5rem;">
                <span style="font-size:.85rem;">Match ${i+1}: ${m.player1} vs ${m.player2}</span>
                <div style="margin-top:.25rem;font-size:.85rem;">Winner: ${m.winner}</div>
              </div>`).join('')}
            </div>
          </div>`:''}
        <div style="display:flex;gap:1rem;justify-content:center;margin-bottom:2rem%;">
          <button data-action="reset-tournament" style="padding:8px 16px;background:#c6209d;color:white;border:none;border-radius:8px;cursor:pointer;font-size:.85rem;">New Tournament</button>
          <button data-action="navigate-welcome" style="padding:8px 16px;background:#4e23f8;color:white;border:none;border-radius:8px;cursor:pointer;font-size:.85rem;">Home</button>
        </div>
      </div>`;
  }

  public cleanup(): void {
    if (this.tournamentRedirectTimer) {
      clearTimeout(this.tournamentRedirectTimer);
      this.tournamentRedirectTimer = null;
    }

    this.neonFrame.detach();
    this.canvas = null;
    this.ctx = null;
  }

  /* Nettoie les caches d'avatars et d'état (à appeler lors du logout) */
  public clearAvatarCache(): void {
    console.log('[GameRenderer] Clearing avatar caches');
    this.initialAvatarByUsername = {};
    this.lastAvatars = {
      left:  { username: 'Player 1', avatar_url: '' },
      right: { username: 'Player 2', avatar_url: '' }
    };
    this.lastPlayerSlotMarkup = {
      left: '',
      right: ''
    };
    this.lastNameLeft = 'Player 1';
    this.lastNameRight = 'Player 2';
    this.lastServerState = null;
    this.finalSummary = null;
  }

  /* Cleanup complet pour transition de session */
  public fullSessionCleanup(): void {
    console.log('[GameRenderer] Full session cleanup');
    this.clearAvatarCache();
    this.clearTournamentMatchInfo();
    this.cleanup();
  }
}