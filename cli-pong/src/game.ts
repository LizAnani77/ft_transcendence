// cli-pong/src/game.ts

import { WebSocketService, GameState } from './websocket.js';

export class PongGame {
  private ws: WebSocketService;
  private currentGameId: string | null = null;
  private gameState: GameState | null = null;
  private userId: number;
  private username: string;
  private onlinePlayers: Map<number, { username: string }> = new Map();
  private pendingChallenge: { challengerId: number; challengerName: string } | null = null;
  private challengedUserId: number | null = null; // ID du joueur qu'on a challengé
  private playerListReceived: boolean = false;
  private playerListResolve: (() => void) | null = null;
  private currentDirection: 'up' | 'down' | null = null;
  private lastKeyTime: number = 0;
  private inputInterval: NodeJS.Timeout | null = null;
  private renderInterval: NodeJS.Timeout | null = null;
  private localPaddleY: number | null = null;
  private paddleSpeed: number = 10; // Vitesse de prédiction locale (pixels par frame à 60fps)

  // Interpolation de la balle uniquement
  private lastBallX: number = 400;
  private lastBallY: number = 300;
  private targetBallX: number = 400;
  private targetBallY: number = 300;
  private ballLerpFactor: number = 0;

  constructor(ws: WebSocketService, userId: number, username: string) {
    this.ws = ws;
    this.userId = userId;
    this.username = username;
    
    this.setupWebSocketHandlers();

    // Envoyer les inputs en continu à 30 FPS (33ms)
    this.inputInterval = setInterval(() => {
      if (this.currentDirection && this.currentGameId) {
        this.sendInput(this.currentDirection);
      }
    }, 33);

    // Boucle de rendu à 30 FPS (33ms)
    this.renderInterval = setInterval(() => {
      if (this.gameState) {
        this.updateLocalPrediction();
        this.render();
      }
    }, 33);
  }

  /* Efface complètement l'écran du terminal et repositionne le curseur en haut à gauche. */
  private clearScreen(): void {
    // Effacer tout l'écran et repositionner en haut
    console.clear();
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /* Configure les gestionnaires de touches pour contrôler le jeu en temps réel. */
  private setupKeyHandlers(): void {
    // Activer alternate screen buffer et cacher curseur
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Check pour auto-stop si pas d'input (150ms pour laisser le temps de maintenir la touche)
    setInterval(() => {
      if (this.currentDirection && Date.now() - this.lastKeyTime > 150) {
        this.currentDirection = null;
        this.sendInput('stop');
      }
    }, 16);

    process.stdin.on('data', (key: string) => {
      const now = Date.now();

      // Ctrl+C pour quitter
      if (key === '\u0003') {
        this.cleanup();
        process.exit(0);
      }

      // ESC seul (pas suivi de [ pour les flèches) pour quitter
      if (key === '\u001b') {
        this.cleanup();
        process.exit(0);
      }

      // Y pour accepter challenge
      if (key.toLowerCase() === 'y' && this.pendingChallenge) {
        this.acceptChallenge(this.pendingChallenge.challengerId);
        return;
      }

      // N pour refuser challenge
      if (key.toLowerCase() === 'n' && this.pendingChallenge) {
        this.declineChallenge();
        return;
      }

      // Flèche HAUT : \x1b[A
      if (key === '\x1b[A') {
        this.handleArrowKey('up', now);
        return;
      }

      // Flèche BAS : \x1b[B
      if (key === '\x1b[B') {
        this.handleArrowKey('down', now);
        return;
      }

      // P pour replay
      if (key.toLowerCase() === 'p' && this.gameState?.gameStatus === 'finished') {
        if (this.currentGameId) {
          this.ws.send('game:start', { gameId: this.currentGameId });
          this.showStatus('Requesting rematch...');
        }
        return;
      }
      
      // Q pour quitter aussi
      if (key.toLowerCase() === 'q') {
        this.cleanup();
        process.exit(0);
      }
    });
  }

  /* Gère l'appui sur une touche fléchée et enregistre la direction du mouvement. */
  private handleArrowKey(direction: 'up' | 'down', now: number): void {
    if (!this.currentGameId) return;

    this.currentDirection = direction;
    this.lastKeyTime = now;
  }

  /* Met à jour la prédiction locale de la position du paddle pour un rendu fluide. */
  private updateLocalPrediction(): void {
    if (!this.gameState) {
      return;
    }

    // Déterminer quel paddle est le nôtre
    const isPlayer1 = this.gameState.players.player1?.id === this.userId;
    const myPaddle = isPlayer1 ? this.gameState.paddle1 : this.gameState.paddle2;

    // Utiliser directement la position du serveur (source de vérité)
    this.localPaddleY = myPaddle.y;
  }

  /* Envoie une commande de mouvement au serveur pour déplacer la raquette. */
  private sendInput(action: 'up' | 'down' | 'stop'): void {
    if (this.currentGameId) {
      this.ws.send('game:input', {
        gameId: this.currentGameId,
        action: action
      });
    }
  }

  /* Configure tous les gestionnaires de messages WebSocket pour gérer les événements du jeu. */
  private setupWebSocketHandlers(): void {
    this.ws.on('presence:list', (type, data) => {
      if (data.users) {
        data.users.forEach((user: any) => {
          if (user.id !== this.userId) {
            this.onlinePlayers.set(user.id, { username: user.username });
          }
        });
        this.playerListReceived = true;
        if (this.playerListResolve) {
          this.playerListResolve();
          this.playerListResolve = null;
        }
      }
    });

    this.ws.on('presence:update', (type, data) => {
      if (data.user && data.user.id !== this.userId) {
        if (data.user.is_online) {
          this.onlinePlayers.set(data.user.id, { username: data.user.username });
        } else {
          this.onlinePlayers.delete(data.user.id);
        }
      }
    });

    this.ws.on('game:challenge_received', (type, data) => {
      this.pendingChallenge = {
        challengerId: data.challengerId,
        challengerName: data.challengerName
      };
      this.showStatus(`🎮 ${data.challengerName} challenged you! Press Y to accept, N to decline`);
    });

    this.ws.on('game:challenge_sent', (type, data) => {
      if (data.offline) {
        this.showStatus(`✗ ${data.challengedName} is offline`);
      }
    });

    this.ws.on('game:challenge_accepted', (type, data) => {
      this.showStatus('✓ Challenge accepted! Game starting...');
    });

    this.ws.on('game:challenge_declined', (type, data) => {
      this.challengedUserId = null; // Réinitialiser
      this.showStatus('✗ Challenge declined. Exiting...');
      setTimeout(() => process.exit(1), 1000);
    });

    this.ws.on('game:created', (type, data) => {
      this.currentGameId = data.gameId;
      this.challengedUserId = null; // Challenge accepté, réinitialiser
      this.ws.send('game:join', { gameId: data.gameId });
      this.showStatus('Game created! Waiting for opponent to join...');
    });

    this.ws.on('game:joined', (type, data) => {
      this.currentGameId = data.gameId;
      this.showStatus('Both players joined! Game starting soon...');
    });

    this.ws.on('game:started', (type, data) => {
      this.currentGameId = data.gameId;
      this.ws.send('game:join', { gameId: data.gameId });
      this.setupKeyHandlers();
      this.clearScreen();
      this.showStatus('Game started! Use ↑ / ↓ arrows to move, ESC or Q to quit');
    });

    this.ws.on('game:state_update', (type, data) => {
      this.gameState = data;
      // Ne pas réinitialiser la prédiction locale si on est en train de bouger
      // La prédiction se synchronisera automatiquement dans updateLocalPrediction()
    });

    this.ws.on('game:finished', (type, data) => {
      this.currentDirection = null;
      // Le serveur envoie le winner dans data.summary.winner
      const winner = data.summary?.winner?.username || data.winner?.username || 'Unknown';
      this.showStatus(`Game finished! Winner: ${winner} | Press P for replay or ESC / Q to quit`);
    });

    this.ws.on('game:player_disconnected', (type, data) => {
      this.currentDirection = null;
      // Nettoyer l'écran immédiatement
      console.clear();
      process.stdout.write('\x1b[2J\x1b[H');
      console.log('\n\x1b[93m⚠️  Opponent disconnected. Game ended.\x1b[0m\n');
      
      setTimeout(() => {
        this.cleanup(null); // null = pas de message supplémentaire
        process.exit(0);
      }, 2000);
    });

    this.ws.on('game:error', (type, data) => {
      this.showStatus(`Error: ${data.message || data}`);
    });
  }

  /* Attend la réception de la liste des joueurs en ligne avant de continuer. */
  public async waitForPlayerList(): Promise<void> {
    if (this.playerListReceived) {
      return;
    }
    
    return new Promise((resolve, reject) => {
      this.playerListResolve = resolve;
      
      setTimeout(() => {
        if (!this.playerListReceived) {
          reject(new Error('Timeout waiting for player list'));
        }
      }, 5000);
    });
  }

  /* Met le joueur en attente de recevoir un défi d'un autre joueur. */
  public waitForChallenge(): void {
    this.showStatus('⏳ Waiting for challenges... (Press ESC to quit)');
    // Activer les handlers clavier pour pouvoir répondre aux challenges
    this.setupChallengeKeyHandlers();
  }

  /* Configure les gestionnaires de touches pour répondre aux défis reçus. */
  private setupChallengeKeyHandlers(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key: string) => {
      // Ctrl+C pour quitter
      if (key === '\u0003') {
        this.cleanup();
        process.exit(0);
      }

      // ESC pour quitter
      if (key === '\u001b') {
        this.cleanup();
        process.exit(0);
      }

      // Y pour accepter challenge
      if (key.toLowerCase() === 'y' && this.pendingChallenge) {
        this.acceptChallenge(this.pendingChallenge.challengerId);
        return;
      }

      // N pour refuser challenge
      if (key.toLowerCase() === 'n' && this.pendingChallenge) {
        this.declineChallenge();
        return;
      }
    });
  }

  /* Envoie un défi à un joueur spécifique identifié par son nom d'utilisateur. */
  public challengeByUsername(targetUsername: string): void {
    let targetUserId: number | null = null;
    
    for (const [userId, userData] of this.onlinePlayers.entries()) {
      if (userData.username.toLowerCase() === targetUsername.toLowerCase()) {
        targetUserId = userId;
        break;
      }
    }

    if (!targetUserId) {
      this.showStatus(`✗ Player '${targetUsername}' not found or offline`);
      setTimeout(() => process.exit(1), 2000);
      return;
    }

    this.showStatus(`🎮 Challenging ${targetUsername}...`);
    this.challengedUserId = targetUserId; // Stocker pour l'annulation éventuelle
    this.ws.send('game:challenge', { challengedUserId: targetUserId });
    
    // Timeout de sécurité si le jeu ne démarre pas après le challenge
    setTimeout(() => {
      if (!this.currentGameId && this.challengedUserId) {
        this.showStatus('✗ Challenge timed out. Notifying opponent...');
        // Envoyer l'annulation au serveur AVANT de cleanup
        this.ws.send('game:challenge_cancel', { challengedUserId: this.challengedUserId });
        // Attendre 500ms que le message soit envoyé avant de cleanup
        setTimeout(() => {
          // console.log('\x1b[90m(Exiting in 5 seconds... or press Ctrl+C)\x1b[0m\n');
          setTimeout(() => {
            process.exit(1);
          }, 5000);  // ← 5 secondes pour lire les messages
        }, 500);
      }
    }, 10000);
  }

  /* Accepte un défi reçu et crée une nouvelle partie avec le challenger. */
  private acceptChallenge(challengerId: number): void {
    console.log('[CLI] ✅ Accepting challenge from userId:', challengerId);
    this.pendingChallenge = null;
    this.showStatus('✓ Challenge accepted! Creating game...');
    
    // Envoyer game:create avec l'opponentId du challenger
    // Cela suit le même flux que le web et permet au serveur de créer le jeu correctement
    this.ws.send('game:create', {
      opponentId: challengerId,
      gameMode: 'classic'
    });
    
    console.log('[CLI] 📤 Sent game:create to server with opponentId:', challengerId);
    
    // Timeout de sécurité si le jeu ne démarre pas
    setTimeout(() => {
      if (!this.currentGameId) {
        this.showStatus('✗ Game failed to start. Connection issue detected.');
        setTimeout(() => process.exit(1), 2000);
      }
    }, 10000);
  }

  /* Refuse un défi reçu et réinitialise l'état du défi en attente. */
  private declineChallenge(): void {
    this.pendingChallenge = null;
    this.showStatus('✗ Challenge declined');
    setTimeout(() => process.exit(1), 1000);
  }

  /* Affiche l'état actuel du jeu dans le terminal avec les raquettes et la balle. */
  private render(): void {
    if (!this.gameState) return;

    const { ball, paddle1, paddle2, players } = this.gameState;

    const width = 80;
    const height = 24;
    const leftMargin = 10;  // Marge à gauche
    const topMargin = 2;    // Marge en haut

    // Couleurs arc-en-ciel pour les bordures (pas d'animation)
    const rainbowColors = [
      '\x1b[91m',  // Rouge
      '\x1b[93m',  // Jaune
      '\x1b[92m',  // Vert
      '\x1b[96m',  // Cyan
      '\x1b[94m',  // Bleu
      '\x1b[95m'   // Magenta
    ];

    const white = '\x1b[97m';  // Blanc
    const reset = '\x1b[0m';

    const field: string[][] = Array(height).fill(null).map(() => Array(width).fill(' '));

    // Ligne centrale avec des traits plus petits (tous les 3 lignes au lieu de 2)
    for (let y = 0; y < height; y += 2) {
      field[y][Math.floor(width / 2)] = '.';
    }

    // Déterminer quel paddle est le nôtre pour appliquer la prédiction
    const isPlayer1 = players.player1?.id === this.userId;

    // Paddle 1 : utiliser prédiction si c'est notre paddle et qu'on bouge
    const p1Y_raw = (isPlayer1 && this.localPaddleY !== null) ? this.localPaddleY : paddle1.y;
    const p1X = Math.floor((paddle1.x / 800) * width);
    const p1Y = Math.floor((p1Y_raw / 600) * height);
    const p1H = Math.floor((paddle1.height / 600) * height);

    // Paddle 2 : utiliser prédiction si c'est notre paddle et qu'on bouge
    const p2Y_raw = (!isPlayer1 && this.localPaddleY !== null) ? this.localPaddleY : paddle2.y;
    const p2X = Math.floor((paddle2.x / 800) * width);
    const p2Y = Math.floor((p2Y_raw / 600) * height);
    const p2H = Math.floor((paddle2.height / 600) * height);

    // Dessiner paddle 1
    for (let i = 0; i < p1H && (p1Y + i) < height; i++) {
      if (p1X >= 0 && p1X < width && (p1Y + i) >= 0) {
        field[p1Y + i][p1X] = '█';
      }
    }

    // Dessiner paddle 2
    for (let i = 0; i < p2H && (p2Y + i) < height; i++) {
      if (p2X >= 0 && p2X < width && (p2Y + i) >= 0) {
        field[p2Y + i][p2X] = '█';
      }
    }

    // Dessiner la balle
    const ballX = Math.floor((ball.x / 800) * width);
    const ballY = Math.floor((ball.y / 600) * height);
    if (ballX >= 0 && ballX < width && ballY >= 0 && ballY < height) {
      field[ballY][ballX] = '●';
    }

    // Construire tout le frame dans un buffer
    let output = '';

    // Repositionner le curseur en haut à gauche sans effacer (évite le scintillement)
    output += '\x1b[H';

    const p1Name = players.player1?.username || 'Player 1';
    const p2Name = players.player2?.username || 'Player 2';

    const margin = ' '.repeat(leftMargin);

    // Espaces en haut
    for (let i = 0; i < topMargin; i++) {
      output += '\x1b[K\n'; // Effacer la ligne avant de passer à la suivante
    }

    // En-tête avec score en blanc centré par rapport au cadre
    const scoreText = `${p1Name} ${paddle1.score} - ${paddle2.score} ${p2Name}`;
    const scorePadding = Math.floor((width - scoreText.length) / 2);
    output += margin + ' '.repeat(scorePadding) + `${white}${scoreText}${reset}\x1b[K\n`;

    // Bordure supérieure arc-en-ciel
    const segmentSize = Math.ceil(width / rainbowColors.length);
    let topBorder = margin + rainbowColors[0] + '╔';
    for (let i = 0; i < width; i++) {
      const colorIndex = Math.floor(i / segmentSize) % rainbowColors.length;
      topBorder += rainbowColors[colorIndex] + '═';
    }
    topBorder += rainbowColors[rainbowColors.length - 1] + '╗' + reset;
    output += topBorder + '\x1b[K\n';

    // Terrain de jeu avec bordures arc-en-ciel latérales
    field.forEach((row, index) => {
      const leftColorIndex = Math.floor(index / (height / rainbowColors.length)) % rainbowColors.length;
      const rightColorIndex = Math.floor(index / (height / rainbowColors.length)) % rainbowColors.length;

      output += margin +
        rainbowColors[leftColorIndex] + '║' + reset +
        white + row.join('') + reset +
        rainbowColors[rightColorIndex] + '║' + reset + '\x1b[K\n';
    });

    // Bordure inférieure arc-en-ciel
    let bottomBorder = margin + rainbowColors[0] + '╚';
    for (let i = 0; i < width; i++) {
      const colorIndex = Math.floor(i / segmentSize) % rainbowColors.length;
      bottomBorder += rainbowColors[colorIndex] + '═';
    }
    bottomBorder += rainbowColors[rainbowColors.length - 1] + '╝' + reset;
    output += bottomBorder + '\x1b[K\n';

    // Ligne vide pour séparer
    output += '\x1b[K\n';

    // Contrôles en blanc centrés par rapport au cadre
    const controlsText = '↑: Up | ↓: Down | ESC or Q: Quit';
    const controlsPadding = Math.floor((width - controlsText.length) / 2);
    output += margin + ' '.repeat(controlsPadding) + `${white}${controlsText}${reset}\x1b[K`;

    // Écrire tout le frame d'un coup
    process.stdout.write(output);
  }

  /* Affiche un message de statut formaté dans le terminal. */
  private showStatus(message: string): void {
    console.log(`\n\x1b[36m${message}\x1b[0m\n`);
  }

  /* Nettoie les ressources et restaure l'état normal du terminal avant de quitter. */
  public cleanup(message?: string | null): void {
    this.currentDirection = null;
    
    if (this.inputInterval) {
      clearInterval(this.inputInterval);
      this.inputInterval = null;
    }
    
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = null;
    }
    
    if (this.currentGameId) {
      this.ws.send('game:leave', { gameId: this.currentGameId });
    }
    this.ws.disconnect();
    
    // Restaurer terminal normal et curseur
    process.stdout.write('\x1b[?1049l\x1b[?25h');
    
    // Restaurer le terminal proprement
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    
    // Effacer l'écran et afficher un message de sortie
    console.clear();
    process.stdout.write('\x1b[2J\x1b[H');
    
    // Afficher le message seulement si fourni (undefined = message par défaut, null = pas de message)
    if (message === undefined) {
      console.log('\n\x1b[97m✓ Game exited. Thanks for playing!\x1b[0m\n');
    } else if (message !== null) {
      console.log(`\n${message}\n`);
    }
  }
}