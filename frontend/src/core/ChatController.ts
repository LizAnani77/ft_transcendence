import { WebSocketService } from '../services/WebSocketService';
import { UIUtils } from './UIUtils';
import { 
  ChatMessage, 
  ConversationType, 
  MessageType, 
  ChatUIState,
  UserNotification,
  User,
  UnreadChatCount
} from './interfaces';
import { i18n } from './I18n';

export class ChatController {
  private uiState: ChatUIState;
  private typingTimers: Map<number, number> = new Map();
  private lastTypingTime: number = 0;
  private readonly TYPING_TIMEOUT = 3000;
  private readonly TYPING_COOLDOWN = 1000;
  private blockedUsers: Set<number> = new Set();
  private badgeUpdateTimer: number | null = null;
  private isUpdatingBadges = false;
  private lastBadgeUpdate: number = 0;
  private readonly BADGE_UPDATE_INTERVAL = 5000;

  private $ = (id: string) => document.getElementById(id);
  private setVisible = (el: HTMLElement | null, show: boolean) => { if (el) el.style.display = show ? 'block' : 'none'; };
  private setText = (el: HTMLElement | null, text: string) => { if (el) el.textContent = text; };
  private escapeHtml = (s: string) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  private myUserId = () => ((window as any)?.pongApp?.authService?.getCurrentUser?.() || {})?.id as number | undefined;

  private static readonly CHAT_MESSAGE_MAX_CHARS = 500;

  /* Récupère l'élément input du chat */
  private getChatInput(): HTMLInputElement | null {
    return this.$('chat-input') as HTMLInputElement | null;
  }
  /* Récupère le bouton d'envoi du chat */
  private getSendBtn(): HTMLButtonElement | null {
    return this.$('chat-send') as HTMLButtonElement | null;
  }
  /* Récupère l'élément compteur de caractères */
  private getCounterEl(): HTMLElement | null {
    return this.$('chat-char-counter');
  }

  /* Met à jour l'état visuel de l'input et du compteur de caractères */
  private updateInputUIState(): void {
    const input = this.getChatInput();
    if (!input) return;
    const btn = this.getSendBtn();
    const counter = this.getCounterEl();

    const text = input.value.trim();
    const len = text.length;
    const within = len > 0 && len <= ChatController.CHAT_MESSAGE_MAX_CHARS;

    if (btn) btn.disabled = !within;
    if (counter) {
      counter.textContent = `${len}/${ChatController.CHAT_MESSAGE_MAX_CHARS}`;
      counter.style.color = len > ChatController.CHAT_MESSAGE_MAX_CHARS ? '#ff6b6b' : '#aaa';
    }
  }

  /* Active ou désactive l'input du chat avec un placeholder optionnel */
  private setChatInputState(enabled: boolean, placeholder?: string) {
    const input = this.$('chat-input') as HTMLInputElement | null;
    const btn = this.$('chat-send') as HTMLButtonElement | null;
    if (input) {
      input.disabled = !enabled;
      input.style.cursor = enabled ? 'text' : 'not-allowed';
      if (placeholder) input.placeholder = placeholder;
      if (enabled) input.focus();
    }
    if (btn) {
      btn.disabled = !enabled;
      btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }
  }

  /* Initialise le contrôleur de chat avec les services WebSocket et UI */
  constructor(private ws: WebSocketService, private ui: UIUtils) {
    this.uiState = {
      currentConversationType: 'global',
      selectedConversationId: 1,
      selectedUserId: null,
      globalMessages: [],
      privateConversations: new Map(),
      onlineUsers: [],
      typingUsers: new Map(),
      notifications: [],
      unreadCount: 0,
      unreadChatMessages: new Map(),
      totalUnreadChatCount: 0
    };
    this.initializeWebSocketHandlers();
    this.loadBlockedUsers();
    this.loadUnreadCounts();
    this.startBadgeUpdateTimer();
  }

  /* Démarre le timer de mise à jour périodique des badges de notification */
  private startBadgeUpdateTimer(): void {
    if (this.badgeUpdateTimer) clearInterval(this.badgeUpdateTimer);
    this.badgeUpdateTimer = window.setInterval(() => {
      const now = Date.now();
      if (now - this.lastBadgeUpdate < this.BADGE_UPDATE_INTERVAL) return;
      this.updateChatNotificationBadges();
    }, this.BADGE_UPDATE_INTERVAL);
  }

  /* Arrête le timer de mise à jour des badges */
  private stopBadgeUpdateTimer(): void {
    if (!this.badgeUpdateTimer) return;
    clearInterval(this.badgeUpdateTimer);
    this.badgeUpdateTimer = null;
  }

  /* Force une mise à jour immédiate des badges avec debounce */
  private forceUpdateBadges(): void {
    if ((this as any).__badgeUpdatePending) return;
    (this as any).__badgeUpdatePending = true;
    this.updateChatNotificationBadges();
    setTimeout(() => {
      this.updateChatNotificationBadges();
      (this as any).__badgeUpdatePending = false;
    }, 200);
  }

  /* Charge la liste des utilisateurs bloqués depuis le serveur */
  private async loadBlockedUsers(): Promise<void> {
    try {
      const headers = this.ws.getAuthHeaders();
      const response = await fetch('https://localhost:3443/api/chat/blocked', { headers });
      if (response.ok) {
        const data = await response.json();
        this.blockedUsers.clear();
        data.blocked_users?.forEach((user: any) => this.blockedUsers.add(user.id));
      }
    } catch (error) {
      console.error('[CHAT] Erreur chargement utilisateurs bloqués:', error);
    }
  }

  /* Vérifie si un utilisateur est bloqué localement */
  private isUserBlockedLocal(userId: number): boolean {
    return this.blockedUsers.has(userId);
  }

  /* Ajoute un utilisateur à la liste des bloqués et filtre les messages */
  public addBlockedUser(userId: number): void {
    this.blockedUsers.add(userId);
    this.filterExistingMessages();
    this.forceUpdateBadges();
  }

  /* Retire un utilisateur de la liste des bloqués */
  public removeBlockedUser(userId: number): void {
    this.blockedUsers.delete(userId);
    this.forceUpdateBadges();
  }

  /* Filtre tous les messages existants pour exclure les utilisateurs bloqués */
  private filterExistingMessages(): void {
    this.uiState.globalMessages = this.uiState.globalMessages.filter(m => !this.isUserBlockedLocal(m.sender_id));
    for (const [uid] of this.uiState.privateConversations.entries()) {
      if (this.isUserBlockedLocal(uid)) this.uiState.privateConversations.delete(uid);
    }
    if (this.uiState.currentConversationType === 'global') this.renderCurrentConversation();
  }

  /* Charge les compteurs de messages non lus depuis le serveur */
  private async loadUnreadCounts(): Promise<void> {
    try {
      const headers = this.ws.getAuthHeaders();
      const response = await fetch('https://localhost:3443/api/chat/unread-counts', { headers });
      if (response.ok) {
        const data = await response.json();
        this.uiState.unreadChatMessages.clear();
        data.unreadCounts?.forEach((u: any) => {
          this.uiState.unreadChatMessages.set(u.userId, {
            userId: u.userId,
            username: u.username,
            count: u.count,
            lastMessageTime: u.lastMessageTime
          });
        });
        this.uiState.totalUnreadChatCount = data.totalUnreadCount || 0;
        this.forceUpdateBadges();
      }
    } catch (error) {
      console.error('[CHAT] Erreur chargement compteurs:', error);
    }
  }

  /* Marque les messages d'un utilisateur comme lus côté serveur */
  private async markUserMessagesAsReadServer(otherUserId: number): Promise<void> {
    try {
      const headers = this.ws.getAuthHeaders();
      const response = await fetch('https://localhost:3443/api/chat/mark-read', {
        method: 'POST',
        headers,
        body: JSON.stringify({ otherUserId })
      });
      if (response.ok) {
        const data = await response.json();
        this.uiState.totalUnreadChatCount = data.totalUnreadCount || 0;
        this.forceUpdateBadges();
      }
    } catch (error) {
      console.error('[CHAT] Erreur marquage messages lus:', error);
    }
  }

  /* Incrémente le compteur de messages non lus pour un utilisateur */
  private incrementUnreadCount(userId: number, username: string): void {
    const nowIso = new Date().toISOString();
    const current = this.uiState.unreadChatMessages.get(userId) || {
      userId,
      username,
      count: 0,
      lastMessageTime: nowIso
    };
    current.count++;
    current.lastMessageTime = nowIso;
    this.uiState.unreadChatMessages.set(userId, current);
    this.updateTotalUnreadCount();
    this.forceUpdateBadges();
  }

  /* Marque les messages d'un utilisateur comme lus localement et côté serveur */
  private async markUserMessagesAsRead(userId: number): Promise<void> {
    this.uiState.unreadChatMessages.delete(userId);
    this.updateTotalUnreadCount();
    this.forceUpdateBadges();
    await this.markUserMessagesAsReadServer(userId);
  }

  /* Recalcule le nombre total de messages non lus */
  private updateTotalUnreadCount(): void {
    this.uiState.totalUnreadChatCount = Array.from(this.uiState.unreadChatMessages.values())
      .reduce((acc, u) => acc + u.count, 0);
  }

  /* Met à jour tous les badges de notification du chat avec throttling */
  private updateChatNotificationBadges(): void {
    const now = Date.now();
    if (this.isUpdatingBadges || now - this.lastBadgeUpdate < 1000) return;
    this.isUpdatingBadges = true;
    this.lastBadgeUpdate = now;
    
    try {
      this.updateMainChatBadge();
      requestAnimationFrame(() => {
        this.updateUserChatBadges();
        this.isUpdatingBadges = false;
      });
    } catch (error) {
      console.error('[CHAT] Erreur mise à jour badges:', error);
      this.isUpdatingBadges = false;
    }
  }

  /* Met à jour le badge principal du chat dans la navigation */
  private updateMainChatBadge(): void {
    const chatLink = this.$('chat-link-with-badge');
    if (!chatLink) return;
    chatLink.textContent = this.uiState.totalUnreadChatCount > 0
      ? `${i18n.t('nav.chat')} (${this.uiState.totalUnreadChatCount})`
      : i18n.t('nav.chat');
  }

  /* Met à jour les badges de chat pour chaque utilisateur dans la liste */
  private updateUserChatBadges(): void {
    const selectors = [
      '[data-friend-id]',
      '.chat-recipient[data-friend-id]',
      '.online-user-item[data-user-id]',
      '[data-user-id]'
    ];
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        const friendId = Number(
          element.getAttribute('data-friend-id') || element.getAttribute('data-user-id')
        );
        if (!friendId) return;
        const unread = this.uiState.unreadChatMessages.get(friendId);
        this.updateUserBadge(element as HTMLElement, unread?.count || 0);
      });
    });
  }

  /* Met à jour le badge d'un élément utilisateur avec le nombre de messages non lus */
  private updateUserBadge(userElement: HTMLElement, unreadCount: number): void {
    try {
      let nameElement = userElement.querySelector('span:not(.chat-unread-badge)') as HTMLElement ||
        userElement.querySelector('span') as HTMLElement;
      if (!nameElement) return;
      const originalName = (nameElement.textContent || '').replace(/\s*\(\d+\)$/, '').replace(/\s*$/, '');
      if (unreadCount > 0) {
        nameElement.innerHTML = `${this.escapeHtml(originalName)} <strong>(${unreadCount})</strong>`;
      } else {
        nameElement.textContent = originalName;
      }
      userElement.querySelector('.chat-unread-badge')?.remove();
    } catch (error) {
      console.error('[CHAT] Erreur mise à jour badge utilisateur:', error);
    }
  }

  /* Initialise tous les gestionnaires WebSocket pour les événements de chat */
  private initializeWebSocketHandlers(): void {
    this.ws.onMessage('chat:global_message', (msg: any) => this.handleGlobalMessage(msg.data || msg));
    this.ws.onMessage('chat:tournament_invitation', (msg: any) => this.handleGlobalMessage(msg.data || msg));
    this.ws.onMessage('chat:private_message', (msg: any) => this.handlePrivateMessage(msg.data || msg));
    this.ws.onMessage('chat:game_invitation', (msg: any) => this.handleGameInvitation(msg.data || msg));
    this.ws.onMessage('chat:user_typing', (msg: any) => this.handleTypingIndicator(msg.data || msg));
    this.ws.onMessage('notifications:update', (msg: any) => this.handleNotificationsUpdate(msg.data || msg));
    this.ws.onMessage('chat:unread_update', (msg: any) => this.handleUnreadUpdate(msg.data || msg));
    this.ws.onMessage('presence:list', (msg: any) => this.handlePresenceUpdate(msg.data || msg));
    this.ws.onMessage('presence:update', (msg: any) => this.handleUserPresenceChange(msg.data || msg));
  }

  /* Traite la mise à jour des compteurs de messages non lus */
  private handleUnreadUpdate(data: any): void {
    if (data.totalUnreadCount !== undefined) {
      this.uiState.totalUnreadChatCount = data.totalUnreadCount;
    }
    if (data.unreadCounts) {
      this.uiState.unreadChatMessages.clear();
      data.unreadCounts.forEach((u: any) => {
        this.uiState.unreadChatMessages.set(u.userId, {
          userId: u.userId,
          username: u.username,
          count: u.count,
          lastMessageTime: u.lastMessageTime
        });
      });
    }
    this.forceUpdateBadges();
  }

  /* Traite la réception d'un message dans le chat global */
  private handleGlobalMessage(data: any): void {
    if (this.isUserBlockedLocal(data.sender_id)) return;
    
    const message: ChatMessage = {
      id: data.id,
      conversation_id: 1,
      sender_id: data.sender_id,
      sender_username: data.sender_username,
      content: data.content,
      message_type: data.message_type || 'text',
      metadata: data.metadata,
      created_at: data.created_at,
      conversationType: 'global'
    };
    
    this.uiState.globalMessages.push(message);
    this.limitGlobalMessages();
    
    if (this.uiState.currentConversationType === 'global') {
      this.renderCurrentConversation();
    }
  }

  /* Traite la réception d'un message privé */
  private handlePrivateMessage(data: any): void {
    if (this.isUserBlockedLocal(data.sender_id)) return;
    
    const message: ChatMessage = {
      id: data.id,
      conversation_id: data.conversation_id,
      sender_id: data.sender_id,
      sender_username: data.sender_username,
      recipient_id: data.recipient_id,
      content: data.content,
      message_type: data.message_type || 'text',
      metadata: data.metadata,
      created_at: data.created_at,
      conversationType: 'private'
    };
    
    const myId = this.myUserId();
    const otherUserId = message.sender_id === myId ? message.recipient_id : message.sender_id;
    if (!otherUserId || this.isUserBlockedLocal(otherUserId)) return;
    
    if (!this.uiState.privateConversations.has(otherUserId)) {
      this.uiState.privateConversations.set(otherUserId, []);
    }
    this.uiState.privateConversations.get(otherUserId)!.push(message);
    
    if (message.sender_id !== myId) {
      const isCurrent = this.uiState.currentConversationType === 'private' &&
        this.uiState.selectedUserId === otherUserId;
      if (!isCurrent) {
        this.incrementUnreadCount(otherUserId, message.sender_username);
      }
    }
    
    if (this.uiState.currentConversationType === 'private' &&
        this.uiState.selectedUserId === otherUserId) {
      this.renderCurrentConversation();
    }
  }

  /* Vérifie si l'utilisateur est occupé avec un match distant ou un défi en cours */
  private isBusyWithRemoteMatch(): boolean {
    try {
      const inviteOpen = document.body.getAttribute('data-invite-open') === '1';
      const outgoingChallenge = document.body.getAttribute('data-outgoing-challenge') === '1';
      const pendingRemoteGameId = sessionStorage.getItem('pendingRemoteGameId');
      const app = (window as any)?.pongApp;
      const remote = app?.remote || app?.remoteGame || app?.remoteGameController;
      const hasActiveRemote = typeof remote?.hasActiveRemoteGame === 'function' && remote.hasActiveRemoteGame();
      return !!(inviteOpen || outgoingChallenge || pendingRemoteGameId || hasActiveRemote);
    } catch (error) {
      console.warn('[CHAT] Failed to determine remote game busy state:', error);
      return false;
    }
  }

  /* Traite la réception d'une invitation de jeu par chat */
  private handleGameInvitation(data: any): void {
    if (this.isUserBlockedLocal(data.sender_id)) return;
    if (this.isBusyWithRemoteMatch()) {
      console.warn('[CHAT] Ignoring chat game invitation - user already busy with a match or challenge', {
        sender: data?.sender_id
      });
      return;
    }
    this.showGameInvitePopup(data.sender_id, data.sender_username);
    
    const inviteMessage: ChatMessage = {
      id: data.id,
      conversation_id: data.conversation_id,
      sender_id: data.sender_id,
      sender_username: data.sender_username,
      content: data.content,
      message_type: 'game_invite',
      metadata: data.metadata,
      created_at: data.created_at,
      conversationType: 'private'
    };
    
    const myId = this.myUserId();
    const otherUserId = inviteMessage.sender_id;
    if (otherUserId && otherUserId !== myId && !this.isUserBlockedLocal(otherUserId)) {
      if (!this.uiState.privateConversations.has(otherUserId)) {
        this.uiState.privateConversations.set(otherUserId, []);
      }
      this.uiState.privateConversations.get(otherUserId)!.push(inviteMessage);
      if (this.uiState.currentConversationType === 'private' &&
          this.uiState.selectedUserId === otherUserId) {
        this.renderCurrentConversation();
      }
    }
  }

  /* Traite les indicateurs de saisie en cours d'un utilisateur */
  private handleTypingIndicator(data: { userId: number; username: string; isTyping: boolean }): void {
    const { userId, username, isTyping } = data;
    if (this.isUserBlockedLocal(userId)) return;
    
    if (isTyping) {
      this.uiState.typingUsers.set(userId, username);
      if (this.typingTimers.has(userId)) {
        clearTimeout(this.typingTimers.get(userId)!);
      }
      const timer = window.setTimeout(() => {
        this.uiState.typingUsers.delete(userId);
        this.typingTimers.delete(userId);
        this.updateTypingIndicators();
      }, this.TYPING_TIMEOUT);
      this.typingTimers.set(userId, timer);
    } else {
      this.uiState.typingUsers.delete(userId);
      if (this.typingTimers.has(userId)) {
        clearTimeout(this.typingTimers.get(userId)!);
        this.typingTimers.delete(userId);
      }
    }
    this.updateTypingIndicators();
  }

  /* Traite la mise à jour de la liste des notifications utilisateur */
  private handleNotificationsUpdate(data: { notifications: UserNotification[]; unreadCount: number }): void {
    this.uiState.notifications = data.notifications || [];
    this.uiState.unreadCount = data.unreadCount || 0;
    this.updateNotificationBadge();
  }

  /* Met à jour le badge de notifications dans l'interface */
  private updateNotificationBadge(): void {
    const badge = this.$('notification-badge');
    if (!badge) return;
    if (this.uiState.unreadCount > 0) {
      badge.textContent = String(this.uiState.unreadCount);
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  /* Traite la mise à jour complète de la liste des utilisateurs en ligne */
  private handlePresenceUpdate(data: { users: User[] }): void {
    this.uiState.onlineUsers = data.users || [];
    this.updateOnlineUsersList();
    this.forceUpdateBadges();
  }

  /* Traite le changement de présence d'un utilisateur individuel */
  private handleUserPresenceChange(data: { user: User }): void {
    const { user } = data;
    if (!user) return;
    
    const existingIndex = this.uiState.onlineUsers.findIndex(u => u.id === user.id);
    if (user.is_online) {
      if (existingIndex === -1) {
        this.uiState.onlineUsers.push(user);
      } else {
        this.uiState.onlineUsers[existingIndex] = user;
      }
    } else {
      if (existingIndex !== -1) {
        this.uiState.onlineUsers.splice(existingIndex, 1);
      }
    }
    this.updateOnlineUsersList();
    this.forceUpdateBadges();
  }

  /* Associe les gestionnaires d'événements pour l'interface de chat */
  public bindChatHandlers(currentView: string): void {
    if ((this as any).__chatHandlersBound__) return;
    (this as any).__chatHandlersBound__ = true;

    document.addEventListener('click', (evt) => {
      const target = evt.target as HTMLElement;
      if (!target || currentView !== 'chat') return;

      if (target.getAttribute('data-action') === 'switch-to-global') {
        this.switchToGlobalChat();
        return;
      }
      
      const friendEl = target.closest('[data-friend-id]') as HTMLElement;
      if (friendEl && !target.closest('[data-action="stop-propagation"]')) {
        const friendId = Number(friendEl.getAttribute('data-friend-id'));
        const friendUsername = friendEl.getAttribute('data-friend-username') || i18n.t('chat.friend');
        this.selectPrivateConversation(friendId, friendUsername);
        return;
      }
      
      if (target.id === 'chat-send') {
        evt.preventDefault();
        this.handleSendMessage();
        return;
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      const active = document.activeElement as HTMLElement;
      if (e.key !== 'Enter' || active?.id !== 'chat-input') return;
      e.preventDefault();
      this.handleSendMessage();
    });

    document.addEventListener('input', (e) => {
      const target = e.target as HTMLElement;
      if (target?.id !== 'chat-input') return;
      this.updateInputUIState();
      this.handleTypingInput();
    });

    // SIMPLE: Charger historique global et afficher
    this.loadGlobalChatHistory(50).then(() => {
      this.renderCurrentConversation();
    });
    
    this.updateInputUIState();
  }

  /* Bascule vers le chat global et charge son historique */
  private async switchToGlobalChat(): Promise<void> {
    this.uiState.currentConversationType = 'global';
    this.uiState.selectedUserId = null;
    this.uiState.selectedConversationId = 1;
    
    this.updateChatHeader(i18n.t('chat.global'));
    this.enableChatInput();
    this.updateInputUIState();
    this.hideChatProfileLink();
    this.showGlobalNotice();
    this.renderCurrentConversation();
  }

  /* Sélectionne une conversation privée avec un utilisateur */
  private selectPrivateConversation(userId: number, username: string): void {
    if (this.isUserBlockedLocal(userId)) {
      this.ui.showErrorPopup(i18n.t('chat.error.cannotChatBlocked'));
      return;
    }
    
    this.uiState.currentConversationType = 'private';
    this.uiState.selectedUserId = userId;
    this.uiState.selectedConversationId = null;
    
    this.markUserMessagesAsRead(userId);
    this.updateChatHeader(i18n.t('chat.withUser').replace('{username}', username));
    this.enableChatInput();
    this.updateInputUIState();
    this.showChatProfileLink(userId);
    this.hideGlobalNotice();
    this.renderCurrentConversation();
    this.loadPrivateConversationHistory(userId);
  }

  /* Charge l'historique des messages du chat global */
  private async loadGlobalChatHistory(limit: number = 20): Promise<void> {
    try {
      const messages = await this.ws.getChatMessages(1, limit);
      this.uiState.globalMessages = messages.filter((m: ChatMessage) =>
        !this.isUserBlockedLocal(m.sender_id)
      );
    } catch (error) {
      console.error('[CHAT] Erreur chargement historique:', error);
    }
  }

  /* Gère l'envoi d'un message de chat */
  private handleSendMessage(): void {
    const input = this.getChatInput();
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) return;

    if (content.length > ChatController.CHAT_MESSAGE_MAX_CHARS) {
      this.ui.showErrorPopup(i18n.t('chat.error.tooLong').replace('{max}', String(ChatController.CHAT_MESSAGE_MAX_CHARS)));
      return;
    }

    if (this.uiState.currentConversationType === 'global') {
      this.ws.sendGlobalMessage(content);
    } else if (this.uiState.selectedUserId) {
      this.ws.sendPrivateMessage(this.uiState.selectedUserId, content);
    } else {
      this.ui.showErrorPopup(i18n.t('chat.selectFriendFirst'));
      return;
    }

    input.value = '';
    this.updateInputUIState();
    this.stopTyping();
  }

  /* Gère l'indicateur de saisie en cours lors de l'input */
  private handleTypingInput(): void {
    if (this.uiState.currentConversationType !== 'private' || !this.uiState.selectedUserId) return;
    const now = Date.now();
    if (now - this.lastTypingTime < this.TYPING_COOLDOWN) return;
    this.lastTypingTime = now;
    this.ws.sendTypingIndicator(this.uiState.selectedUserId, true);
    setTimeout(() => this.stopTyping(), this.TYPING_TIMEOUT);
  }

  /* Arrête l'indicateur de saisie en cours */
  private stopTyping(): void {
    if (this.uiState.currentConversationType === 'private' && this.uiState.selectedUserId) {
      this.ws.sendTypingIndicator(this.uiState.selectedUserId, false);
    }
  }

  /* Met à jour le titre de l'en-tête du chat */
  private updateChatHeader(title: string): void {
    this.setText(this.$('chat-header-name'), title);
  }

  /* Active l'input de chat avec le placeholder approprié */
  private enableChatInput(): void {
    const placeholder = this.uiState.currentConversationType === 'global'
      ? i18n.t('chat.placeholder.global').replace('{max}', String(ChatController.CHAT_MESSAGE_MAX_CHARS))
      : i18n.t('chat.placeholder.private').replace('{max}', String(ChatController.CHAT_MESSAGE_MAX_CHARS));
    this.setChatInputState(true, placeholder);
  }

  /* Affiche le lien vers le profil de l'utilisateur en conversation */
  private showChatProfileLink(userId: number): void {
    const container = this.$('chat-profile-link');
    const link = this.$('chat-view-profile') as HTMLAnchorElement | null;
    if (container && link) {
      link.href = `/profile?user=${userId}`;
      link.setAttribute('data-link', `/profile?user=${userId}`);
      this.setVisible(container, true);
    }
  }

  /* Masque le lien vers le profil utilisateur */
  private hideChatProfileLink(): void {
    this.setVisible(this.$('chat-profile-link'), false);
  }

  /* Affiche la notice du chat global */
  private showGlobalNotice(): void {
    this.setVisible(this.$('global-chat-notice'), true);
  }

  /* Masque la notice du chat global */
  private hideGlobalNotice(): void {
    this.setVisible(this.$('global-chat-notice'), false);
  }

  /* Affiche les messages de la conversation actuellement sélectionnée */
  private renderCurrentConversation(): void {
    const messagesBox = this.$('chat-messages');
    if (!messagesBox) return;

    this.applyCustomScrollbar();
    this.$('chat-messages-placeholder')?.remove();
    messagesBox.innerHTML = '';

    let messages: ChatMessage[] = [];
    if (this.uiState.currentConversationType === 'global') {
      messages = this.uiState.globalMessages;
    } else if (this.uiState.selectedUserId) {
      messages = this.uiState.privateConversations.get(this.uiState.selectedUserId) || [];
    }

    for (const message of messages) {
      messagesBox.appendChild(this.createMessageElement(message));
    }
    
    this.scrollToBottom(messagesBox as HTMLElement);
    this.attachProfileLinksListeners();
  }

  /* Applique un style de scrollbar personnalisé à la zone de messages */
  private applyCustomScrollbar(): void {
    const messagesBox = this.$('chat-messages') as HTMLElement;
    if (!messagesBox) return;
    
    messagesBox.style.overflowY = 'auto';
    messagesBox.style.overflowX = 'hidden';

    messagesBox.style.scrollbarWidth = 'thin';
    messagesBox.style.scrollbarColor = 'rgba(255, 255, 255, 0.2) transparent';
  }

  /* Crée un élément HTML pour afficher un message de chat */
  private createMessageElement(message: ChatMessage): HTMLElement {
    const myId = this.myUserId();
    const isMyMessage = message.sender_id === myId;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';

    if (message.message_type === 'tournament_announcement') {
      messageDiv.innerHTML = this.buildTournamentAnnouncementHtml(message);
    } else if (message.message_type === 'tournament_invite') {
      messageDiv.innerHTML = this.buildTournamentInviteHtml(message);
    } else if (message.message_type === 'game_invite') {
      messageDiv.innerHTML = this.buildGameInviteHtml(message, isMyMessage);
    } else {
      messageDiv.innerHTML = this.buildBubbleHtml({
        isMine: isMyMessage,
        text: message.content,
        senderId: isMyMessage ? undefined : message.sender_id,
        senderName: isMyMessage ? undefined : message.sender_username
      });
    }

    return messageDiv;
  }

  /* Construit le HTML pour une annonce de tournoi */
  private buildTournamentAnnouncementHtml(message: ChatMessage): string {
    const safe = this.escapeHtml(message.content);
    // Remplacer les emojis 🏆 par l'icône Material Symbols en blanc APRÈS l'échappement
    const safeWithIcon = safe.replace(/🏆/g, '<span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;color:#ffffff;">emoji_events</span>');
    return `
      <div style="display:flex; width:100%; margin:0.5rem 0; justify-content:center;">
        <div style="background:#4f2149; color:#fff; border:none;
                    border-radius:8px; padding:0.5rem 0.75rem; max-width:80%;
                    backdrop-filter:saturate(120%) blur(2px); display:inline-block;
                    text-align:center; font-weight:600;">
          ${safeWithIcon}
        </div>
      </div>`;
  }

  /* Construit le HTML pour une bulle de message standard */
  private buildBubbleHtml(opts: {
    isMine: boolean;
    text: string;
    senderId?: number;
    senderName?: string;
  }): string {
    const safe = this.escapeHtml(opts.text);
    // Remplacer les emojis 🏆 par l'icône Material Symbols en blanc APRÈS l'échappement
    const safeWithIcon = safe.replace(/🏆/g, '<span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;color:#ffffff;">emoji_events</span>');
    const isMine = !!opts.isMine;
    const isSystemMessage = opts.senderName === 'Tournament' || opts.text.includes('🏆 Upcoming matches') || opts.text.includes('Upcoming matches');
    
    let justifyContent = 'justify-content:flex-start;';
    if (isSystemMessage) {
      justifyContent = 'justify-content:center;';
    } else if (isMine) {
      justifyContent = 'justify-content:flex-end;';
    }
    
    const row = `display:flex; width:100%; margin:0.25rem 0; ${justifyContent}`;
    
    const bubble = isSystemMessage
      ? `background:rgba(255,165,0,0.15); color:#ffd700; border:none;
         border-radius:8px; padding:0.5rem 0.75rem; max-width:80%; line-height:1.35;
         backdrop-filter:saturate(120%) blur(2px); display:inline-block; word-break:break-word;
         text-align:center; font-weight:600; font-size:1rem;`
      : `background: ${isMine ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)'};
         color:#fff; border:none;
         border-radius:8px; padding:0.35rem 0.55rem; max-width:90%; max-height:300px;
         line-height:1.35; backdrop-filter:saturate(120%) blur(2px); display:inline-block;
         word-break:break-word; overflow-y:auto; scrollbar-width:thin;
         scrollbar-color:rgba(255,255,255,0.3) transparent; font-size:1rem;`;
    
    const youLabel = isMine && !isSystemMessage ? i18n.t('chat.you') : '';
    const nameBadge = !isMine && !isSystemMessage && opts.senderName
      ? `<div style="font-size:0.80rem; font-weight:900; opacity:.75; margin:0 .5rem .15rem 0;">
           <a href="/profile?user=${opts.senderId ?? ''}" data-link="/profile?user=${opts.senderId ?? ''}"
              class="chat-profile-link" data-hover-link="true" style="color:#fff; text-decoration:none;">
             ${this.escapeHtml(String(opts.senderName))}
           </a>
         </div>`
      : youLabel
      ? `<div style="font-size:0.80rem; font-weight:900; opacity:.75; margin:0 .5rem .15rem 0;">${youLabel}</div>`
      : '';

    return `<div style="${row}">${nameBadge}<div class="chat-bubble" style="${bubble}">${safeWithIcon}</div></div>`;
  }

  /* Construit le HTML pour une invitation de jeu */
  private buildGameInviteHtml(message: ChatMessage, isMyMessage: boolean): string {
    const direction = isMyMessage ? 'flex-end' : 'flex-start';
    const bgColor = isMyMessage ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.1)';
    return `
      <div style="display:flex; width:100%; margin:0.25rem 0; justify-content:${direction};">
        <div style="background:${bgColor}; color:#fff; border:none;
                    border-radius:8px; padding:0.65rem; max-width:90%;
                    backdrop-filter:saturate(120%) blur(2px); display:inline-block;">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:1.2rem;">🎮</span>
            <span>${this.escapeHtml(message.content)}</span>
          </div>
        </div>
      </div>`;
  }

  /* Construit le HTML pour une invitation de tournoi avec bouton d'action */
  private buildTournamentInviteHtml(message: ChatMessage): string {
    const safe = this.escapeHtml(message.content);
    const safeWithIcon = safe.replace(/🏆/g, '<span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;color:#ffffff;">emoji_events</span>');

    // Extraire tournament_id des métadonnées
    let tournamentId = null;
    let tournamentName = '';
    if (message.metadata) {
      try {
        const metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata) : message.metadata;
        tournamentId = metadata.tournament_id;
        tournamentName = metadata.tournament_name || '';
      } catch (e) {
        console.error('[ChatController] Failed to parse tournament metadata:', e);
      }
    }

    return `
      <div style="display:flex; width:100%; margin:0.5rem 0; justify-content:center;">
        <div style="background:#4f2149; color:#fff; border:none;
                    border-radius:8px; padding:0.5rem 0.75rem; max-width:70%;
                    backdrop-filter:saturate(120%) blur(2px); display:inline-block;
                    text-align:center;">
          <div style="display:flex; flex-direction:column; gap:0.5rem; align-items:center;">
            <div style="font-weight:600; font-size:0.85rem;">
              ${safeWithIcon}
            </div>
            ${tournamentName ? `
              <div style="font-weight:600; font-size:0.85rem;">
                ${this.escapeHtml(tournamentName)}
              </div>
            ` : ''}
            ${tournamentId ? `
              <button data-action="join-tournament" data-tournament-id="${tournamentId}"
                      style="background:transparent; color:white; border:none; border-radius:6px;
                             padding:0.25rem 1rem; cursor:pointer; font-weight:600; font-size:0.85rem;
                             transition:all 0.2s;">
                ${i18n.t('tournament.chat.joinButton') || 'Rejoindre le tournoi'}
              </button>
            ` : ''}
          </div>
        </div>
      </div>`;
  }

  /* Limite le nombre de messages globaux conservés en mémoire */
  private limitGlobalMessages(): void {
    if (this.uiState.globalMessages.length > 50) {
      this.uiState.globalMessages = this.uiState.globalMessages.slice(-50);
    }
  }

  /* Fait défiler un élément jusqu'en bas */
  private scrollToBottom(element: HTMLElement): void {
    element.scrollTop = element.scrollHeight;
  }

  /* Met à jour l'affichage des indicateurs de saisie en cours */
  private updateTypingIndicators(): void {
    const container = this.$('typing-indicators');
    if (!container) return;
    if (this.uiState.typingUsers.size === 0) {
      container.style.display = 'none';
      return;
    }
    const users = Array.from(this.uiState.typingUsers.values());
    const key = users.length === 1 ? 'chat.typing.one' : 'chat.typing.many';
    container.textContent = i18n.t(key).replace('{users}', users.join(', '));
    container.style.display = 'block';
  }

  /* Met à jour la liste des utilisateurs en ligne dans l'interface */
  private updateOnlineUsersList(): void {
    const container = this.$('online-users-list');
    if (!container) return;
    container.innerHTML = '';
    
    for (const user of this.uiState.onlineUsers) {
      const unread = this.uiState.unreadChatMessages.get(user.id);
      const userEl = document.createElement('div');
      userEl.className = 'online-user-item';
      userEl.setAttribute('data-user-id', user.id.toString());
      userEl.setAttribute('data-username', user.username);
      const displayName = unread && unread.count > 0
        ? `${this.escapeHtml(user.username)} <strong>(${unread.count})</strong>`
        : this.escapeHtml(user.username);
      userEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem;
                    cursor:pointer; border-radius:8px;">
          <div style="width:8px; height:8px; background:#4CAF50; border-radius:50%;"></div>
          <span>${displayName}</span>
        </div>`;
      container.appendChild(userEl);
    }
    
    setTimeout(() => this.forceUpdateBadges(), 100);
  }

  /* Charge l'historique d'une conversation privée avec un utilisateur */
  private loadPrivateConversationHistory(userId: number): void {
    if (this.isUserBlockedLocal(userId)) return;
    
    this.ws.getChatConversations()
      .then(conversations => {
        const conversation = conversations.find((conv: any) =>
          conv.participants?.some((p: any) => p.user_id === userId)
        );
        if (conversation) {
          this.uiState.selectedConversationId = conversation.id;
          return this.ws.getChatMessages(conversation.id, 50);
        }
        return [];
      })
      .then(messages => {
        const filtered = messages.filter((m: ChatMessage) =>
          !this.isUserBlockedLocal(m.sender_id)
        );
        this.uiState.privateConversations.set(userId, filtered);
        if (this.uiState.selectedUserId === userId) {
          this.renderCurrentConversation();
        }
      })
      .catch(error =>
        console.error('[CHAT] Erreur chargement historique privé:', error)
      );
  }

  /* Affiche une popup d'invitation de jeu avec options d'acceptation ou refus */
  private showGameInvitePopup(inviterId: number, inviterName: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'game-invite-overlay';
    overlay.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,.7);
                             display:flex; align-items:center; justify-content:center; z-index:10000;`;
    const popup = document.createElement('div');
    popup.style.cssText = `background:#1a1a2e; border:2px solid #4CAF50; border-radius:10px;
                           padding:2rem; text-align:center; color:white; max-width:400px; margin:1rem;`;
    popup.innerHTML = `
      <h3 style="margin:0 0 1rem 0; color:#4CAF50;">${i18n.t('chat.invite.title')}</h3>
      <p style="margin:0 0 1.5rem 0;">${i18n.t('chat.invite.body').replace('{username}', this.escapeHtml(inviterName))}</p>
      <div style="display:flex; gap:1rem; justify-content:center;">
        <button id="invite-decline" style="background:#666;color:#fff;border:none;
                                           padding:.5rem 1rem;border-radius:5px;cursor:pointer;">
          ${i18n.t('chat.invite.decline')}
        </button>
        <button id="invite-accept" style="background:#4CAF50;color:#fff;border:none;
                                          padding:.5rem 1rem;border-radius:5px;cursor:pointer;">
          ${i18n.t('chat.invite.accept')}
        </button>
      </div>`;
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    (popup.querySelector('#invite-accept') as HTMLButtonElement)?.addEventListener('click', () => {
      overlay.remove();
      this.ws.createRemoteGame(inviterId);
    });
    (popup.querySelector('#invite-decline') as HTMLButtonElement)?.addEventListener('click', () => {
      overlay.remove();
    });
    
    setTimeout(() => {
      if (overlay.parentNode) overlay.remove();
    }, 30000);
  }

  /* Attache les gestionnaires d'événements hover aux liens de profil */
  private attachProfileLinksListeners(): void {
    const rebind = (selector: string) => {
      document.querySelectorAll(selector).forEach(link => {
        const node = link.cloneNode(true);
        link.parentNode?.replaceChild(node, link);
        node.addEventListener('mouseenter', (e) =>
          ((e.target as HTMLElement).style.color = '#ccc')
        );
        node.addEventListener('mouseleave', (e) =>
          ((e.target as HTMLElement).style.color = '#fff')
        );
      });
    };
    
    rebind('.chat-profile-link[data-hover-link="true"]');
    rebind('#chat-messages [data-hover-link="true"]:not(.chat-profile-link)');
  }

  /* Recharge la liste des utilisateurs bloqués et filtre les messages */
  public async refreshBlockedUsers(): Promise<void> {
    await this.loadBlockedUsers();
    this.filterExistingMessages();
    this.forceUpdateBadges();
  }

  /* Retourne la liste des utilisateurs bloqués */
  public getBlockedUsers(): Set<number> {
    return new Set(this.blockedUsers);
  }

  /* Vérifie si un utilisateur est bloqué */
  public isBlocked(userId: number): boolean {
    return this.isUserBlockedLocal(userId);
  }

  /* Retourne le nombre total de messages de chat non lus */
  public getTotalUnreadChatCount(): number {
    return this.uiState.totalUnreadChatCount;
  }

  /* Retourne les compteurs de messages non lus par utilisateur */
  public getUnreadChatCounts(): Map<number, UnreadChatCount> {
    return new Map(this.uiState.unreadChatMessages);
  }

  /* Rafraîchit tous les badges de chat depuis le serveur */
  public async refreshChatBadges(): Promise<void> {
    await this.loadUnreadCounts();
    this.forceUpdateBadges();
    setTimeout(() => this.forceUpdateBadges(), 200);
  }

  /* Envoie un message dans la conversation actuelle */
  public sendMessage(content: string, type: MessageType = 'text'): void {
    const text = content.trim();
    if (!text) return;

    if (text.length > ChatController.CHAT_MESSAGE_MAX_CHARS) {
      this.ui.showErrorPopup(i18n.t('chat.error.tooLong').replace('{max}', String(ChatController.CHAT_MESSAGE_MAX_CHARS)));
      return;
    }

    if (this.uiState.currentConversationType === 'global') {
      this.ws.sendGlobalMessage(text, type);
    } else if (this.uiState.selectedUserId) {
      this.ws.sendPrivateMessage(this.uiState.selectedUserId, text, type);
    }
  }

  /* Bascule vers une conversation spécifique (globale ou privée) */
  public async switchToConversation(type: ConversationType, userId?: number): Promise<void> {
    if (type === 'global') {
      await this.switchToGlobalChat();
    } else if (type === 'private' && userId) {
      const user = this.uiState.onlineUsers.find(u => u.id === userId);
      const username = user?.username || i18n.t('chat.user.fallback').replace('{id}', String(userId));
      this.selectPrivateConversation(userId, username);
    }
  }

  /* Marque une notification comme lue */
  public markNotificationRead(notificationId: number): void {
    this.ws.markNotificationAsRead(notificationId);
  }

  /* Marque toutes les notifications comme lues */
  public markAllNotificationsRead(): void {
    this.ws.markAllNotificationsAsRead();
  }

  /* Retourne l'état actuel de l'interface de chat */
  public getChatState(): ChatUIState {
    return { ...this.uiState };
  }

  /* Retourne la liste des notifications non lues */
  public getUnreadNotifications(): UserNotification[] {
    return this.uiState.notifications.filter(n => !n.is_read);
  }

  /* Retourne le nombre de notifications non lues */
  public getUnreadCount(): number {
    return this.uiState.unreadCount;
  }

  /* Efface l'historique d'une conversation privée */
  public clearConversationHistory(userId: number): void {
    this.uiState.privateConversations.delete(userId);
    if (this.uiState.selectedUserId === userId) {
      this.renderCurrentConversation();
    }
  }

  /* Efface tout l'historique des conversations */
  public clearAllHistory(): void {
    this.uiState.globalMessages = [];
    this.uiState.privateConversations.clear();
    this.renderCurrentConversation();
  }

  /* Rafraîchit les données du chat (utilisateurs en ligne et badges) */
  public refresh(): void {
    this.ws.requestOnlineUsers();
    this.forceUpdateBadges();
  }

  /* Nettoie toutes les ressources et réinitialise l'état du chat */
  public cleanup(): void {
    this.stopBadgeUpdateTimer();
    for (const timer of this.typingTimers.values()) {
      clearTimeout(timer);
    }
    this.typingTimers.clear();
    this.blockedUsers.clear();
    
    this.uiState = {
      currentConversationType: 'global',
      selectedConversationId: null,
      selectedUserId: null,
      globalMessages: [],
      privateConversations: new Map(),
      onlineUsers: [],
      typingUsers: new Map(),
      notifications: [],
      unreadCount: 0,
      unreadChatMessages: new Map(),
      totalUnreadChatCount: 0
    };
  }

  /* Envoie un message privé à un destinataire spécifique */
  public sendChatMessage(recipientId: number, content: string): void {
    this.ws.sendPrivateMessage(recipientId, content);
  }

  /* Charge l'historique d'une conversation et l'affiche dans le thread approprié */
  public async loadConversationHistory(
    friendId: number,
    pushToThread: (peerId: number, html: string, replace?: boolean) => void,
    renderThread: (peerId: number) => void,
    selectedPeer: () => number
  ): Promise<void> {
    try {
      const messages = await this.ws.getChatMessages(friendId, 50);
      const myId = this.myUserId();
      const htmls = messages.map((m: ChatMessage) => {
        const mine = m.sender_id === myId;
        return this.buildBubbleHtml({
          isMine: mine,
          text: m.content,
          senderId: mine ? undefined : m.sender_id,
          senderName: mine ? undefined : m.sender_username
        });
      });
      for (const html of htmls) {
        pushToThread(friendId, html, false);
      }
      if (selectedPeer() === friendId) {
        renderThread(friendId);
      }
    } catch (error) {
      console.error('[CHAT] Erreur chargement historique:', error);
    }
  }
}
