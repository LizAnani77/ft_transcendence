// frontend/src/game/GameEngine.ts
/* Moteur local + client remote (contrôles) — conserve le look LOCAL utilisé pour unifier le rendu */

import { WebSocketService } from '../services/WebSocketService';
import { NeonFrameRenderer } from '../core/NeonFrameRenderer';

export interface GameState {
  ball: { x: number; y: number; vx: number; vy: number; radius: number };
  paddle1: { x: number; y: number; width: number; height: number; score: number };
  paddle2: { x: number; y: number; width: number; height: number; score: number };
  gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
}

export interface TournamentMatchInfo {
  player1Name: string; player2Name: string; isActive: boolean; isTournament: boolean;
}

export class GameEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private gameState: GameState;
  private animationId = 0;
  private keys = new Set<string>();
  private neonFrame = new NeonFrameRenderer({
    speed: 0.35,
    trailLengthRatio: 0.7,
    persistence: 0.97,
    padding: 0
  });

  // tournoi / fin
  private tournamentMatch: TournamentMatchInfo | null = null;
  private onGameEndCallback?: (winner: string) => void;
  private gameEndMessageShown = false;

  // clavier
  private keydownHandler: (e: KeyboardEvent) => void;
  private keyupHandler: (e: KeyboardEvent) => void;

  // remote
  private isRemoteMode = false;
  private remoteGameId: string | null = null;
  private wsService: WebSocketService | null = null;
  private currentUserId: number | null = null;
  private lastInputTime = 0;
  private inputThrottle = 16; // ~60fps
  private mySide: 'left' | 'right' | null = null; // << côté contrôlé en remote

  private readonly W = 800; private readonly H = 600;

  /* Constructeur */
  constructor() {
    this.gameState = this.initializeGameState();

    this.keydownHandler = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase(); this.keys.add(k);
      const isSpace =
        e.code === 'Space' || e.key === ' ' || e.key === 'Space' || e.key === 'Spacebar' ||
        k === ' ' || k === 'space' || k === 'spacebar';

      // ✅ CORRECTION : espace = pause/reprise UNIQUEMENT en local (jamais en remote)
      if (!this.isRemoteMode && isSpace) {
        e.preventDefault();
        if (this.gameState.gameStatus === 'paused') this.gameState.gameStatus = 'playing';
        else if (this.gameState.gameStatus === 'playing') this.gameState.gameStatus = 'paused';
        else if (this.gameState.gameStatus === 'waiting') this.gameState.gameStatus = 'playing';
        else if (this.gameState.gameStatus === 'finished') this.restartGame();
      }
      
      // ✅ CORRECTION : En remote, ESPACE bloqué pour éviter tout conflit avec pause
      if (this.isRemoteMode && isSpace) {
        e.preventDefault();
        // Ne rien faire : la pause n'existe pas en mode remote
        console.log('[GameEngine] SPACE ignored in remote mode');
      }
    };

    this.keyupHandler = (e: KeyboardEvent) => this.keys.delete((e.key || '').toLowerCase());
  }

  /* Active le mode remote + abonnements WS */
  public initializeRemoteMode(gameId: string, wsService: WebSocketService, userId: number): void {
    this.isRemoteMode = true; this.remoteGameId = gameId; this.wsService = wsService; this.currentUserId = userId;

    const applyPlayers = (p1?: { id: number; username: string }, p2?: { id: number; username: string }) => {
      // noms UI
      const n1 = this.escapeHtml(p1?.username ?? 'Player 1'), n2 = this.escapeHtml(p2?.username ?? 'Player 2');
      this.tournamentMatch
        ? (this.tournamentMatch.player1Name = n1, this.tournamentMatch.player2Name = n2)
        : (this.tournamentMatch = { player1Name: n1, player2Name: n2, isActive: true, isTournament: false });

      // côté contrôlé
      if (this.currentUserId && p1 && p2)
        this.mySide = this.currentUserId === p1.id ? 'left' : this.currentUserId === p2.id ? 'right' : null;
    };

    wsService.onMessage('game:joined', (msg: any) => {
      if (msg?.data?.gameId !== this.remoteGameId) return;
      const st = msg?.data?.gameState ?? null;
      if (st) { this.updateFromServer(st); applyPlayers(st.players?.player1, st.players?.player2); }
    });
    wsService.onMessage('game:started', (msg: any) => {
      if (msg?.data?.gameId !== this.remoteGameId) return;
      const st = msg?.data?.gameState ?? null;
      if (st) { this.updateFromServer(st); applyPlayers(st.players?.player1, st.players?.player2); }
    });
    wsService.onMessage('game:state_update', (msg: any) => {
      const st = msg?.data; if (!st || st.gameId !== this.remoteGameId) return;
      this.updateFromServer(st); applyPlayers(st.players?.player1, st.players?.player2);
    });

    // IMPORTANT : capter W/S et O/K en remote
    this.setupControls();
  }

  /* Applique l'état serveur (autoritaire) */
  private updateFromServer(serverData: {
    gameId: string;
    ball: { x: number; y: number; vx?: number; vy?: number; radius: number };
    paddle1: { x: number; y: number; width: number; height: number; score: number };
    paddle2: { x: number; y: number; width: number; height: number; score: number };
    gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
    players?: { player1?: { id: number; username: string }; player2?: { id: number; username: string } };
  }): void {
    if (!this.isRemoteMode) return;

    if (serverData.ball)    this.gameState.ball    = { ...this.gameState.ball, ...serverData.ball };
    if (serverData.paddle1) this.gameState.paddle1 = { ...serverData.paddle1 };
    if (serverData.paddle2) this.gameState.paddle2 = { ...serverData.paddle2 };
    
    // ✅ CORRECTION : En remote, ignorer complètement l'état 'paused' du serveur
    // On force toujours 'playing' sauf pour 'waiting' et 'finished'
    if (serverData.gameStatus) {
      if (serverData.gameStatus === 'paused') {
        // Transformer 'paused' en 'playing' pour éviter l'affichage
        this.gameState.gameStatus = 'playing';
        console.log('[GameEngine] Server sent paused, forcing playing in remote mode');
      } else {
        this.gameState.gameStatus = serverData.gameStatus;
      }
    }

    if (serverData.players && this.currentUserId) {
      const p1 = serverData.players.player1?.id, p2 = serverData.players.player2?.id;
      this.mySide = this.currentUserId === p1 ? 'left' : this.currentUserId === p2 ? 'right' : this.mySide;
    }
  }

  /* État initial (local) */
  private initializeGameState(): GameState {
    return {
      ball: { x: 400, y: 300, vx: 10, vy: 10, radius: 8 },
      paddle1: { x: 30, y: 250, width: 10, height: 100, score: 0 },
      paddle2: { x: 755, y: 250, width: 10, height: 100, score: 0 },
      gameStatus: 'waiting'
    };
  }

  /* Escape HTML */
  private escapeHtml(text: string): string {
    const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
  }

  /* Restart (local) */
  public restartGame(): void {
    this.gameState.ball = { x: 400, y: 300, vx: 10, vy: 10, radius: 8 };
    this.gameState.paddle1.score = this.gameState.paddle2.score = 0;
    this.gameState.paddle1.y = this.gameState.paddle2.y = 250;
    this.gameState.gameStatus = 'waiting'; this.gameEndMessageShown = false;
    if (this.animationId === 0) this.gameLoop();
  }

  /* Init match */
  public initializeForTournament(
    canvasId: string,
    player1Name: string,
    player2Name: string,
    onGameEnd?: (winner: string) => void,
    isTournament: boolean = true
  ): void {
    this.tournamentMatch = {
      player1Name: this.escapeHtml(player1Name.trim()),
      player2Name: this.escapeHtml(player2Name.trim()),
      isActive: true,
      isTournament
    };
    this.onGameEndCallback = onGameEnd; this.gameEndMessageShown = false; this.initialize(canvasId);
  }

  /* Init canvas + boucle */
  public initialize(canvasId: string): void {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement; if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d'); if (!this.ctx) return;
    this.neonFrame.attach(this.canvas, this.ctx);
    this.setupControls(); this.gameState.gameStatus = 'waiting'; this.gameLoop();
  }

  /* Contrôles clavier */
  private setupControls(): void {
    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
  }

  /* Game loop */
  private gameLoop = (timestamp?: number): void => {
    if (!this.ctx || !this.canvas) return;
    const frameTime = typeof timestamp === 'number'
      ? timestamp
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // efface + fond local
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.neonFrame.render(frameTime);

    if (this.gameState.gameStatus === 'playing') this.update();
    this.render();
    this.animationId = requestAnimationFrame(this.gameLoop);
  };

  /* Update par frame */
  private update(): void {
    this.updatePaddles();
    if (this.isRemoteMode) return; // serveur gère balle/collisions/scores
    this.updateBall(); this.checkCollisions(); this.checkScore();
  }

  /* Déplacements paddles */
  private updatePaddles(): void {
    // ---- REMOTE : n'accepter que les touches de MON côté ----
    if (this.isRemoteMode && this.wsService && this.remoteGameId) {
      if (!this.mySide) return;
      const now = Date.now();
      if (now - this.lastInputTime >= this.inputThrottle) {
        let action: 'up' | 'down' | 'stop' = 'stop';
        if (this.mySide === 'left') {
          const up = this.keys.has('w'), down = this.keys.has('s'); action = up ? 'up' : down ? 'down' : 'stop';
        } else {
          const up = this.keys.has('o'), down = this.keys.has('k'); action = up ? 'up' : down ? 'down' : 'stop';
        }
        try { this.wsService.sendGameInput(this.remoteGameId, action); this.lastInputTime = now; } catch { /* no-op */ }
      }
      return;
    }

    // ---- LOCAL ----
    const s = 7, p1 = this.gameState.paddle1, p2 = this.gameState.paddle2;
    if (this.keys.has('w') && p1.y > 0) p1.y -= s;
    if (this.keys.has('s') && p1.y < this.H - p1.height) p1.y += s;
    if (this.keys.has('o') && p2.y > 0) p2.y -= s;
    if (this.keys.has('k') && p2.y < this.H - p2.height) p2.y += s;
  }

  /* Local : balle */
  private updateBall(): void {
    const { ball } = this.gameState;
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= this.H) ball.vy = -ball.vy;
  }

  /* Local : collisions */
  private checkCollisions(): void {
    const { ball, paddle1, paddle2 } = this.gameState;
    if (
      ball.x - ball.radius <= paddle1.x + paddle1.width &&
      ball.x + ball.radius >= paddle1.x &&
      ball.y >= paddle1.y &&
      ball.y <= paddle1.y + paddle1.height &&
      ball.vx < 0
    ) { ball.vx = Math.abs(ball.vx); this.addSpin(paddle1); }

    if (
      ball.x + ball.radius >= paddle2.x &&
      ball.x - ball.radius <= paddle2.x + paddle2.width &&
      ball.y >= paddle2.y &&
      ball.y <= paddle2.y + paddle2.height &&
      ball.vx > 0
    ) { ball.vx = -Math.abs(ball.vx); this.addSpin(paddle2); }
  }

  /* Local : spin */
  private addSpin(paddle: { y: number; height: number }): void {
    const { ball } = this.gameState;
    const center = paddle.y + paddle.height / 2;
    const hit = (ball.y - center) / (paddle.height / 2);
    ball.vy = hit * 5;
  }

  /* Local : score + fin */
  private checkScore(): void {
    const { ball } = this.gameState;
    if (ball.x < 0) { this.gameState.paddle2.score++; this.resetBall(); }
    else if (ball.x > this.W) { this.gameState.paddle1.score++; this.resetBall(); }

    if (this.gameState.paddle1.score >= 5 || this.gameState.paddle2.score >= 5) {
      this.gameState.gameStatus = 'finished';
      if (!this.gameEndMessageShown) {
        if (this.tournamentMatch && this.onGameEndCallback) {
          const winner = this.gameState.paddle1.score > this.gameState.paddle2.score
            ? this.tournamentMatch?.player1Name || 'Player 1'
            : this.tournamentMatch?.player2Name || 'Player 2';
          this.onGameEndCallback(winner);
        }
        this.gameEndMessageShown = true;
      }
    }
  }

  /* Local : reset balle */
  private resetBall(): void {
    this.gameState.ball = { 
      x: 400, y: 300, 
      vx: Math.random() > 0.5 ? 10 : -10,  // ✅ Changé de 5 à 10
      vy: (Math.random() - 0.5) * 6, 
      radius: 8
    };
  }

  /* Rendu local (référence pour l'alignement remote) */
  private render(): void {
    if (!this.ctx) return;
    const { ctx } = this;

    // filet (style local)
    ctx.setLineDash([5, 15]); ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(400, 0); ctx.lineTo(400, 600); ctx.stroke(); ctx.setLineDash([]);

    // paddles
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.gameState.paddle1.x, this.gameState.paddle1.y, this.gameState.paddle1.width, this.gameState.paddle1.height);
    ctx.fillRect(this.gameState.paddle2.x, this.gameState.paddle2.y, this.gameState.paddle2.width, this.gameState.paddle2.height);

    // balle (en remote: pos serveur)
    if (this.gameState.gameStatus === 'playing') {
      ctx.beginPath(); ctx.arc(this.gameState.ball.x, this.gameState.ball.y, this.gameState.ball.radius, 0, Math.PI * 2); ctx.fill();
    }

    // scores
    ctx.font = '600 20px Jura'; ctx.textAlign = 'center';
    ctx.fillText(this.gameState.paddle1.score.toString(), 200, 60);
    ctx.fillText(this.gameState.paddle2.score.toString(), 600, 60);

    // overlays
    // ✅ CORRECTION : PAUSED uniquement en mode local
    if (this.gameState.gameStatus === 'paused' && !this.isRemoteMode) {
      ctx.font = '20px Jura'; ctx.fillStyle = '#ffffff';
      ctx.fillText('PAUSED', 400, 300);
      ctx.fillText('Press SPACE to continue', 400, 340);
    }
    
    if (this.gameState.gameStatus === 'waiting') {
      ctx.font = '20px Jura'; ctx.fillStyle = '#ffffff';
      ctx.fillText('Press SPACE to start', 400, 300);
    }
    
    if (this.gameState.gameStatus === 'finished') {
      const winner = this.gameState.paddle1.score > this.gameState.paddle2.score
        ? this.tournamentMatch?.player1Name || 'Player 1'
        : this.tournamentMatch?.player2Name || 'Player 2';
      const s1 = this.gameState.paddle1.score, s2 = this.gameState.paddle2.score;

      // ⬇️ Fenêtre de fin transparente : on SUPPRIME le fond noir
      ctx.fillStyle = '#ffffff'; ctx.font = '20px Jura'; ctx.textAlign = 'center';
      ctx.fillText(`${winner} WINS!`, 400, 250);
      ctx.font = '15px Jura'; ctx.fillText(`Final Score: ${s1} - ${s2}`, 400, 300);

      if (this.tournamentMatch && this.tournamentMatch.isTournament) {
        ctx.font = 'bold 20px Jura'; ctx.fillStyle = '#ffffff';
        ctx.fillText('Tournament Match Complete!', 400, 350);
        ctx.fillStyle = '#ffffff'; ctx.font = '20px Jura';
        ctx.fillText('Returning to tournament in 3 seconds...', 400, 380);
      } else {
        ctx.font = '20px Jura'; ctx.fillStyle = '#ffffff';
        ctx.fillText('Press SPACE to play again', 400, 350);
      }
    }
  }

  /* Reset complet */
  public reset(): void {
    if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = 0; }
    this.gameState = this.initializeGameState();
    this.keys.clear(); this.tournamentMatch = null; this.onGameEndCallback = undefined; this.gameEndMessageShown = false;
    this.isRemoteMode = false; this.remoteGameId = null; this.wsService = null; this.currentUserId = null; this.mySide = null;
    this.neonFrame.detach();
    if (this.canvas && this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /* Destruction */
  public destroy(): void {
    if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = 0; }
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
    this.keys.clear();
    this.neonFrame.detach();
  }

  /* Getters utilitaires */
  public getTournamentMatch(): TournamentMatchInfo | null { return this.tournamentMatch; }
  public getGameState(): GameState { return this.gameState; }
  public startGame(): void { this.gameState.gameStatus = 'playing'; }

  /* Toggle pause uniquement en local */
public togglePause(): void {
  // Sécurité : bloquer complètement en remote
  if (this.isRemoteMode) {
    console.warn('[GameEngine] togglePause ignored in remote mode');
    return;
  }
  
  const s = this.gameState.gameStatus;
  this.gameState.gameStatus = s === 'playing' ? 'paused' : s === 'paused' ? 'playing' : s;
}
  public isRemote(): boolean { return this.isRemoteMode; }
}
