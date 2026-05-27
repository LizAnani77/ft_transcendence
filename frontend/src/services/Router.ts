// frontend/src/services/Router.ts

/*
 * Router – gère la navigation via HASH routing (#/...) sans history.pushState.
 * Compatible CSP/WAF, Back/Forward natifs, accès direct par /path ou #/path.
 */
export class Router {
  private getLogicalPath(raw?: string): string {
	// Compatible accès direct par path (/welcome) et par hash (#/welcome).
    const url = raw ?? window.location.href;
    try {
      const u = new URL(url, window.location.origin);
      const hash = u.hash?.startsWith('#') ? u.hash.slice(1) : '';
      const candidate = (hash && hash[0] === '/' ? hash : '') || u.pathname; // #/route sinon /route
      return candidate.split('?')[0];
    } catch {
      const h = (window.location.hash || '').replace(/^#/, '');
      return (h.startsWith('/') ? h : window.location.pathname).split('?')[0];
    }
  }
  /* Retourne la vue correspondant au chemin demandé */
  getView(path: string): string {
    const pathname = this.getLogicalPath(path);
    switch (pathname) {
      case '/':
      case '/welcome':    return 'welcome';
      case '/auth':       return 'auth';
      case '/oauth/42/callback': return 'oauth42-callback';
      case '/game':       return 'game';
      case '/online-game': return 'online-game';
      case '/tournament': return 'tournament';
      case '/profile':    return 'profile';
      case '/friends':    return 'friends';
      case '/chat':       return 'chat';
      case '/dashboard':  return 'dashboard';
      default:            return '404';
    }
  }

  /* Récupère les paramètres d'URL (query string) */
  getUrlParams(url?: string): URLSearchParams {
    try {
      const u = new URL(url ?? window.location.href);
      // si on est en hash (#/profile?user=1), on parse la query du hash
      if (u.hash && u.hash.includes('?')) {
        const q = u.hash.substring(u.hash.indexOf('?') + 1);
        return new URLSearchParams(q);
      }
      return u.searchParams;
    } catch {
      return new URLSearchParams();
    }
  }

  navigateTo(path: string): void {
    // liens externes → laisser le navigateur gérer
    try {
      const u = new URL(path, window.location.origin);
      if (u.origin !== window.location.origin) {
        window.location.href = u.toString();
        return;
      }
    } catch { /* href relatif accepté */ }

    // Navigation interne sans reload: on pilote le hash
    // Accepte "/welcome" ou "#/welcome" en entrée
    const cleaned = path.startsWith('#') ? path.slice(1) : path;
    if (!cleaned.startsWith('/')) {
      window.location.hash = '/' + cleaned;
    } else {
      window.location.hash = cleaned;
    }
  }

  /* Raccourci pour aller sur la page d'authentification */
  goToAuth(): void { this.navigateTo('/auth'); }

  /* Raccourci pour aller sur la page d'accueil "welcome" */
  goToWelcome(): void { this.navigateTo('/welcome'); }

  /* Raccourci pour aller sur le profil d'un utilisateur */
  goToUserProfile(userId: number): void { this.navigateTo(`/profile?user=${userId}`); }

  /* Raccourci pour aller sur son propre profil */
  goToOwnProfile(): void { this.navigateTo('/profile'); }

  /* Raccourci pour aller au Dashboard */
  goToDashboard(): void { this.navigateTo('/dashboard'); }

  /* Retourne la route actuellement affichée */
  getCurrentRoute(): string { return this.getLogicalPath(); }

  /* Vérifie si la route courante correspond à une route donnée */
  isCurrentRoute(route: string): boolean { return this.getLogicalPath() === route; }

  isViewingOtherUserProfile(): { isOther: boolean; userId: number | null } {
    if (this.getView(this.getLogicalPath()) !== 'profile') return { isOther: false, userId: null };
    const userParam = this.getUrlParam('user');
    const id = userParam ? parseInt(userParam) : NaN;
    return (!isNaN(id)) ? { isOther: true, userId: id } : { isOther: false, userId: null };
  }

  getUrlParam(name: string, url?: string): string | null { return this.getUrlParams(url).get(name); }
}
