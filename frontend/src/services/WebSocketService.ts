// frontend/src/services/WebSocketService.ts

import {
	ChatMessage,
	ChatGlobalMessageData,
	ChatPrivateMessageData,
	ConversationType,
	UserNotification,
	NotificationUpdateData,
	FriendRequestData,
	BlockUserData,
	GameChallengeData
} from '../core/interfaces';

/* Limitation des caractères côté client – doit matcher le backend */
export const CHAT_MESSAGE_MAX_CHARS = 500;

export class WebSocketService {
	private socket: WebSocket | null = null;
	private messageHandlers: Map<string, Function[]> = new Map();
	private chatBuffer: any[] = [];
	private authToken: string | null = null;

	/* Keep-alive WebSocket : identifiant de l'intervalle (heartbeat) */
	private heartbeatId: number | null = null;

	/* Auto-reconnect simple */
	private reconnectAttempts: number = 0;
	private reconnectTimer: number | null = null;

	/* Anti-flapping / shutdown propre lors d'un refresh/close de l'onglet */
	private isShuttingDown = false;
	/* Empêche la reconnexion après une déconnexion volontaire (logout, manual) */
	private preventReconnect = false;

	/* File d'attente pour messages émis avant l'ouverture réelle du WS */
	private outbox: any[] = [];

	/* Promesse résolue quand le WS est réellement ouvert (anti-race) */
	private readyPromise: Promise<void> | null = null;
	private readyResolve: (() => void) | null = null;

	/* Throttling/Dedup HTTP → éviter 429 (proxy/WAF) sur friends endpoints */
	private friendsFetchInFlight: Promise<void> | null = null;
	private friendReqsFetchInFlight: Promise<void> | null = null;
	private friendsLastFetchAt = 0;
	private friendReqsLastFetchAt = 0;
	private readonly friendsMinIntervalMs = 700; // fenêtre anti-rafale
	private readonly handleGuestAliasUpdated = (event: Event) => {
		try {
			const detail = (event as CustomEvent<{ alias?: string }>).detail;
			this.sendGuestAlias(detail?.alias);
		} catch (e) {
			console.warn('[WSS] Failed to process guest alias event:', e);
		}
	};

	constructor() {
		/* Initialisation de session unique par onglet */
		this.initializeSession();
		window.addEventListener('guest-alias-updated', this.handleGuestAliasUpdated);

		/* E: on désactive toute reconnexion ou envois pendant un refresh onglet */
		window.addEventListener('beforeunload', () => {
			this.isShuttingDown = true;
			this.preventReconnect = true;
			try { this.socket?.close(); } catch { }
			if (this.heartbeatId) { clearInterval(this.heartbeatId); this.heartbeatId = null; }
			if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
		});

		try { this.authToken = this.getToken(); } catch { }
	}

	/* Initialise une session unique par onglet */
	private initializeSession(): void {
		try {
			// Nettoyer localStorage au démarrage pour éviter les conflits entre onglets
			localStorage.removeItem('token');
			
			// Générer un ID de session unique pour cet onglet
			if (!sessionStorage.getItem('sessionId')) {
				const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2);
				sessionStorage.setItem('sessionId', sessionId);
				console.log('Session initialisée:', sessionId);
			}
		} catch (e) {
			console.warn('Session initialization failed:', e);
		}
	}

	private sendGuestAlias(alias?: string | null): void {
		let nextAlias = alias;
		if (!nextAlias) {
			try {
				nextAlias = sessionStorage.getItem('guest_tournament_alias');
			} catch { nextAlias = null; }
		}
		if (!nextAlias || !nextAlias.trim()) {
			return;
		}
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			return;
		}
		try {
			console.log('[WSS] 🔄 Sending guest alias to backend:', nextAlias);
			this.socket.send(JSON.stringify({ type: 'guest:update_alias', data: { alias: nextAlias } }));
		} catch (e) {
			console.warn('[WSS] Failed to send guest alias:', e);
		}
	}

	/* Helpers de token publics avec synchronisation */
	public setAuthToken(token: string | null): void {
		this.authToken = token;
		try {
			if (token) {
				// Sauvegarder dans sessionStorage ET garder une copie en mémoire
				sessionStorage.setItem('token', token);
				// Nettoyer localStorage pour éviter les conflits
				localStorage.removeItem('token');
				console.log('[WSS] Auth token saved to sessionStorage');
			} else {
				sessionStorage.removeItem('token');
				localStorage.removeItem('token');
				console.log('[WSS] Auth token cleared');
			}
		} catch (e) {
			console.error('[WSS] Failed to save token:', e);
		}
	}

	public getAuthToken(): string | null {
		return this.authToken;
	}

	/* Récupère le token avec fallback robuste (supporte guest tokens) */
	private getToken(): string | null {
		// 1. Priorité à la copie en mémoire
		if (this.authToken) {
			return this.authToken;
		}
		
		try {
			// 2. Tenter sessionStorage (user token)
			const sessionToken = sessionStorage.getItem('token');
			if (sessionToken) {
				this.authToken = sessionToken;
				console.log('[WSS] Token loaded from sessionStorage');
				return sessionToken;
			}
			
			// 3. Fallback localStorage (pour compatibilité)
			const localToken = localStorage.getItem('token');
			if (localToken) {
				this.authToken = localToken;
				// Migrer vers sessionStorage
				sessionStorage.setItem('token', localToken);
				localStorage.removeItem('token');
				console.log('[WSS] Token migrated from localStorage to sessionStorage');
				return localToken;
			}
			
			// 4. Vérifier si c'est un guest (guest token)
			const guestToken = sessionStorage.getItem('guest_tournament_token');
			if (guestToken) {
				this.authToken = guestToken;
				console.log('[WSS] Guest token loaded from sessionStorage');
				return guestToken;
			}
		} catch (e) {
			console.error('[WSS] Error reading token:', e);
		}
		
		return null;
	}

	/* Nettoie les tokens de façon isolée */
	private clearToken(): void {
		this.authToken = null;
		try {
			sessionStorage.removeItem('token');
			localStorage.removeItem('token');
		} catch { }
	}

  /* Helpers validation chat */

  private sanitizeAndValidateContent(raw: string): { ok: true; content: string } | { ok: false; error: string } {
    const trimmed = (raw ?? '').trim();
    if (trimmed.length === 0) return { ok: false, error: 'Message content cannot be empty' };
    if (trimmed.length > CHAT_MESSAGE_MAX_CHARS) {
      return { ok: false, error: `Message too long (max ${CHAT_MESSAGE_MAX_CHARS} characters)` };
    }
    return { ok: true, content: trimmed };
  }

  /* Emet un event local d'erreur chat */
  private emitChatError(message: string) {
    const handlers = this.messageHandlers.get('chat:error');
    if (handlers?.length) handlers.forEach(h => { try { h({ type: 'chat:error', message }); } catch {} });
    else console.warn('chat:error', message);
  }

  /* MÉTHODES CHAT GLOBAL */

  /* Envoie un message dans le chat global */
  public sendGlobalMessage(content: string, messageType: string = 'text'): void {
    const v = this.sanitizeAndValidateContent(content);
    if (!v.ok) { this.emitChatError(v.error); return; }
    const data: ChatGlobalMessageData = { content: v.content, messageType };
    this.sendMessage({ type: 'chat:global_message', data });
  }

  /* MÉTHODES CHAT PRIVÉ - CORRIGÉ */

  /* Envoie un message privé via WebSocket avec le bon type */
  public sendPrivateMessage(recipientId: number, content: string, messageType: string = 'text', metadata?: string): void {
    const v = this.sanitizeAndValidateContent(content);
    if (!v.ok) { this.emitChatError(v.error); return; }
    
    const data: ChatPrivateMessageData = { 
      recipientId, 
      content: v.content, 
      messageType, 
      metadata 
    };
    
    console.log('[WSS] ✅ Sending private message via WebSocket:', data);
    
    // Utiliser 'chat:private_message' au lieu de 'chat:send_message'
    this.sendMessage({ type: 'chat:private_message', data });
  }

	/* Envoie un indicateur de frappe */
	public sendTypingIndicator(recipientId: number, isTyping: boolean = true): void {
		this.sendMessage({
			type: 'chat:typing',
			data: { recipientId, isTyping }
		});
	}

	/* Envoie une invitation de jeu via chat */
	public sendGameInvitation(recipientId: number): void {
		this.sendMessage({
			type: 'chat:game_invite',
			data: { recipientId }
		});
	}

  /* MÉTHODES ACTIONS SOCIALES */

	/* Envoie une demande d'ami */
	public sendFriendRequest(userId: number, message?: string): void {
		const data: FriendRequestData = { userId, message };
		this.sendMessage({ type: 'friend:request', data });
	}

	/* Bloque un utilisateur */
	public blockUser(userId: number, reason?: string): void {
		const data: BlockUserData = { userId, reason };
		this.sendMessage({ type: 'user:block', data });
	}

	/* Débloque un utilisateur */
	public unblockUser(userId: number): void {
		const data: BlockUserData = { userId };
		this.sendMessage({ type: 'user:unblock', data });
	}

	/* Envoie un défi de jeu */
	public sendGameChallenge(challengedUserId: number, message?: string, gameMode: string = 'classic'): void {
		const data: GameChallengeData = { challengedUserId, message, gameMode };
		this.sendMessage({ type: 'game:challenge', data });
	}

  /* MÉTHODES NOTIFICATIONS */

	/* Marque une notification comme lue */
	public markNotificationAsRead(notificationId: number): void {
		this.sendMessage({
			type: 'notification:read',
			data: { notificationId }
		});
	}

	/* Marque toutes les notifications comme lues */
	public markAllNotificationsAsRead(): void {
		this.sendMessage({
			type: 'notification:read_all',
			data: {}
		});
	}

	/* ===== MÉTHODES HTTP POUR AUTH / 2FA ===== */

	/* Démarre l'enrôlement 2FA, renvoie l'otpauth:// */
	async setupTwoFA(): Promise<{ otpauth_url: string }> {
		const { ok, data } = await this.http('/api/auth/2fa/setup', 'POST', {});
		if (!ok || !data?.otpauth_url) throw new Error(data?.message || '2FA setup failed');
		return data;
	}

	/* Active la 2FA en validant un code TOTP */
	public async activateTwoFA(code: string): Promise<void> {
		const { ok, data } = await this.http('/api/auth/2fa/activate', 'POST', { code });
		if (!ok) throw new Error(data?.message || 'Invalid 2FA code');
	}

	/* Désactive la 2FA pour le compte courant */
	public async disableTwoFA(code: string): Promise<void> {
		const { ok, data } = await this.http(
			'/api/auth/2fa/disable',
			'POST',
			{ code }
		);
		if (!ok) {
			throw new Error(data?.message || 'Failed to disable 2FA');
		}
	}

  /* NOUVELLES MÉTHODES DASHBOARD */

  /* Récupère les statistiques complètes pour le dashboard */
  public async getDashboardStats(): Promise<void> {
    try {
      const { ok, data } = await this.http('/api/auth/dashboard/stats');
      
      if (ok) {
        this.handleMessage({ 
          type: 'dashboard:stats_loaded', 
          dashboard: data.dashboard 
        });
      } else {
        this.handleMessage({ 
          type: 'dashboard:stats_error', 
          error: data.message || 'Failed to load dashboard stats' 
        });
      }
    } catch (error: any) {
      console.error('Get dashboard stats error:', error);
      this.handleMessage({ 
        type: 'dashboard:stats_error', 
        error: 'Failed to load dashboard stats' 
      });
    }
  }

  /* Méthode helper pour rafraîchir les stats du dashboard après une partie */
  public refreshDashboardStats(): void {
    this.getDashboardStats();
  }

  /* ============ MÉTHODES HTTP POUR CHAT ============ */

	/* Récupère les conversations de l'utilisateur */
	public async getChatConversations(): Promise<any[]> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch('/api/chat/conversations', {
				method: 'GET',
				headers
			});

			if (!response.ok) throw new Error('Failed to fetch conversations');

			const data = await response.json();
			return data.conversations || [];
		} catch (error: any) {
			console.error('Error fetching conversations:', error);
			return [];
		}
	}

	/* Récupère les messages d'une conversation */
	public async getChatMessages(conversationId: number, limit: number = 50, offset: number = 0): Promise<ChatMessage[]> {
		try {
			const headers = this.getAuthHeaders();
			const url = conversationId === 1
				? `/api/chat/global?limit=${limit}&offset=${offset}`
				: `/api/chat/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`;

			const response = await fetch(url, {
				method: 'GET',
				headers
			});

			if (!response.ok) throw new Error('Failed to fetch messages');

			const data = await response.json();
			return data.messages || [];
		} catch (error: any) {
			console.error('Error fetching messages:', error);
			return [];
		}
	}

  /* MÉTHODES HTTP CONSERVÉES POUR FALLBACK/DEBUG */

  /* Envoie un message via HTTP (fallback si WebSocket échoue) */
  public async sendChatMessageHTTP(recipientId: number, content: string, messageType: string = 'text'): Promise<boolean> {
    const v = this.sanitizeAndValidateContent(content);
    if (!v.ok) { this.emitChatError(v.error); return false; }

    try {
      const headers = this.getAuthHeaders();
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ recipientId, content: v.content, messageType })
      });
      
      if (!response.ok) {
        const errText = await response.text().catch(()=>'');
        this.emitChatError(`Send failed (${response.status}) ${errText ? ' - ' + errText : ''}`);
      }
      return response.ok;
    } catch (error: any) {
      console.error('Error sending message via HTTP:', error);
      this.emitChatError('Network error while sending message');
      return false;
    }
  }

  /* Envoie un message global via HTTP (fallback) */
  public async sendGlobalMessageHTTP(content: string, messageType: string = 'text'): Promise<boolean> {
    const v = this.sanitizeAndValidateContent(content);
    if (!v.ok) { this.emitChatError(v.error); return false; }

    try {
      const headers = this.getAuthHeaders();
      const response = await fetch('/api/chat/global', {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: v.content, messageType })
      });
      
      if (!response.ok) {
        const errText = await response.text().catch(()=>'');
        this.emitChatError(`Send failed (${response.status}) ${errText ? ' - ' + errText : ''}`);
      }
      return response.ok;
    } catch (error: any) {
      console.error('Error sending global message via HTTP:', error);
      this.emitChatError('Network error while sending message');
      return false;
    }
  }

  /* MÉTHODES HTTP POUR INTERACTIONS SOCIALES */

	/* Envoie une demande d'ami via HTTP */
	public async sendFriendRequestHTTP(userId: number, message?: string): Promise<boolean> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch('/api/chat/friend-request', {
				method: 'POST',
				headers,
				body: JSON.stringify({ userId, message })
			});

			return response.ok;
		} catch (error: any) {
			console.error('Error sending friend request via HTTP:', error);
			return false;
		}
	}

	/* Bloque un utilisateur via HTTP */
	public async blockUserHTTP(userId: number, reason?: string): Promise<boolean> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch('/api/chat/block', {
				method: 'POST',
				headers,
				body: JSON.stringify({ userId, reason })
			});

			return response.ok;
		} catch (error: any) {
			console.error('Error blocking user via HTTP:', error);
			return false;
		}
	}

	/* Débloque un utilisateur via HTTP */
	public async unblockUserHTTP(userId: number): Promise<boolean> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch(`/api/chat/block/${userId}`, {
				method: 'DELETE',
				headers
			});

			return response.ok;
		} catch (error: any) {
			console.error('Error unblocking user via HTTP:', error);
			return false;
		}
	}

	/* Envoie un défi de jeu via HTTP */
	public async sendGameChallengeHTTP(challengedUserId: number, message?: string, gameMode: string = 'classic'): Promise<boolean> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch('/api/chat/game-challenge', {
				method: 'POST',
				headers,
				body: JSON.stringify({ challengedUserId, message, gameMode })
			});

			return response.ok;
		} catch (error: any) {
			console.error('Error sending game challenge via HTTP:', error);
			return false;
		}
	}

  /* MÉTHODES HTTP POUR NOTIFICATIONS */

	/* Récupère les notifications de l'utilisateur */
	public async getNotifications(limit: number = 20, unreadOnly: boolean = false): Promise<{ notifications: UserNotification[], unreadCount: number }> {
		try {
			const headers = this.getAuthHeaders();
			const url = `/api/chat/notifications?limit=${limit}&unread=${unreadOnly}`;

			const response = await fetch(url, {
				method: 'GET',
				headers
			});

			if (!response.ok) throw new Error('Failed to fetch notifications');

			const data = await response.json();
			return {
				notifications: data.notifications || [],
				unreadCount: data.unreadCount || 0
			};
		} catch (error: any) {
			console.error('Error fetching notifications:', error);
			return { notifications: [], unreadCount: 0 };
		}
	}

	/* Marque une notification comme lue via HTTP */
	public async markNotificationAsReadHTTP(notificationId: number): Promise<boolean> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch(`/api/chat/notifications/${notificationId}/read`, {
				method: 'PUT',
				headers
			});

			return response.ok;
		} catch (error: any) {
			console.error('Error marking notification as read via HTTP:', error);
			return false;
		}
	}

	/* Marque toutes les notifications comme lues via HTTP */
	public async markAllNotificationsAsReadHTTP(): Promise<boolean> {
		try {
			const headers = this.getAuthHeaders();
			const response = await fetch('/api/chat/notifications/read-all', {
				method: 'PUT',
				headers
			});

			return response.ok;
		} catch (error: any) {
			console.error('Error marking all notifications as read via HTTP:', error);
			return false;
		}
	}

  /* MÉTHODES EXISTANTES (compat) */

	// Méthode challengeUser modifiée pour accepter les métadonnées de tournoi
	public challengeUser(userId: number, tournamentId?: number, matchId?: number): void {
		console.log('[WSS] ✅ challengeUser called', {
			userId,
			tournamentId,
			matchId,
			hasTournamentContext: !!(tournamentId !== undefined && matchId !== undefined)
		});

		// Construire le payload de base
		const data: any = { 
			challengedUserId: userId 
		};

		// Si des métadonnées de tournoi sont fournies, les ajouter
		if (tournamentId !== undefined && matchId !== undefined) {
			data.tournamentId = tournamentId;
			data.matchId = matchId;
			console.log('[WSS] ✅ Including tournament metadata in challenge:', {
				tournamentId,
				matchId
			});
		} else {
			console.log('[WSS] ℹ️ Standard challenge (no tournament context)');
		}

		console.log('[WSS] ✅ Sending game:challenge message with payload:', data);
		
		// Envoyer le message WebSocket
		this.sendMessage({ 
			type: 'game:challenge', 
			data 
		});
	}

	/* Stocke le token JWT (session uniquement) - MODIFIÉ */
	private setToken(token: string): void {
		this.setAuthToken(token);
	}

	/* Demande la liste GLOBALE des utilisateurs en ligne (réponse: presence:list) */
	public requestOnlineUsers(): void {
		this.sendMessage({ type: 'presence:list', data: {} });
	}

	/* Crée une partie avec un adversaire */
	public createRemoteGame(opponentId: number): void {
		this.sendMessage({ type: 'game:create', data: { opponentId, gameMode: 'classic' } });
	}

	/* Rejoint une partie existante */
	public joinRemoteGame(gameId: string): void {
		this.sendMessage({ type: 'game:join', data: { gameId } });
	}

	/* Envoie les entrées de contrôle du joueur */
	public sendGameInput(gameId: string, action: 'up' | 'down' | 'stop'): void {
		this.sendMessage({ type: 'game:input', data: { gameId, action } });
	}

	/* Quitte la partie en cours */
	public leaveRemoteGame(): void {
		this.sendMessage({ type: 'game:leave', data: {} });
	}

	/* Refus d'un challenge AVANT création de partie (joueur défié refuse l'invitation initiale) */
	public declineChallenge(challengerId: number): void {
		this.sendMessage({ type: 'game:challenge_declined', data: { challengerId } });
	}
	
	/* Annule un challenge envoyé tant qu'il n'a pas été accepté */
	public cancelChallenge(challengedUserId: number): void {
		this.sendMessage({ type: 'game:challenge_cancel', data: { challengedUserId } });
	}

	/* Refus de rejoindre une partie DÉJÀ CRÉÉE par l'invité (cas demandé : l'invitant décline) */
	public declineJoin(gameId: string): void {
		this.sendMessage({ type: 'game:join_decline', data: { gameId } });
	}

	/* Indique si le socket est actuellement ouvert */
	public isConnected(): boolean {
		return !!this.socket && this.socket.readyState === WebSocket.OPEN;
	}

	/* Promesse qui se résout dès que le WS est ouvert (utile pour attendre avant d'envoyer) */
	public async onceConnected(): Promise<void> {
		if (this.isConnected()) return;
		if (this.readyPromise) return this.readyPromise;
		this.readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve; });
		// Si pas encore lancé, on tente une connexion douce
		if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
			const canTryConnect = !this.isShuttingDown && !!this.getToken();
			if (canTryConnect) this.connect().catch(() => { });
		}
		return this.readyPromise;
	}

  /* Reconnexion forcée pour guests */
  async connect(forceReconnect: boolean = false): Promise<void> {
    try {
			// Une demande explicite de connexion lève l'interdiction de reconnecter
			this.preventReconnect = false;
      /* A: Si reconnexion forcée, fermer la connexion existante */
      if (forceReconnect && this.socket) {
        console.log('[WSS] 🔄 Force reconnect requested, closing existing socket');
        try {
          this.socket.close();
        } catch (e) {
          console.warn('[WSS] Error closing socket:', e);
        }
        this.socket = null;
        this.readyPromise = null;
        this.readyResolve = null;
				// reset backoff on explicit force reconnect
				if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
				this.reconnectAttempts = 0;
      }
      
      /* B: connexion unique – si OPEN ou CONNECTING, ne rien faire */
      if (!forceReconnect && this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
        console.log('[WSS] WebSocket already connected or connecting');
        return;
      }
      
      if (this.isShuttingDown) {
        console.log('[WSS] Shutdown in progress, skipping connection');
        return;
      }

			// Vérifier que le token est disponible
			const token = this.getToken();
			if (!token) {
				console.warn('[WSS] No token available for WebSocket connection');
				return;
			}

      /* C: normaliser l'URL : uniquement /ws (jamais "/") et toujours wss en HTTPS */
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const host = location.host || 'localhost:3443';
      const url = `${proto}://${host}/ws?token=${encodeURIComponent(token)}`;

			console.log('[WSS] Connecting to WebSocket with token:', token.substring(0, 20) + '...');
			console.log('[WSS] WebSocket URL:', url);

			this.socket = new WebSocket(url);

			this.socket.onopen = () => {
				console.log('[WSS] WebSocket connected to backend');

				// reset auto-reconnect state
				if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
				this.reconnectAttempts = 0;

				/* D: bootstrap déterministe après ouverture */
				try {
					this.socket?.send(JSON.stringify({ type: 'presence:list', data: {} }));
				} catch { }

				/* Envoyer l'alias guest même sans reconnexion */
				this.sendGuestAlias();

				/* E: flush de la file d'attente (messages envoyés avant open) */
				if (this.outbox.length) {
					const pending = this.outbox.splice(0, this.outbox.length);
					console.log(`[WSS] Flushing ${pending.length} queued messages`);
					for (const msg of pending) {
						try { this.socket?.send(JSON.stringify(msg)); } catch { }
					}
				}

				/* Résout onceConnected() si des consommateurs attendent */
				try { this.readyResolve?.(); } finally { this.readyResolve = null; this.readyPromise = null; }

				/* Heartbeat keep-alive */
				if (this.heartbeatId) { clearInterval(this.heartbeatId); this.heartbeatId = null; }
				this.heartbeatId = setInterval(() => {
					try { this.socket?.send(JSON.stringify({ type: 'ping' })); } catch { }
				}, 25000) as any;
			};

			this.socket.onmessage = (event) => {
				try { this.handleMessage(JSON.parse(event.data)); }
				catch (error: any) { console.error('[WSS] Error parsing message:', error, 'raw=', event.data); }
			};

			this.socket.onclose = (ev) => {
				console.log(`[WSS] WebSocket closed (code=${ev.code}, reason="${ev.reason}")`);
				if (this.heartbeatId) { clearInterval(this.heartbeatId); this.heartbeatId = null; }
				this.readyResolve = null; this.readyPromise = null;

				// planifier une reconnexion simple si pas en shutdown
				this.scheduleReconnect();
			};

			this.socket.onerror = (error) => { 
				console.error('[WSS] WebSocket error:', error); 
			};

		} catch (error: any) {
			console.error('[WSS] Failed to establish WebSocket connection:', error);
			// Nettoyer l'état en cas d'erreur
			this.readyResolve = null;
			this.readyPromise = null;
		}
	}

	/* Planifie une reconnexion avec backoff simple (500ms * 2^n, max 10s) */
	private scheduleReconnect(): void {
		try {
			if (this.isShuttingDown || this.preventReconnect) return;
			const token = this.getToken();
			if (!token) { console.warn('[WSS] Skip reconnect (no token)'); return; }
			if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;

			const delay = Math.min(10000, 500 * Math.pow(2, this.reconnectAttempts));
			this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 10);

			if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
			console.log(`[WSS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
			this.reconnectTimer = setTimeout(() => {
				this.connect().catch(() => { /* noop */ });
			}, delay) as any;
		} catch (e) {
			console.warn('[WSS] Failed to schedule reconnect:', e);
		}
	}

	/* Gère la distribution des messages reçus aux handlers */
	private handleMessage(message: any): void {
		try {
			if (!message || typeof message !== 'object') { console.warn('[WSS] Invalid message format:', message); return; }
			const rawType = (message as any).type; if (typeof rawType !== 'string' || rawType.trim() === '') { console.warn('[WSS] Message without type:', message); return; }
			const type = rawType.trim();

			if (type.startsWith('chat:')) console.log('[WSS] Chat message:', type, message);
			if (type === 'chat:message' || type === 'chat:global_message' || type === 'chat:private_message') {
				this.chatBuffer.push(message);
			}

			const handlers = this.messageHandlers.get(type);
			if (!handlers?.length) { console.debug(`[WSS] No handler for "${type}"`); return; }
			for (const handler of handlers) { try { handler(message); } catch (err: any) { console.error(`[WSS] Handler error for "${type}":`, err); } }
		} catch (err: any) { console.error('[WSS] handleMessage failure:', err, 'message=', message); }
	}

	/* Ajoute un handler pour un type de message donné */
	public onMessage(type: string, handler: Function): void {
		if (!this.messageHandlers.has(type)) this.messageHandlers.set(type, []);
		this.messageHandlers.get(type)!.push(handler);
	}

	/* Nettoie tous les handlers de messages (à appeler lors du logout) */
	public clearMessageHandlers(): void {
		console.log('[WSS] Clearing all message handlers');
		this.messageHandlers.clear();
	}

	/* Nettoie les files de messages et buffers (à appeler lors du logout) */
	public clearMessageQueues(): void {
		console.log('[WSS] Clearing message queues and buffers');
		this.outbox.length = 0;
		this.chatBuffer.length = 0;
	}

	/* Cleanup complet pour transition de session (Guest ↔ User) */
	public fullSessionCleanup(): void {
		console.log('[WSS] Full session cleanup');
		this.clearMessageHandlers();
		this.clearMessageQueues();
		this.disconnect();
		this.clearToken();
		try {
			sessionStorage.clear();
			localStorage.removeItem('token');
		} catch { }
	}

	/* Retourne une copie des messages de chat reçus (sans vider le buffer) */
	public peekChatBuffer(): any[] { return this.chatBuffer.slice(); }

	/* Retourne les messages de chat reçus et vide le buffer */
	public drainChatBuffer(): any[] { const out = this.chatBuffer.slice(); this.chatBuffer.length = 0; return out; }

	/* Envoie un message via le WebSocket (générique) */
	public sendMessage(message: any): void {
		/* D: si non connecté, on bufferise pour envoi automatique au onopen() */
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			console.warn('[WSS] WebSocket not connected, buffering message');
			this.outbox.push(message);

			/* Correctif: tenter une (re)connexion douce si possible */
			const canTryConnect =
				!this.isShuttingDown &&
				(!!this.getToken()) &&
				(!this.socket || this.socket.readyState === WebSocket.CLOSED);
			if (canTryConnect) {
				this.connect().catch(() => { });
			}
			return;
		}
		try { this.socket.send(JSON.stringify(message)); } catch (e: any) { console.error('[WSS] Send error:', e); }
	}

	/* Envoie un message de chat au backend (DÉPRÉCIÉ - utiliser sendPrivateMessage) */
	public sendChatMessage(toUserId: number, content: string): void {
		this.sendPrivateMessage(toUserId, content);
	}

	/* Helper HTTP générique avec gestion d'erreurs robuste */
	private async http(
		url: string,
		method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
		body?: any
	): Promise<{ ok: boolean; data: any }> {
		// Récupérer le token à chaque fois pour éviter les tokens périmés
		const token = this.getToken();
		if (!token) {
			console.error('[WSS] No token available for HTTP request');
			throw new Error('No authentication token');
		}

		// Headers robustes avec Content-Type approprié
		const headers: HeadersInit = {
			'Content-Type': 'application/json'
		};
		
		// Ajouter le token seulement s'il existe
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		console.log(`[WSS] HTTP ${method} ${url} with token:`, token.substring(0, 20) + '...');

		try {
			const requestConfig: RequestInit = {
				method,
				headers
			};

			if (body && (method === 'POST' || method === 'PUT')) {
				requestConfig.body = JSON.stringify(body);
			}

			const res = await fetch(url, requestConfig);

			console.log(`[WSS] HTTP ${method} ${url} response:`, res.status, res.statusText);

			if (res.status === 429) {
				const raw = res.headers.get('Retry-After');
				let seconds = 5;

				if (raw) {
					const n = Number(raw);
					if (Number.isFinite(n) && n > 0) {
					seconds = n;
					} else {
					const t = Date.parse(raw);
					if (!Number.isNaN(t)) {
						const delta = Math.ceil((t - Date.now()) / 1000);
						if (delta > 0) seconds = Math.min(delta, 120);
					}
					}
				}

				this.handleMessage({
					type: 'rate_limited',
					scope: url,
					retryAfter: seconds
				});
			}

			let data: any = {};
			const ct = (res.headers.get('content-type') || '').toLowerCase();
			const isJson = ct.includes('application/json');
			const responseText = await res.text().catch(() => '');
			if (responseText && isJson) {
				try {
					data = JSON.parse(responseText);
				} catch (parseError) {
					console.warn('[WSS] Failed to parse JSON response:', parseError);
					data = {};
				}
			} else if (responseText && !isJson) {
				data = { message: responseText.slice(0, 200) };
			}

			return { ok: res.ok, data };
		} catch (error: any) {
			console.error(`[WSS] HTTP ${method} ${url} failed:`, error);
			throw error;
		}
	}

	/* Envoie une requête de connexion (login) au backend */
	public async login(username: string, password: string): Promise<void> {
		try {
			console.log('[WSS] Sending login request to backend...');
			const res = await fetch('/api/auth/login', { 
				method: 'POST', 
				headers: { 'Content-Type': 'application/json' }, 
				body: JSON.stringify({ username, password }) 
			});
			
			const data = await res.json(); 
			console.log('[WSS] Login response status:', res.status, 'data:', data);
			
			if (res.ok) { 
				this.setToken(data.token);
				try { await import('../core/I18n').then(m => m.i18n.loadInitialLanguage()); } catch {}
				this.handleMessage({ type: 'auth_success', user: data.user }); 
			} else {
				this.handleMessage({ type: 'auth_error', error: data.message, code: data.code });
			}
		} catch (error: any) { 
			console.error('[WSS] Login error:', error); 
			this.handleMessage({ type: 'auth_error', error: 'Connection failed: ' + error }); 
		}
	}

	/* Envoie une requête d'inscription (register) au backend */
	public async register(username: string, password: string): Promise<void> {
		try {
			console.log('[WSS] Sending register request to backend...');
			const res = await fetch('/api/auth/register', { 
				method: 'POST', 
				headers: { 'Content-Type': 'application/json' }, 
				body: JSON.stringify({ username, password }) 
			});
			
			const data = await res.json(); 
			console.log('[WSS] Response status:', res.status, 'data:', data);
			
			if (res.ok) { 
				this.setToken(data.token);
				try { await import('../core/I18n').then(m => m.i18n.loadInitialLanguage()); } catch {}
				this.handleMessage({ type: 'auth_success', user: data.user }); 
			} else {
				this.handleMessage({ type: 'auth_error', error: data.message, code: data.code });
			}
		} catch (error: any) { 
			console.error('[WSS] Register error:', error); 
			this.handleMessage({ type: 'auth_error', error: 'Connection failed: ' + error }); 
		}
	}

	/* Déconnecte l'utilisateur proprement avec nettoyage session */
	public async logout(): Promise<void> {
		try { 
			this.preventReconnect = true;
			try { await this.disconnectAndWait(); } catch { }
			await this.http('/api/auth/logout', 'POST');
		} catch (e: any) { 
			console.error('[WSS] Logout error:', e);
		} finally { 
			this.disconnect(); 
			this.clearToken(); 
			try {
				sessionStorage.clear();
				localStorage.removeItem('token');
			} catch { }
			this.handleMessage({ type: 'auth_logout' }); 
		}
	}

	/* Récupère les informations du profil utilisateur connecté */
	public async getCurrentUser(): Promise<any> {
		try {
			const { ok, data } = await this.http('/api/auth/me');
			if (ok) { 
				this.handleMessage({ type: 'user_profile_loaded', user: data.user }); 
				return data.user; 
			}
			this.handleMessage({ type: 'user_profile_error', error: data.message }); 
			return null;
		} catch (error: any) { 
			console.error('[WSS] Get current user error:', error); 
			this.handleMessage({ type: 'user_profile_error', error: 'Failed to load profile' }); 
			return null; 
		}
	}

	/* Met à jour le profil utilisateur */
	public async updateProfile(updates: { username?: string; email?: string; avatar_url?: string }): Promise<void> {
		try {
			const { ok, data } = await this.http('/api/auth/profile', 'PUT', updates);
			ok ? this.handleMessage({ type: 'profile_updated', user: data.user }) : this.handleMessage({ type: 'profile_update_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Update profile error:', error); 
			this.handleMessage({ type: 'profile_update_error', error: 'Failed to update profile' }); 
		}
	}

	/* Recherche des utilisateurs */
	public async searchUsers(query: string): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/users/search?q=${encodeURIComponent(query)}`);
			ok ? this.handleMessage({ type: 'users_found', users: data.users }) : this.handleMessage({ type: 'users_search_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Search users error:', error); 
			this.handleMessage({ type: 'users_search_error', error: 'Failed to search users' }); 
		}
	}

	/* Envoie une demande d'ami */
	public async addFriend(friendId: number): Promise<void> {
		try {
			const { ok, data } = await this.http('/api/auth/friends/add', 'POST', { friendId });
			ok ? this.handleMessage({ type: 'friend_request_sent', message: data.message }) : this.handleMessage({ type: 'friend_request_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Add friend error:', error); 
			this.handleMessage({ type: 'friend_request_error', error: 'Failed to send friend request' }); 
		}
	}

	/* Accepte une demande d'ami */
	public async acceptFriend(friendId: number): Promise<{ ok: boolean; message: string }> {
		try {
			const { ok, data } = await this.http('/api/auth/friends/accept', 'POST', { friendId });

			if (!ok) {
				this.handleMessage({ type: 'friend_accept_error', error: data.message });
				return { ok: false, message: data.message };
			}

			// ✅ Dispatch local event for immediate UI update and robustness
			this.handleMessage({ type: 'friend_accepted', message: data.message, friendId });
			// ✅ Refresh lists to ensure consistency even if WS event was missed
			this.getFriends();
			this.getFriendRequests();

			return { ok: true, message: data.message };
		} catch (error: any) {
			console.error('Accept friend error:', error);
			this.handleMessage({ type: 'friend_accept_error', error: 'Failed to accept friend request' });
			return { ok: false, message: 'Failed to accept friend request' };
		}
	}

	/* Supprime un ami */
	public async removeFriend(friendId: number): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/friends/${friendId}`, 'DELETE');
			if (ok) { 
				// ✅ Inclure friendId pour permettre au service d'UI de filtrer
				this.handleMessage({ type: 'friend_removed', message: data?.message || 'Friend removed', friendId }); 
				this.getFriends(); 
			} else {
				this.handleMessage({ type: 'friend_remove_error', error: data.message });
			}
		} catch (error: any) { 
			console.error('[WSS] Remove friend error:', error); 
			this.handleMessage({ type: 'friend_remove_error', error: 'Failed to remove friend' }); 
		}
	}

	/* Refuse une demande d'ami */
	public async declineFriend(friendId: number): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/friends/decline/${friendId}`, 'DELETE');
			if (ok) { 
				this.handleMessage({ type: 'friend_declined', message: data.message, friendId }); 
				this.getFriendRequests(); 
			} else {
				this.handleMessage({ type: 'friend_decline_error', error: data.message });
			}
		} catch (error: any) { 
			console.error('[WSS] Decline friend error:', error); 
			this.handleMessage({ type: 'friend_decline_error', error: 'Failed to decline friend request' }); 
		}
	}

	/* Récupère la liste des amis */
	public async getFriends(): Promise<void> {
		const now = Date.now();
		if (this.friendsFetchInFlight) {
			return; // dédup des appels parallèles
		}
		if (now - this.friendsLastFetchAt < this.friendsMinIntervalMs) {
			// trop rapproché → ignorer gentiment
			return;
		}
		this.friendsLastFetchAt = now;
		this.friendsFetchInFlight = (async () => {
			try {
				const { ok, data } = await this.http('/api/auth/friends');
				ok ? this.handleMessage({ type: 'friends_loaded', friends: data.friends }) : this.handleMessage({ type: 'friends_load_error', error: data.message });
			} catch (error: any) {
				console.error('[WSS] Get friends error:', error);
				this.handleMessage({ type: 'friends_load_error', error: 'Failed to load friends' });
			} finally {
				this.friendsFetchInFlight = null;
				this.friendsLastFetchAt = Date.now();
			}
		})();
		return this.friendsFetchInFlight;
	}

	/* Récupère les demandes d'amis */
	public async getFriendRequests(): Promise<void> {
		const now = Date.now();
		if (this.friendReqsFetchInFlight) {
			return; // dédup
		}
		if (now - this.friendReqsLastFetchAt < this.friendsMinIntervalMs) {
			return;
		}
		this.friendReqsLastFetchAt = now;
		this.friendReqsFetchInFlight = (async () => {
			try {
				const { ok, data } = await this.http('/api/auth/friends/requests');
				ok ? this.handleMessage({ type: 'friend_requests_loaded', requests: data.requests }) : this.handleMessage({ type: 'friend_requests_error', error: data.message });
			} catch (error: any) {
				console.error('[WSS] Get friend requests error:', error);
				this.handleMessage({ type: 'friend_requests_error', error: 'Failed to load friend requests' });
			} finally {
				this.friendReqsFetchInFlight = null;
				this.friendReqsLastFetchAt = Date.now();
			}
		})();
		return this.friendReqsFetchInFlight;
	}

	/* Récupère les statistiques d'un utilisateur */
	public async getUserStats(userId: number): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/users/${userId}/stats`);
			ok ? this.handleMessage({ type: 'user_stats_loaded', user: data.user, stats: data.stats }) : this.handleMessage({ type: 'user_stats_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Get user stats error:', error); 
			this.handleMessage({ type: 'user_stats_error', error: 'Failed to load stats' }); 
		}
	}

	/* Récupère l'historique des matchs */
	public async getMatchHistory(userId: number, limit: number = 20): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/users/${userId}/matches?limit=${limit}`);
			ok ? this.handleMessage({ type: 'match_history_loaded', user: data.user, matches: data.matches }) : this.handleMessage({ type: 'match_history_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Get match history error:', error); 
			this.handleMessage({ type: 'match_history_error', error: 'Failed to load match history' }); 
		}
	}

	/* Crée un nouveau match */
	public async createMatch(player2Id: number, player1Score: number, player2Score: number, gameMode: string = 'classic', duration?: number): Promise<void> {
		try {
			const { ok, data } = await this.http('/api/auth/matches', 'POST', { player2Id, player1Score, player2Score, gameMode, duration });
			ok ? this.handleMessage({ type: 'match_created', gameId: data.gameId, message: data.message }) : this.handleMessage({ type: 'match_create_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Create match error:', error); 
			this.handleMessage({ type: 'match_create_error', error: 'Failed to create match' }); 
		}
	}

	/* Classement global (leaderboard) */
	public async getLeaderboard(limit: number = 20, offset: number = 0): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/ranking?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`);
			ok ? this.handleMessage({ type: 'ranking_loaded', leaderboard: data.leaderboard }) : this.handleMessage({ type: 'ranking_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Get leaderboard error:', error); 
			this.handleMessage({ type: 'ranking_error', error: 'Failed to load leaderboard' }); 
		}
	}

	/* Rang d'un utilisateur */
	public async getUserRank(userId: number): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/auth/users/${userId}/rank`);
			ok ? this.handleMessage({ type: 'user_rank_loaded', user: data.user, rank: data.rank }) : this.handleMessage({ type: 'user_rank_error', error: data.message });
		} catch (error: any) { 
			console.error('[WSS] Get user rank error:', error); 
			this.handleMessage({ type: 'user_rank_error', error: 'Failed to load rank' }); 
		}
	}

	/* Génère les headers d'authentification avec token à jour */
	public getAuthHeaders(): HeadersInit {
		const h: Record<string, string> = { 
			'Content-Type': 'application/json' 
		};
		
		const t = this.getToken();
		if (t) {
			h['Authorization'] = `Bearer ${t}`;
			console.log('[WSS] Auth headers generated with token:', t.substring(0, 20) + '...');
		} else {
			console.warn('[WSS] No token available for auth headers');
		}
		
		return h;
	}

	/* Vérifie si l'utilisateur est authentifié */
	public isAuthenticated(): boolean {
		return !!this.getToken();
	}

	/* Déconnecte la WebSocket sans perdre les handlers */
	public disconnect(): void {
		if (this.socket) { 
			try { 
				this.socket.close();
				} catch { } 
			this.socket = null; 
		}
		// empêcher toute reconnexion jusqu'à demande explicite
		this.preventReconnect = true;
		if (this.heartbeatId) { 
			clearInterval(this.heartbeatId); 
			this.heartbeatId = null; 
		}
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer);
				this.reconnectTimer = null;
			}
		this.reconnectAttempts = 0;
	}

	/* Déconnecte la WS, bloque la reconnexion auto et attend sa fermeture (utile avant /logout) */
	public async disconnectAndWait(timeoutMs: number = 1000): Promise<void> {
		return new Promise((resolve) => {
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				resolve();
			};

			try {
				this.preventReconnect = true;
				if (this.heartbeatId) { clearInterval(this.heartbeatId); this.heartbeatId = null; }
				if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
				this.reconnectAttempts = 0;

				const sock = this.socket;
				if (!sock || sock.readyState === WebSocket.CLOSED) {
					this.socket = null;
					this.readyResolve = null; this.readyPromise = null;
					return done();
				}

				const timeout = setTimeout(() => {
					if (this.socket === sock) {
						this.socket = null;
						this.readyResolve = null; this.readyPromise = null;
					}
					done();
				}, timeoutMs);

				const onClose = () => {
					clearTimeout(timeout);
					this.socket = null;
					this.readyResolve = null; this.readyPromise = null;
					done();
				};

				try { sock.addEventListener('close', onClose, { once: true }); } catch { }
				try { sock.close(); } catch { clearTimeout(timeout); done(); }
			} catch {
				done();
			}
		});
	}

	/* Coupe la connexion une fois (code explicite) puis relance une reconnexion immédiate */
	public dropAndReconnect(reason: string = 'tournament_forfeit_navigation'): void {
		try {
			this.isShuttingDown = false;
			this.preventReconnect = false;
				const shouldReconnectLater = !this.socket || this.socket.readyState === WebSocket.CLOSED;
				if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
					console.log('[WSS] 🔌 Dropping connection for tournament forfeit:', reason);
					try { this.socket.close(4001, reason); } catch { try { this.socket.close(); } catch {} }
				}
				const triggerReconnect = () => {
					this.connect(true).catch(() => {});
				};
				if (shouldReconnectLater) {
					triggerReconnect();
				} else {
					setTimeout(triggerReconnect, 120);
				}
			} catch (e) {
				console.warn('[WSS] Failed to drop and reconnect:', e);
			}
		}

	/* Récupère les conversations de l'utilisateur */
	public async getConversations(): Promise<void> {
		try {
			const { ok, data } = await this.http('/api/chat/conversations');
			const key = ok ? 'chat:conversations_loaded' : 'chat:conversations_error';
			(this.messageHandlers.get(key) || []).forEach(h => h({ type: key, ...(ok ? { conversations: data.conversations } : { error: data.message }) }));
		} catch (error: any) {
			console.error('[WSS] Get conversations error:', error);
			(this.messageHandlers.get('chat:conversations_error') || []).forEach(h => h({ type: 'chat:conversations_error', error: 'Failed to load conversations' }));
		}
	}

	/* Récupère les messages d'une conversation */
	public async getConversationMessages(conversationId: number, limit: number = 50): Promise<void> {
		try {
			const { ok, data } = await this.http(`/api/chat/conversations/${conversationId}/messages?limit=${limit}`);
			const key = ok ? 'chat:messages_loaded' : 'chat:messages_error';
			(this.messageHandlers.get(key) || []).forEach(h => h({ type: key, ...(ok ? { messages: data.messages, conversationId } : { error: data.message }) }));
		} catch (error: any) {
			console.error('[WSS] Get messages error:', error);
			(this.messageHandlers.get('chat:messages_error') || []).forEach(h => h({ type: 'chat:messages_error', error: 'Failed to load messages' }));
		}
	}
}

/* Export de l'instance unique */
export const wsService = new WebSocketService();
