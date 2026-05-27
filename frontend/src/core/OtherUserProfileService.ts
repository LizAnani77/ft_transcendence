import { WebSocketService } from '../services/WebSocketService';
import { UIUtils } from './UIUtils';
import { 
  UserStats, 
  MatchHistory, 
  UserProfileActions,
  User,
  BlockedUser,
  FriendRequest,
  GameChallenge 
} from './interfaces';

export interface OtherUserData {
  user: {
    id: number;
    username: string;
    avatar_url?: string;
    created_at?: string;
    last_login?: string;
    is_online?: boolean;
    rank?: number;
    rank_position?: number;
  };
  stats: UserStats | null;
  matches: MatchHistory[];
  actions: UserProfileActions;
  relationship: {
    isFriend: boolean;
    isBlocked: boolean;
    hasPendingRequest: boolean;
    canChallenge: boolean;
  };
}

export class OtherUserProfileService {
  private wsService: WebSocketService;
  private uiUtils: UIUtils;
  private otherUserData: Map<number, OtherUserData> = new Map();
  private loadingUsers: Set<number> = new Set();
  private blockedUsers: Map<number, BlockedUser> = new Map();
  private friendRequests: Map<number, FriendRequest> = new Map();

  /* Initialise le service de profil utilisateur avec les services WebSocket et UI */
  constructor(wsService: WebSocketService, uiUtils: UIUtils) {
    this.wsService = wsService;
    this.uiUtils = uiUtils;
    this.initializeWebSocketHandlers();
  }

  /* ===== INITIALISATION ===== */

  /* Initialise les handlers WebSocket */
  private initializeWebSocketHandlers(): void {
    // Notifications de blocage/déblocage
    this.wsService.onMessage('user:blocked', (msg: any) => {
      this.handleUserBlocked(msg.data || msg);
    });

    this.wsService.onMessage('user:unblocked', (msg: any) => {
      this.handleUserUnblocked(msg.data || msg);
    });

    // Demandes d'amis
    this.wsService.onMessage('friend:request_sent', (msg: any) => {
      this.handleFriendRequestSent(msg.data || msg);
    });

    this.wsService.onMessage('friend:request_received', (msg: any) => {
      this.handleFriendRequestReceived(msg.data || msg);
    });
    this.wsService.onMessage('friend_accepted', (msg: any) => {
      this.handleFriendshipUpdate(msg.data || msg);
    });
    this.wsService.onMessage('friend_removed', (msg: any) => {
      this.handleFriendshipUpdate(msg.data || msg);
    });
    this.wsService.onMessage('friend:removed', (msg: any) => {
      this.handleFriendshipUpdate(msg.data || msg);
    });
    this.wsService.onMessage('friend_declined', (msg: any) => {
      this.handleFriendshipUpdate(msg.data || msg);
    });

    // Défis de jeu
    this.wsService.onMessage('game:challenge_sent', (msg: any) => {
      this.handleGameChallengeSent(msg.data || msg);
    });

    this.wsService.onMessage('game:challenge_received', (msg: any) => {
      this.handleGameChallengeReceived(msg.data || msg);
    });

    // Mise à jour de statut en ligne
    this.wsService.onMessage('presence:update', (msg: any) => {
      this.handlePresenceUpdate(msg.data || msg);
    });

    // Mise à jour de l'historique adversaire après un match
    this.wsService.onMessage('game:finished', (msg: any) => {
      try {
        const payload = msg?.data || msg;
        const gameState = payload?.gameState;
        const players = gameState?.players;
        if (!players) return;

        const currentUserId = (window as any)?.pongApp?.authService?.getCurrentUser?.()?.id;
        if (!currentUserId) return;

        const p1 = Number(players?.player1?.id);
        const p2 = Number(players?.player2?.id);
        let opponentId: number | null = null;

        if (Number.isFinite(p1) && p1 !== Number(currentUserId)) {
          opponentId = p1;
        } else if (Number.isFinite(p2) && p2 !== Number(currentUserId)) {
          opponentId = p2;
        }

        if (!opponentId) return;

        const router = (window as any)?.pongApp?.router;
        const profileInfo = router?.isViewingOtherUserProfile?.();
        const viewingOpponent = profileInfo?.isOther && Number(profileInfo.userId) === Number(opponentId);
        
        if (viewingOpponent) {
          this.refreshUserData(opponentId, true);
        } else {
          this.clearUserCache(opponentId);
        }
      } catch (error) {
        console.warn('[OtherUserProfileService] Failed to handle game:finished:', error);
      }
    });
  }

  /* ===== CHARGEMENT DES DONNÉES ===== */

  /* Charge les données d'un autre utilisateur */
  async loadOtherUserData(userId: number): Promise<OtherUserData | null> {
    if (this.loadingUsers.has(userId)) {
      await this.waitForLoading(userId);
      return this.otherUserData.get(userId) || null;
    }

    this.loadingUsers.add(userId);

    try {
      const otherUserData = await this.fetchOtherUserDataPayload(userId);
      if (otherUserData) {
        this.otherUserData.set(userId, otherUserData);
      }
      return otherUserData;

    } catch (error) {
      console.error('Error loading other user data:', error);
      return null;
    } finally {
      this.loadingUsers.delete(userId);
    }
  }

  /* Charge la relation avec un utilisateur */
  private async loadUserRelationship(userId: number): Promise<{
    isFriend: boolean;
    isBlocked: boolean;
    hasPendingRequest: boolean;
    canChallenge: boolean;
  }> {
    try {
      const headers = this.wsService.getAuthHeaders();
      
      // Charger les amis, utilisateurs bloqués et demandes en parallèle
      const [friendsResponse, blockedResponse, requestsResponse] = await Promise.all([
        fetch('/api/auth/friends', { headers }),
        fetch('/api/chat/blocked', { headers }),
        fetch('/api/auth/friends/requests', { headers })
      ]);

      const friendsData = friendsResponse.ok ? await friendsResponse.json() : { friends: [] };
      const blockedData = blockedResponse.ok ? await blockedResponse.json() : { blocked_users: [] };
      const requestsData = requestsResponse.ok ? await requestsResponse.json() : { requests: [] };

      const isFriend = friendsData.friends?.some((f: any) => f.id === userId) || false;
      const isBlocked = blockedData.blocked_users?.some((b: any) => b.id === userId) || false;
      const hasPendingRequest = requestsData.requests?.some((r: any) => r.requester_id === userId || r.requested_id === userId) || false;

      // Pas de lag - vérifier l'utilisateur seulement si pas bloqué
      let canChallenge = false;
      if (!isBlocked) {
        const userData = this.otherUserData.get(userId);
        canChallenge = userData?.user?.is_online || false;
      }

      return {
        isFriend,
        isBlocked,
        hasPendingRequest,
        canChallenge
      };
    } catch (error) {
      console.error('Error loading user relationship:', error);
      return {
        isFriend: false,
        isBlocked: false,
        hasPendingRequest: false,
        canChallenge: false
      };
    }
  }

  /* Calcule les actions disponibles pour un utilisateur */
  private calculateUserActions(userId: number, relationship: any): UserProfileActions {
    const currentUser = (window as any)?.pongApp?.authService?.getCurrentUser?.();
    const isMyProfile = currentUser?.id === userId;

    if (isMyProfile) {
      return {
        canBlock: false,
        canUnblock: false,
        canAddFriend: false,
        canRemoveFriend: false,
        canChallenge: false,
        canMessage: false,
        isBlocked: false,
        isFriend: false,
        hasPendingRequest: false
      };
    }

    return {
      canBlock: !relationship.isBlocked,
      canUnblock: relationship.isBlocked,
      canAddFriend: !relationship.isFriend && !relationship.hasPendingRequest && !relationship.isBlocked,
      canRemoveFriend: relationship.isFriend,
      canChallenge: relationship.canChallenge && !relationship.isBlocked,
      canMessage: !relationship.isBlocked,
      isBlocked: relationship.isBlocked,
      isFriend: relationship.isFriend,
      hasPendingRequest: relationship.hasPendingRequest
    };
  }

  /* ===== ACTIONS UTILISATEUR CORRIGÉES ===== */

  /* Bloque un utilisateur SANS reason (backend n'en a pas besoin) */
  public async blockUser(userId: number): Promise<boolean> {
    try {
      const success = await this.wsService.blockUserHTTP(userId);
      
      if (success) {
        this.uiUtils.showSuccessPopup('User blocked successfully');
        await this.refreshUserData(userId, this.isViewingUserProfile(userId));
      } else {
        this.uiUtils.showErrorPopup('Unable to block this user');
      }
      
      return success;
    } catch (error) {
      console.error('Error blocking user:', error);
      this.uiUtils.showErrorPopup('Error while blocking user');
      return false;
    }
  }

  /* Débloque un utilisateur */
  public async unblockUser(userId: number): Promise<boolean> {
    try {
      const success = await this.wsService.unblockUserHTTP(userId);
      
      if (success) {
        this.uiUtils.showSuccessPopup('User unblocked successfully');
        await this.refreshUserData(userId, this.isViewingUserProfile(userId));
      } else {
        this.uiUtils.showErrorPopup('Unable to unblock this user');
      }
      
      return success;
    } catch (error) {
      console.error('Error unblocking user:', error);
      this.uiUtils.showErrorPopup('Error while unblocking user');
      return false;
    }
  }

  /* Envoie une demande d'ami */
  public async sendFriendRequest(userId: number, message?: string): Promise<boolean> {
    try {
      const success = await this.wsService.sendFriendRequestHTTP(userId, message);
      
      if (success) {
        this.uiUtils.showSuccessPopup('Friend request sent');
        await this.refreshUserData(userId, this.isViewingUserProfile(userId));
      } else {
        this.uiUtils.showErrorPopup('Unable to send friend request');
      }
      
      return success;
    } catch (error) {
      console.error('Error sending friend request:', error);
      this.uiUtils.showErrorPopup('Error sending friend request');
      return false;
    }
  }

  /* Supprime un ami */
  public async removeFriend(userId: number): Promise<boolean> {
    try {
      await this.wsService.removeFriend(userId);
      this.uiUtils.showSuccessPopup('Friend removed');
      await this.refreshUserData(userId, this.isViewingUserProfile(userId));
      return true;
    } catch (error) {
      console.error('Error removing friend:', error);
      this.uiUtils.showErrorPopup('Error removing friend');
      return false;
    }
  }

  /* Envoie un défi de jeu */
  public async sendGameChallenge(userId: number, message?: string, gameMode: string = 'classic'): Promise<boolean> {
    try {
      const userData = this.otherUserData.get(userId);
      if (!userData?.user?.is_online) {
        this.uiUtils.showErrorPopup('User is not online');
        return false;
      }

      const success = await this.wsService.sendGameChallengeHTTP(userId, message, gameMode);
      
      if (success) {
        this.uiUtils.showSuccessPopup('Game challenge sent');
      } else {
        this.uiUtils.showErrorPopup('Unable to send game challenge');
      }
      
      return success;
    } catch (error) {
      console.error('Error sending game challenge:', error);
      this.uiUtils.showErrorPopup('Error sending game challenge');
      return false;
    }
  }

  /* Ouvre le chat avec un utilisateur */
  public openChatWithUser(userId: number): void {
    try {
      // Stocker l'ID pour sélection automatique dans le chat
      sessionStorage.setItem('chatSelectUserId', userId.toString());
      
      // Naviguer vers la page de chat
      const event = new CustomEvent('navigate', { detail: { path: '/chat' } });
      window.dispatchEvent(event);
      
      this.uiUtils.showSuccessPopup('Redirecting to chat...');
    } catch (error) {
      console.error('Error opening chat:', error);
      this.uiUtils.showErrorPopup('Unable to open chat');
    }
  }

  /* ===== GESTION DES ÉVÉNEMENTS WEBSOCKET ===== */

  /* Gère la confirmation de blocage */
  private handleUserBlocked(data: any): void {
    const { blockedUserId } = data;
    if (blockedUserId) {
      const preserveCache = this.isViewingUserProfile(blockedUserId);
      this.refreshUserData(blockedUserId, preserveCache);
    }
  }

  /* Gère la confirmation de déblocage */
  private handleUserUnblocked(data: any): void {
    const { unblockedUserId } = data;
    if (unblockedUserId) {
      const preserveCache = this.isViewingUserProfile(unblockedUserId);
      this.refreshUserData(unblockedUserId, preserveCache);
    }
  }

  /* Gère l'envoi de demande d'ami */
  private handleFriendRequestSent(data: any): void {
    this.uiUtils.showSuccessPopup(data.message || 'Friend request sent');
  }

  /* Gère la réception de demande d'ami */
  private handleFriendRequestReceived(data: any): void {
    const { requester } = data;
    if (requester) {
      this.uiUtils.showSuccessPopup(`${requester.username} sent you a friend request`);
    }
  }

  /* Gère l'envoi de défi */
  private handleGameChallengeSent(data: any): void {
    this.uiUtils.showSuccessPopup(data.message || 'Challenge sent');
  }

  /* Gère la réception de défi */
  private handleGameChallengeReceived(data: any): void {
    const { challenger } = data;
    if (challenger) {
      this.showGameChallengePopup(challenger.id, challenger.username);
    }
  }

  /* Gère les changements de présence */
  private handlePresenceUpdate(data: any): void {
    const { user } = data;
    if (!user) return;

    // Mettre à jour le statut en ligne dans les données utilisateur
    for (const [userId, userData] of this.otherUserData.entries()) {
      if (userData.user.id === user.id) {
        userData.user.is_online = user.is_online;
        userData.actions = this.calculateUserActions(userId, userData.relationship);
        break;
      }
    }
  }

  /* ===== DIALOGS ET POPUPS ===== */

  /* Affiche le dialog de suppression d'ami */
  private showRemoveFriendDialog(userId: number): void {
    const userData = this.otherUserData.get(userId);
    if (!userData) return;

    if (confirm(`Remove ${userData.user.username} from your friends?`)) {
      this.removeFriend(userId);
    }
  }

  /* Affiche le dialog de défi */
  private showChallengeDialog(userId: number): void {
    const userData = this.otherUserData.get(userId);
    if (!userData) return;

    const message = prompt(`Challenge ${userData.user.username} to a duel?\nMessage (optional):`);
    if (message !== null) {
      this.sendGameChallenge(userId, message || undefined);
    }
  }

  /* Affiche une popup de défi reçu */
  private showGameChallengePopup(challengerId: number, challengerName: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'challenge-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; z-index:10000;`;
    
    const popup = document.createElement('div');
    popup.style.cssText = `
      background:#1a1a2e; border:2px solid #FF9800; border-radius:10px; padding:2rem; text-align:center; color:white; max-width:400px; margin:1rem;`;
    
    popup.innerHTML = `
      <h3 style="margin:0 0 1rem 0; color:#FF9800;">Game Challenge</h3>
      <p style="margin:0 0 1.5rem 0;">${challengerName} challenges you to a Pong duel!</p>
      <div style="display:flex; gap:1rem; justify-content:center;">
        <button id="challenge-decline" style="background:#666;color:#fff;border:none;padding:.5rem 1rem;border-radius:5px;cursor:pointer;">Decline</button>
        <button id="challenge-accept" style="background:#FF9800;color:#fff;border:none;padding:.5rem 1rem;border-radius:5px;cursor:pointer;">Accept</button>
      </div>
    `;
    
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    (popup.querySelector('#challenge-accept') as HTMLButtonElement)?.addEventListener('click', () => {
      overlay.remove();
      this.wsService.createRemoteGame(challengerId);
      this.uiUtils.showSuccessPopup('Challenge accepted! Starting game...');
    });
    
    (popup.querySelector('#challenge-decline') as HTMLButtonElement)?.addEventListener('click', () => {
      overlay.remove();
      this.wsService.declineChallenge(challengerId);
      this.uiUtils.showSuccessPopup('Challenge declined');
    });

    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.remove();
        this.wsService.declineChallenge(challengerId);
      }
    }, 30000);
  }

  /* ===== MÉTHODES UTILITAIRES ===== */

  /* Récupère les données en cache d'un utilisateur */
  public getCachedUserData(userId: number): OtherUserData | null {
    return this.otherUserData.get(userId) || null;
  }

  /* Vérifie si les données d'un utilisateur sont en cours de chargement */
  public isLoadingUser(userId: number): boolean {
    return this.loadingUsers.has(userId);
  }

  /* Attend la fin du chargement d'un utilisateur avec timeout de 5 secondes */
  private async waitForLoading(userId: number): Promise<void> {
    const maxWait = 5000; // 5 secondes max
    const start = Date.now();
    
    while (this.loadingUsers.has(userId) && (Date.now() - start) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /* Rafraîchit les données d'un utilisateur et met à jour l'interface si nécessaire */
  private async refreshUserData(userId: number, preserveCache: boolean = false): Promise<void> {
    const viewingProfile = this.isViewingUserProfile(userId);
    const keepCache = preserveCache || viewingProfile;

    if (keepCache) {
      const updatedData = await this.fetchOtherUserDataPayload(userId);
      if (updatedData) {
        this.otherUserData.set(userId, updatedData);
      }
    } else {
      this.clearUserCache(userId);
      await this.loadOtherUserData(userId);
    }
    
    if (viewingProfile) {
      const pongApp = (window as any)?.pongApp;
      if (pongApp && typeof pongApp.render === 'function') {
        pongApp.render();
      }
    }
  }

  /* Récupère les données complètes d'un utilisateur depuis l'API */
  private async fetchOtherUserDataPayload(userId: number): Promise<OtherUserData | null> {
    try {
      const headers = this.wsService.getAuthHeaders();
      const [statsResponse, matchesResponse, relationshipData] = await Promise.all([
        fetch(`/api/auth/users/${userId}/stats`, { method: 'GET', headers }),
        fetch(`/api/auth/users/${userId}/matches?limit=20`, { method: 'GET', headers }),
        this.loadUserRelationship(userId)
      ]);

      if (!statsResponse.ok || !matchesResponse.ok) {
        console.error('Failed to load other user data:', {
          statsOk: statsResponse.ok,
          matchesOk: matchesResponse.ok
        });
        return null;
      }

      const statsData = await statsResponse.json();
      const matchesData = await matchesResponse.json();
      const actions = this.calculateUserActions(userId, relationshipData);

      return {
        user: statsData.user,
        stats: statsData.stats,
        matches: matchesData.matches || [],
        actions,
        relationship: relationshipData
      };
    } catch (error) {
      console.error('Error fetching other user data payload:', error);
      return null;
    }
  }

  /* Efface le cache d'un utilisateur */
  public clearUserCache(userId: number): void {
    this.otherUserData.delete(userId);
  }

  /* Efface tout le cache */
  public clearAllCache(): void {
    this.otherUserData.clear();
    this.loadingUsers.clear();
    this.blockedUsers.clear();
    this.friendRequests.clear();
  }

  /* Vérifie si un utilisateur est bloqué */
  public isUserBlocked(userId: number): boolean {
    const userData = this.otherUserData.get(userId);
    return userData?.actions?.isBlocked || false;
  }

  /* Vérifie si un utilisateur est ami */
  public isUserFriend(userId: number): boolean {
    const userData = this.otherUserData.get(userId);
    return userData?.actions?.isFriend || false;
  }

  /* Récupère les actions disponibles pour un utilisateur */
  public getUserActions(userId: number): UserProfileActions | null {
    const userData = this.otherUserData.get(userId);
    return userData?.actions || null;
  }

  /* Gère les mises à jour de relation d'amitié */
  private async handleFriendshipUpdate(data: any): Promise<void> {
    const friendId = this.extractFriendId(data);
    if (!friendId) return;
    if (!this.shouldRefreshUser(friendId)) return;
    const preserveCache = this.isViewingUserProfile(friendId);
    await this.refreshUserData(friendId, preserveCache);
  }

  /* Extrait l'ID de l'ami depuis les différents formats de données */
  private extractFriendId(data: any): number | null {
    if (!data) return null;
    const candidate =
      data.friendId ??
      data.friend_id ??
      data?.friend?.id ??
      data?.data?.friendId ??
      data?.data?.friend_id ??
      data?.data?.by?.id ??
      data?.data?.target_id ??
      data?.targetId;
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /* Détermine si les données d'un utilisateur doivent être rafraîchies */
  private shouldRefreshUser(userId: number): boolean {
    return this.otherUserData.has(userId) || this.isViewingUserProfile(userId);
  }

  /* Vérifie si l'utilisateur est actuellement en train de consulter le profil */
  private isViewingUserProfile(userId: number): boolean {
    try {
      const pongApp = (window as any)?.pongApp;
      const routerInfo = pongApp?.router?.isViewingOtherUserProfile?.();
      return !!routerInfo?.isOther && Number(routerInfo.userId) === Number(userId);
    } catch {
      return false;
    }
  }
}
