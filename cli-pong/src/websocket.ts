// cli-pong/src/websocket.ts
import WebSocket from 'ws';

export interface GameState {
  gameId: string;
  ball: { x: number; y: number; vx: number; vy: number; radius: number };
  paddle1: { x: number; y: number; width: number; height: number; score: number };
  paddle2: { x: number; y: number; width: number; height: number; score: number };
  gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
  players: {
    player1?: { id: number; username: string };
    player2?: { id: number; username: string };
  };
}

export type MessageHandler = (type: string, data: any) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(private url: string, private token: string) {}

  /* Établit la connexion WebSocket avec le serveur en utilisant le token d'authentification. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}?token=${this.token}`;
      this.ws = new WebSocket(wsUrl, {
        rejectUnauthorized: false
      });

     this.ws.on('open', () => {
        console.log('✓ Connected to server');
        this.reconnectAttempts = 0;
        
        // Attendre 300ms avant de demander la liste (laisser le temps au serveur d'enregistrer la présence)
        setTimeout(() => {
          this.send('presence:list', {});
        }, 300);
        
        resolve();
      });
      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message.type, message.data || message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('✗ Disconnected from server');
        this.attemptReconnect();
      });
    });
  }

  /* Tente de reconnecter automatiquement au serveur après une déconnexion. */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Please restart.');
      process.exit(1);
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => {});
    }, 2000 * this.reconnectAttempts);
  }

  /* Enregistre un gestionnaire pour un type de message spécifique. */
  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  /* Distribue le message reçu à tous les gestionnaires enregistrés pour ce type. */
  private handleMessage(type: string, data: any): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach(handler => handler(type, data));
    }
  }

  /* Envoie un message au serveur via la connexion WebSocket. */
  send(type: string, data: any = {}): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.error('WebSocket not connected');
    }
  }

  /* Ferme la connexion WebSocket et nettoie les ressources. */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}