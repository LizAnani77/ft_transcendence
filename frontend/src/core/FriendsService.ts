// frontend/src/core/FriendsService.ts

import { Friend, MatchHistory } from './interfaces';
import { WebSocketService } from '../services/WebSocketService';
import { UIUtils } from './UIUtils';

export class FriendsService {
  private friends: Friend[] = [];
  private friendRequests: Friend[] = [];
  private searchResults: any[] = [];
  private matchHistory: MatchHistory[] = [];
  private wsService: WebSocketService;
  private uiUtils: UIUtils;

  /* Initialise le service avec WebSocket et utilitaires UI. */
  constructor(wsService: WebSocketService, uiUtils: UIUtils) { this.wsService = wsService; this.uiUtils = uiUtils; }

  /* Retourne la liste des amis. */
  public getFriends(): Friend[] { return this.friends; }

  /* Retourne la liste des demandes d'amis. */
  public getFriendRequests(): Friend[] { return this.friendRequests; }

  /* Retourne les résultats de recherche d'utilisateurs. */
  public getSearchResults(): any[] { return this.searchResults; }

  /* Retourne l'historique des matchs. */
  public getMatchHistory(): MatchHistory[] { return this.matchHistory; }

  /* Réinitialise toutes les données liées aux amis et matchs. */
  public clearData(): void { this.friends = []; this.friendRequests = []; this.searchResults = []; this.matchHistory = []; }

  /* Envoie une requête pour ajouter un ami. */
  public addFriend(friendId: number): void { this.wsService.addFriend(friendId); }

  /* Accepte une demande d'ami. */
  public acceptFriend(friendId: number): void { this.wsService.acceptFriend(friendId); }

  /* Supprime un ami existant. */
  public removeFriend(friendId: number): void { this.wsService.removeFriend(friendId); }

  /* Refuse une demande d'ami. */
  public declineFriend(friendId: number): void { this.wsService.declineFriend(friendId); }

  /* Lance un défi de jeu à un ami */
  public challengeFriend(friendId: number): void { 
    const friend = this.getFriendById(friendId);
    
    if (!friend) {
      this.uiUtils.showErrorPopup('User not found');
      return;
    }
    
    if (!friend.is_online) {
      this.uiUtils.showErrorPopup('Unable to challenge - user is offline');
      return;
    }
    
    // L'ami est en ligne, créer la partie
    this.wsService.createRemoteGame(friendId);
  }

  /* Déclenche un rafraîchissement de l'historique des matchs. */
  public refreshMatchHistory(): void { /* Géré par PongApp */ }

  /* Charge la liste des amis reçue via WebSocket. */
  public handleFriendsLoaded(data: any): void { this.friends = data.friends || []; }

  /* Charge les demandes d'amis reçues via WebSocket. */
  public handleFriendRequestsLoaded(data: any): void { this.friendRequests = data.requests || []; }

  /* Charge les résultats de recherche d'utilisateurs. */
  public handleUsersFound(data: any): void { this.searchResults = data.users || []; }

  /* Gère l'envoi d'une demande d'ami et notifie l'utilisateur. */
  public handleFriendRequestSent(data: any): void { this.uiUtils.showSuccessPopup(data.message); this.searchResults = []; }

  /* Gère l'acceptation d'une demande d'ami et met à jour la liste. */
  public handleFriendAccepted(data: any): void {
    // Supporte plusieurs formes de payload:
    // - { friendId }
    // - { friend: { id, username, avatar_url, is_online } }
    // - { data: { by: { id, username, avatar_url, is_online } } }  // cas 'friend_accepted'
    const payloadFriend = data?.friend || data?.data?.by;
    const friendId = Number(data?.friendId ?? payloadFriend?.id);
    this.uiUtils.showSuccessPopup(data.message || 'Friend request accepted');

    if (!isNaN(friendId)) {
      // Retirer la demande d'amis correspondante si elle existe
      this.friendRequests = this.friendRequests.filter(req => req.id !== friendId);
      // Si le backend nous a envoyé l'objet friend, on peut insérer/mettre à jour localement
      if (payloadFriend && typeof payloadFriend.id === 'number') {
        const idx = this.friends.findIndex(f => f.id === payloadFriend.id);
        const next = {
          id: payloadFriend.id,
          username: payloadFriend.username,
          avatar_url: payloadFriend.avatar_url,
          is_online: !!payloadFriend.is_online
        } as any;
        if (idx >= 0) this.friends[idx] = next; else this.friends.push(next);
      }
    }

    // Rafraîchir pour cohérence serveur (source of truth)
    this.wsService.getFriends();
    this.wsService.getFriendRequests();
  }

  /* Gère le refus d'une demande d'ami et met à jour la liste. */
  public handleFriendDeclined(data: any): void {
    this.uiUtils.showSuccessPopup(data.message);
    this.friendRequests = this.friendRequests.filter(req => req.id !== data.friendId);
    this.wsService.getFriendRequests();
  }

  /* Gère la suppression d'un ami et nettoie les listes locales. */
  public handleFriendRemoved(data: any): void {
    const hasMessage = typeof data?.message === 'string' && data.message.trim().length > 0;
    if (hasMessage) {
      this.uiUtils.showSuccessPopup(data.message);
    }
    this.friends = this.friends.filter(friend => friend.id !== data.friendId);
    this.friendRequests = this.friendRequests.filter(req => req.id !== data.friendId);
  }

  /* Affiche une erreur lors de la gestion des demandes d'amis. */
  public handleFriendRequestError(data: any): void { this.uiUtils.showErrorPopup(data.error); }

  /* Charge l'historique des matchs reçu via WebSocket. */
  public handleMatchHistoryLoaded(data: any): void { this.matchHistory = data.matches || []; }

  /* Retourne uniquement les amis actuellement en ligne. */
  public getOnlineFriends(): Friend[] { return this.friends.filter(f => f.is_online); }

  /* Recherche un ami par son identifiant. */
  public getFriendById(id: number): Friend | undefined { return this.friends.find(f => f.id === id); }

  /* Vérifie si une demande est en attente de la part d'un utilisateur. */
  public hasPendingRequestFrom(userId: number): boolean { return this.friendRequests.some(req => req.id === userId); }

  /* Vérifie si un utilisateur est déjà ami. */
  public isFriend(userId: number): boolean { return this.friends.some(f => f.id === userId); }

  /* Retourne le nombre total d'amis. */
  public getFriendCount(): number { return this.friends.length; }

  /* Retourne le nombre de demandes d'amis en attente. */
  public getPendingRequestCount(): number { return this.friendRequests.length; }

  /* Retourne le nombre d'amis actuellement en ligne. */
  public getOnlineFriendCount(): number { return this.friends.filter(f => f.is_online).length; }

  /* Vide les résultats de recherche. */
  public clearSearchResults(): void { this.searchResults = []; }

  /* Vérifie si des résultats de recherche existent. */
  public hasSearchResults(): boolean { return this.searchResults.length > 0; }

  /* Retourne les matchs récents avec une limite (10 par défaut). */
  public getRecentMatches(limit: number = 10): MatchHistory[] { return this.matchHistory.slice(0, limit); }

  /* Retourne uniquement les matchs gagnés. */
  public getWins(): MatchHistory[] { return this.matchHistory.filter(m => m.result === 'win'); }

  /* Retourne uniquement les matchs perdus. */
  public getLosses(): MatchHistory[] { return this.matchHistory.filter(m => m.result === 'loss'); }

  /* Calcule et retourne le taux de victoire en pourcentage. */
  public getWinRate(): number { if (!this.matchHistory.length) return 0; const wins=this.getWins().length; return Math.round((wins/this.matchHistory.length)*100); }
}