// frontend/src/services/GuestAuthService.ts

/*
 Service pour gérer l'authentification des guests dans les tournois
 Les guests obtiennent un token temporaire qui est stocké en sessionStorage
 */
export class GuestAuthService {
  private static readonly GUEST_TOKEN_KEY = 'guest_tournament_token';
  private static readonly GUEST_ALIAS_KEY = 'guest_tournament_alias';
  private static readonly GUEST_USER_ID_KEY = 'guest_user_id';

  /* Génère un nouveau token guest depuis le backend */
  static async generateGuestToken(): Promise<{ token: string; userId: number }> {
    try {
      console.log('[GuestAuth] Requesting new guest token from backend');

      const response = await fetch('https://localhost:3443/api/guest/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error('Failed to generate guest token');
      }

      const data = await response.json();
      const token = data.token;
      const userId = data.userId;

      // Stocker le token ET l'userId en sessionStorage
      sessionStorage.setItem(this.GUEST_TOKEN_KEY, token);
      sessionStorage.setItem(this.GUEST_USER_ID_KEY, String(userId));

      console.log('[GuestAuth] ✅ Guest token and userId stored:', {
        token: token.substring(0, 20) + '...',
        userId
      });

      // Déclencher un événement personnalisé pour que WebSocket se reconnecte
      window.dispatchEvent(new CustomEvent('guest-token-ready'));
      console.log('[GuestAuth] 📡 Event "guest-token-ready" dispatched');

      return { token, userId };
    } catch (error) {
      console.error('[GuestAuth] Error generating guest token:', error);
      throw error;
    }
  }

  /* Récupère le token guest actuel depuis sessionStorage */
  static getGuestToken(): string | null {
    return sessionStorage.getItem(this.GUEST_TOKEN_KEY);
  }

  /* Récupère l'userId guest depuis sessionStorage */
  static getGuestUserId(): number | null {
    const id = sessionStorage.getItem(this.GUEST_USER_ID_KEY);
    return id ? Number(id) : null;
  }

  /* Vérifie si l'utilisateur actuel est un guest */
  static isGuest(): boolean {
    return !!this.getGuestToken();
  }

  /* Vérifie si l'utilisateur est authentifié (user ou guest) */
  static isAuthenticated(): boolean {
    // Vérifier si c'est un user enregistré
    const userToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (userToken && !userToken.startsWith('guest_')) {
      return true;
    }

    // Sinon vérifier si c'est un guest
    return this.isGuest();
  }

  /* Stocke l'alias du guest */
  static setGuestAlias(alias: string): void {
    sessionStorage.setItem(this.GUEST_ALIAS_KEY, alias);
    console.log('[GuestAuth] Guest alias stored:', alias);
    try {
      window.dispatchEvent(new CustomEvent('guest-alias-updated', { detail: { alias } }));
      console.log('[GuestAuth] 📡 Event "guest-alias-updated" dispatched');
    } catch (e) {
      console.warn('[GuestAuth] Failed to dispatch alias event:', e);
    }
  }

  /* Récupère l'alias du guest */
  static getGuestAlias(): string | null {
    return sessionStorage.getItem(this.GUEST_ALIAS_KEY);
  }

  /* Valide le token guest auprès du backend */
  static async validateGuestToken(token?: string): Promise<boolean> {
    try {
      const tokenToValidate = token || this.getGuestToken();

      if (!tokenToValidate) {
        return false;
      }

      const response = await fetch('https://localhost:3443/api/guest/validate', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenToValidate}`
        }
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      
      // Si le token est valide et qu'on n'a pas l'userId stocké, le stocker
      if (data.valid === true && data.session?.userId) {
        const storedUserId = this.getGuestUserId();
        if (!storedUserId) {
          sessionStorage.setItem(this.GUEST_USER_ID_KEY, String(data.session.userId));
          console.log('[GuestAuth] ✅ Guest userId stored from validation:', data.session.userId);
        }
      }
      
      return data.valid === true;
    } catch (error) {
      console.error('[GuestAuth] Error validating guest token:', error);
      return false;
    }
  }

  /* Nettoie les données du guest (déconnexion) */
  static clearGuestData(): void {
    sessionStorage.removeItem(this.GUEST_TOKEN_KEY);
    sessionStorage.removeItem(this.GUEST_ALIAS_KEY);
    sessionStorage.removeItem(this.GUEST_USER_ID_KEY);
    console.log('[GuestAuth] Guest data cleared');
  }

  /* Obtient les headers d'authentification (pour user ou guest) */
  static getAuthHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Priorité 1: Token guest
    const guestToken = this.getGuestToken();
    if (guestToken) {
      headers['Authorization'] = `Bearer ${guestToken}`;
      return headers;
    }

    // Priorité 2: Token user enregistré
    const userToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (userToken) {
      headers['Authorization'] = `Bearer ${userToken}`;
    }

    return headers;
  }

  /* Obtient l'identifiant de l'utilisateur actuel (userId) */
  static getUserIdentifier(): { userId?: number; guestToken?: string } {
    // Si c'est un guest
    const guestUserId = this.getGuestUserId();
    if (guestUserId) {
      return { userId: guestUserId };
    }

    // Si c'est un user enregistré
    try {
      const userToken = sessionStorage.getItem('token') || localStorage.getItem('token');
      if (userToken && !userToken.startsWith('guest_')) {
        // Décoder le JWT pour obtenir le userId
        const payload = JSON.parse(atob(userToken.split('.')[1]));
        if (payload.userId) {
          return { userId: payload.userId };
        }
      }
    } catch (error) {
      console.warn('[GuestAuth] Failed to decode user token:', error);
    }

    return {};
  }

  /* Obtient le nom d'affichage de l'utilisateur actuel */
  static getDisplayName(): string {
    // Si guest, utiliser l'alias
    if (this.isGuest()) {
      return this.getGuestAlias() || 'Guest';
    }

    // Si user enregistré, essayer de récupérer depuis le token
    try {
      const userToken = sessionStorage.getItem('token') || localStorage.getItem('token');
      if (userToken && !userToken.startsWith('guest_')) {
        const payload = JSON.parse(atob(userToken.split('.')[1]));
        return payload.username || 'User';
      }
    } catch (error) {
      console.warn('[GuestAuth] Failed to get username from token:', error);
    }

    return 'Unknown';
  }

  /* Initialise un guest (génère un token si nécessaire) */
  static async initializeGuest(): Promise<{ token: string; userId: number }> {
    // Vérifier si un token existe déjà
    let token = this.getGuestToken();
    let userId = this.getGuestUserId();

    if (token && userId) {
      // Valider le token existant
      const isValid = await this.validateGuestToken(token);
      
      if (isValid) {
        console.log('[GuestAuth] ✅ Existing guest token is valid, reusing it');
        
        // Déclencher l'événement même si le token existe déjà
        // pour que WebSocket se connecte
        window.dispatchEvent(new CustomEvent('guest-token-ready'));
        console.log('[GuestAuth] 📡 Event "guest-token-ready" dispatched for existing token');
        
        return { token, userId };
      } else {
        console.log('[GuestAuth] ⚠️ Existing guest token is invalid, generating new one');
        this.clearGuestData();
      }
    }

    // Générer un nouveau token
    console.log('[GuestAuth] 🔄 Generating new guest token...');
    return await this.generateGuestToken();
  }
}
