// backend/src/game/ServerGameEngine.ts

/* Etat complet d'une partie côté serveur */
export interface ServerGameState {
  gameId: string;
  ball: { x: number; y: number; vx: number; vy: number; radius: number };
  paddle1: { x: number; y: number; width: number; height: number; score: number; vy: number };
  paddle2: { x: number; y: number; width: number; height: number; score: number; vy: number };
  gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
  players: {
    player1?: { id: number; username: string; connected: boolean; avatar_url?: string };
    player2?: { id: number; username: string; connected: boolean; avatar_url?: string };
  };
  lastUpdate: number;
  maxScore: number;

  /* Métadonnées de fin de partie (pour notification serveur) */
  finishedAt?: number;
  winnerSide?: 'player1' | 'player2' | null;
  finishedNotified?: boolean;
}

/* Résumé de fin (utilisé par le serveur pour envoyer game:finished) */
export interface FinishedSummary {
  gameId: string;
  winnerSide: 'player1' | 'player2';
  winner: { id: number; username: string };
  score1: number;
  score2: number;
  players: ServerGameState['players'];
}

/* Entrée d'un joueur (up/down/stop) */
export interface PlayerInput { userId: number; action: 'up' | 'down' | 'stop'; timestamp: number }

/* Moteur de jeu serveur (autoritaire) */
export class ServerGameEngine {
  private games = new Map<string, ServerGameState>();
  private gameLoops = new Map<string, NodeJS.Timeout>();

  /* File d'attente des parties terminées à notifier au serveur */
  private finishedQueue: string[] = [];

  /* Dimensions du terrain (doivent matcher le front) */
  private readonly GAME_WIDTH  = 800;
  private readonly GAME_HEIGHT = 600;

  /* ⚙️ Paramètres de jeu (alignés sur le mode local) */
  private readonly PADDLE_SPEED   = 7;   // local: 7 px/tick normalisé
  private readonly PADDLE_WIDTH   = 10;  // local: 10
  private readonly PADDLE_HEIGHT  = 100; // local: 100
  private readonly PADDLE_MARGIN_X = 30; // local: 30px du bord

  private readonly BALL_SPEED_X   = 10;  // local: 10 au départ
  private readonly BALL_SPEED_Y   = 10;  // local: 10 au départ
  private readonly BALL_RADIUS    = 8;  // local: 8

  private readonly MAX_SCORE = 5;
  private readonly TICK_RATE = 60; // 60 FPS

  /* Outils utilitaires pour réduire le code */
  private clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  private actionToVy = (a: 'up'|'down'|'stop') => a === 'up' ? -this.PADDLE_SPEED : a === 'down' ? this.PADDLE_SPEED : 0;

  /* Remet la balle au centre et (re)lance le jeu dans une direction */
  private serve = (g: ServerGameState, dir: -1 | 1) => g.ball = {
    x: this.GAME_WIDTH / 2,
    y: this.GAME_HEIGHT / 2,
    vx: dir * this.BALL_SPEED_X,
    vy: (Math.random() - .5) * 6, // ~[-3; +3], comme le reset local
    radius: this.BALL_RADIUS
  };

  /* Crée une nouvelle partie entre deux joueurs */
  public createGame(
    p1Id: number, p1Name: string, p1Avatar: string,
    p2Id: number, p2Name: string, p2Avatar: string
  ): string {
    const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const state: ServerGameState = {
      gameId,
      ball: { x: 400, y: 300, vx: this.BALL_SPEED_X, vy: this.BALL_SPEED_Y, radius: this.BALL_RADIUS },
      paddle1: { x: this.PADDLE_MARGIN_X, y: 250, width: this.PADDLE_WIDTH, height: this.PADDLE_HEIGHT, score: 0, vy: 0 },
      paddle2: { x: this.GAME_WIDTH - this.PADDLE_MARGIN_X - this.PADDLE_WIDTH, y: 250, width: this.PADDLE_WIDTH, height: this.PADDLE_HEIGHT, score: 0, vy: 0 },
      gameStatus: 'waiting',
      /* IMPORTANT: les joueurs ne sont pas marqués connectés ici.
         server.ts appellera updatePlayerConnection() au bon moment. */
      players: {
        player1: { id: p1Id, username: p1Name, connected: false, avatar_url: p1Avatar },
        player2: { id: p2Id, username: p2Name, connected: false, avatar_url: p2Avatar }
      },
      lastUpdate: Date.now(),
      maxScore: this.MAX_SCORE,
      winnerSide: null,
      finishedNotified: false
    };
    this.games.set(gameId, state);
    return gameId;
  }

  /* Crée une nouvelle partie avec un gameId fourni */
  public createGameWithId(
    gameId: string,
    player1Id: number,
    player1Name: string,
    player1Avatar: string,
    player2Id: number,
    player2Name: string,
    player2Avatar: string
  ): string {
    const state: ServerGameState = {
      gameId,
      ball: { x: 400, y: 300, vx: this.BALL_SPEED_X, vy: this.BALL_SPEED_Y, radius: this.BALL_RADIUS },
      paddle1: { x: this.PADDLE_MARGIN_X, y: 250, width: this.PADDLE_WIDTH, height: this.PADDLE_HEIGHT, score: 0, vy: 0 },
      paddle2: { x: this.GAME_WIDTH - this.PADDLE_MARGIN_X - this.PADDLE_WIDTH, y: 250, width: this.PADDLE_WIDTH, height: this.PADDLE_HEIGHT, score: 0, vy: 0 },
      gameStatus: 'waiting',
      players: {
        player1: { id: player1Id, username: player1Name, connected: false, avatar_url: player1Avatar },
        player2: { id: player2Id, username: player2Name, connected: false, avatar_url: player2Avatar }
      },
      lastUpdate: Date.now(),
      maxScore: this.MAX_SCORE,
      winnerSide: null,
      finishedNotified: false
    };
    this.games.set(gameId, state);
    return gameId;
  }

  /* Démarre la boucle de jeu pour une partie */
  public startGame(gameId: string): boolean {
    const g = this.games.get(gameId); if (!g || g.gameStatus !== 'waiting') return false;
    g.gameStatus = 'playing'; g.lastUpdate = Date.now();
    this.gameLoops.set(gameId, setInterval(() => this.updateGame(gameId), 1000 / this.TICK_RATE));
    return true;
  }

  /* Met à jour l'état du jeu (physique serveur) */
  private updateGame(gameId: string): void {
    const g = this.games.get(gameId); if (!g || g.gameStatus !== 'playing') return;
    const now = Date.now(), dt = now - g.lastUpdate, factor = dt / (1000 / this.TICK_RATE); g.lastUpdate = now;

    /* Déplacement paddles via vy (continu) */
    g.paddle1.y = this.clamp(g.paddle1.y + g.paddle1.vy * factor, 0, this.GAME_HEIGHT - g.paddle1.height);
    g.paddle2.y = this.clamp(g.paddle2.y + g.paddle2.vy * factor, 0, this.GAME_HEIGHT - g.paddle2.height);

    /* Balle */
    const b = g.ball; b.x += b.vx * factor; b.y += b.vy * factor;
    if (b.y - b.radius <= 0 || b.y + b.radius >= this.GAME_HEIGHT) b.vy = -b.vy;

    /* Collisions */
    this.checkCollisions(g);

    /* Score / fin */
    this.checkScore(g);
  }

  /* Vérifie les collisions balle/raquettes */
  private checkCollisions(g: ServerGameState): void {
    const { ball: b, paddle1: p1, paddle2: p2 } = g;
    const hit = (p: { x: number; y: number; width: number; height: number }, dir: -1 | 1) =>
      b.x - b.radius <= p.x + p.width &&
      b.x + b.radius >= p.x &&
      b.y >= p.y &&
      b.y <= p.y + p.height &&
      (dir < 0 ? b.vx < 0 : b.vx > 0);

    // paddle 1 (gauche)
    if (hit(p1, -1)) { b.vx = Math.abs(b.vx); this.addSpin(g, 'p1'); }
    // paddle 2 (droite)
    if (hit(p2, 1))  { b.vx = -Math.abs(b.vx); this.addSpin(g, 'p2'); }
  }

  /* Ajoute de l'effet selon la zone d'impact */
  private addSpin(g: ServerGameState, side: 'p1' | 'p2'): void {
    const p = side === 'p1' ? g.paddle1 : g.paddle2;
    const center = p.y + p.height / 2;
    const hit = (g.ball.y - center) / (p.height / 2);
    g.ball.vy = hit * 5;
  }

  /* Vérifie les scores et gère la fin de partie */
  private checkScore(g: ServerGameState): void {
    const b = g.ball;
    if (b.x < 0) { g.paddle2.score++; this.serve(g, -1); }
    else if (b.x > this.GAME_WIDTH) { g.paddle1.score++; this.serve(g, 1); }

    if (g.paddle1.score >= g.maxScore || g.paddle2.score >= g.maxScore) {
      g.winnerSide = g.paddle1.score > g.paddle2.score ? 'player1' : 'player2';
      g.finishedAt = Date.now(); this.endGame(g.gameId);
    }
  }

  /* Remet la balle au centre (service dirigé) */
  private resetBall(game: ServerGameState, dir: -1 | 1): void { this.serve(game, dir); }

  /* Termine une partie proprement */
  public endGame(gameId: string): void {
    const g = this.games.get(gameId); if (!g) return;
    g.gameStatus = 'finished'; if (!g.finishedAt) g.finishedAt = Date.now();
    const loop = this.gameLoops.get(gameId); if (loop) { clearInterval(loop); this.gameLoops.delete(gameId); }
    /* Notification serveur (game:finished), une seule fois */
    if (!g.finishedNotified) this.finishedQueue.push(gameId);
  }

  /* Réinitialise une partie finie pour un rematch (scores=0, positions reset) */
  public resetFinishedGame(gameId: string): boolean {
    const g = this.games.get(gameId); if (!g) return false;

    // Scores & positions verticales
    g.paddle1.score = g.paddle2.score = 0;
    g.paddle1.y = g.paddle2.y = 250;

    // Réapplique tailles & positions horizontales (cohérence totale avec le local)
    g.paddle1.width  = g.paddle2.width  = this.PADDLE_WIDTH;
    g.paddle1.height = g.paddle2.height = this.PADDLE_HEIGHT;
    g.paddle1.x = this.PADDLE_MARGIN_X;
    g.paddle2.x = this.GAME_WIDTH - this.PADDLE_MARGIN_X - this.PADDLE_WIDTH;

    // Balle relancée comme en local (vy aléatoire doux)
    this.serve(g, Math.random() < .5 ? -1 : 1);

    // Statut & méta fin
    g.gameStatus = 'waiting';
    g.winnerSide = null;
    g.finishedAt = undefined;
    g.finishedNotified = false;
    g.lastUpdate = Date.now();
    return true;
  }

  /* Traite les entrées des joueurs (map userId → bon paddle) */
  public processPlayerInput(gameId: string, input: PlayerInput): boolean {
    const g = this.games.get(gameId); if (!g || g.gameStatus !== 'playing') return false;
    const { userId, action } = input;
    if (g.players.player1?.id === userId) g.paddle1.vy = this.actionToVy(action);
    else if (g.players.player2?.id === userId) g.paddle2.vy = this.actionToVy(action);
    else return false;
    g.lastUpdate = Date.now();
    return true; /* NB: le rendu sera diffusé par server.ts via game:state_update */
  }

  /* Met à jour le statut de connexion d'un joueur */
  public updatePlayerConnection(gameId: string, userId: number, connected: boolean): void {
    const g = this.games.get(gameId); if (!g) return;
    if (g.players.player1?.id === userId) g.players.player1.connected = connected;
    else if (g.players.player2?.id === userId) g.players.player2.connected = connected;
    
    /* ✅ CORRECTION DÉFINITIVE : PAS de pause automatique en remote
      Le jeu continue quoi qu'il arrive. Si un joueur se déconnecte vraiment,
      game:player_disconnected sera géré côté client pour afficher un message. */
    
    // ANCIEN CODE SUPPRIMÉ :
    // if (!connected && g.gameStatus === 'playing') g.gameStatus = 'paused';
  }

  /* Reprend une partie si les deux joueurs sont connectés */
  public tryResumeGame(gameId: string): boolean {
    const g = this.games.get(gameId); if (!g || g.gameStatus !== 'paused') return false;
    const both = !!g.players.player1?.connected && !!g.players.player2?.connected;
    if (both) { g.gameStatus = 'playing'; return true; }
    return false;
  }

  /* Retourne l'état d'une partie */
  public getGameState(gameId: string): ServerGameState | null { return this.games.get(gameId) || null; }

  /* Retourne toutes les parties actives */
  public getActiveGames(): string[] {
    return Array.from(this.games.keys()).filter(id => {
      const g = this.games.get(id);
      return !!g && g.gameStatus !== 'finished';
    });
  }

  /* Supprime une partie terminée */
  public removeGame(gameId: string): boolean {
    const loop = this.gameLoops.get(gameId);
    if (loop) { clearInterval(loop); this.gameLoops.delete(gameId); }
    return this.games.delete(gameId);
  }

  /* Annule une partie sans l'enregistrer comme 'finished' (pas de résumé, pas de DB) */
  public cancelGame(gameId: string): boolean { return this.removeGame(gameId); }

  /* Nettoie les parties inactives */
  public cleanup(): void {
    const now = Date.now();
    const INACTIVE_TIMEOUT = 10 * 60 * 1000; // 10 min (jeu inactif)
    const FINISHED_GRACE   = 15 * 60 * 1000; // 15 min (laisser le temps au rematch)
    for (const [id, g] of this.games.entries()) {
      // Cas 1 : parties terminées -> on garde pendant FINISHED_GRACE pour permettre SPACE/rematch
      if (g.gameStatus === 'finished') {
        const ref = g.finishedAt ?? g.lastUpdate;
        if (now - ref > FINISHED_GRACE) this.removeGame(id);
        continue;
      }
      // Cas 2 : parties non terminées mais inactives trop longtemps
      if (now - g.lastUpdate > INACTIVE_TIMEOUT) this.removeGame(id);
    }
  }

  /* Draine les parties terminées pour notification */
  public drainFinishedSummaries(): Array<{ gameId: string; state: ServerGameState; summary: FinishedSummary }> {
    const out: Array<{ gameId: string; state: ServerGameState; summary: FinishedSummary }> = [];
    while (this.finishedQueue.length > 0) {
      const id = this.finishedQueue.shift()!;
      const g = this.games.get(id);
      if (!g || g.finishedNotified) continue;

      const winnerSide: 'player1' | 'player2' =
        (g.winnerSide ?? (g.paddle1.score > g.paddle2.score ? 'player1' : 'player2')) as 'player1' | 'player2';

      const winner = winnerSide === 'player1'
        ? { id: g.players.player1!.id, username: g.players.player1!.username }
        : { id: g.players.player2!.id, username: g.players.player2!.username };

      const summary: FinishedSummary = {
        gameId: id,
        winnerSide,
        winner,
        score1: g.paddle1.score,
        score2: g.paddle2.score,
        players: g.players
      };

      g.finishedNotified = true;
      out.push({ gameId: id, state: g, summary });
    }
    return out;
  }
}