// frontend/src/core/UIUtils.ts

export class UIUtils {

  /* Affiche une popup de succès */
  public showSuccessPopup(message: string): void { this.createPopup(message, 'success'); }

  /* Affiche une popup d'erreur */
  public showErrorPopup(message: string): void { this.createPopup(message, 'error'); }

  /* Affiche une popup de chargement */
  public showLoadingPopup(message: string): void { this.createPopup(message, 'loading'); }

  /* Masque la popup de chargement */
  public hideLoadingPopup(): void {
    const popup = document.getElementById('auth-popup');
    if (popup) {
      popup.remove();
    }
  }

  /* Crée et affiche une popup avec animation */
  public createPopup(message: string, type: 'success' | 'error' | 'loading'): void {
    document.getElementById('auth-popup')?.remove();

    const popup = document.createElement('div');
    popup.id = 'auth-popup';
    
    let backgroundColor = '';
    let icon = '';
    
    switch (type) {
      case 'success':
        backgroundColor = '#333251';
        icon = '✓';
        break;
      case 'error':
        backgroundColor = '#4f2149';
        icon = '✗';
        break;
      case 'loading':
        backgroundColor = '#2a364f';
        icon = '...';
        break;
    }

    popup.style.cssText = `
      position:fixed; bottom:10px; right:15px; z-index:9999;
      color:#fff; padding:10px 12px; border-radius:6px; font-size:.85rem; max-width:280px;
      box-shadow:0 2px 10px rgba(0,0,0,.3); animation:slideIn .3s ease-out;
      pointer-events:none;
      background:${backgroundColor};
    `;
    popup.innerHTML = `<div style="display:flex;align-items:center;gap:6px;"><span>${icon}</span><span>${message}</span></div>`;

    if (!document.getElementById('popup-animations')) {
      const style = document.createElement('style');
      style.id = 'popup-animations';
      style.textContent = `
        @keyframes slideIn { from{ transform:translateX(100%); opacity:0 } to{ transform:translateX(0); opacity:1 } }
        @keyframes slideOut{ from{ transform:translateX(0); opacity:1 }   to{ transform:translateX(100%); opacity:0 } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(popup);
    
    // Ne pas auto-supprimer les popups de loading
    if (type !== 'loading') {
      setTimeout(() => {
        if (!popup.parentNode) return;
        popup.style.animation = 'slideOut .3s ease-in';
        setTimeout(() => popup.parentNode && popup.parentNode.removeChild(popup), 300);
      }, 4000);
    }
  }

  /* Génère l'affichage d'un avatar utilisateur */
  public renderAvatar(user: any, size: number = 40): string {
    if (!user) return '';
    const baseBox = `width:${size}px; height:${size}px; border-radius:50%;`;
    const txt = `${Math.floor(size * .4)}px`;
    const initial = user.username?.charAt(0)?.toUpperCase?.() || '?';

    return user.avatar_url
      ? `
        <img src="${user.avatar_url}" alt="${user.username}"
             style="${baseBox} display:block;" data-action="img-fallback"/>
        <div style="display:none; ${baseBox} background:rgba(255,255,255,.1);
                    align-items:center; justify-content:center; font-size:${txt}; font-weight:bold; color:#fff;">
          ${initial}
        </div>`
      : `
        <div style="${baseBox} background:rgba(255,255,255,.1); display:flex; align-items:center; justify-content:center;
                    font-size:${txt}; font-weight:bold; color:#fff;">${initial}</div>`;
  }

  /* Formate une date au format lisible */
  public formatDate(dateString: string): string {
    try {
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return dateString; }
  }

  /* Formate une heure au format lisible */
  // public formatTime(dateString: string): string {
  //   try {
  //     return new Date(dateString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  //   } catch { return dateString; }
  // }

  /* Formate une date avec heure */
  // public formatDateTime(dateString: string): string {
  //   try {
  //     return new Date(dateString).toLocaleString('en-US', {
  //       year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  //     });
  //   } catch { return dateString; }
  // }

  /* Échappe le HTML pour éviter les injections */
  public escapeHtml(text: string): string { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

  /* Tronque un texte si trop long */
  // public truncateText(text: string, maxLength: number): string { return text.length <= maxLength ? text : text.slice(0, maxLength - 3) + '...'; }

  /* Calcule le pourcentage de victoires */
  // public calculateWinRate(wins: number, total: number): number { return total ? Math.round((wins / total) * 100) : 0; }

  /* Retourne une couleur aléatoire */
  // public getRandomColor(): string {
  //   const colors = ['#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#feca57','#ff9ff3','#54a0ff','#5f27cd'];
  //   return colors[Math.floor(Math.random() * colors.length)];
  // }

  /* Crée une fonction avec délai d'exécution (debounce) */
  // public debounce(func: Function, wait: number): Function {
  //   let timeout: number | undefined;
  //   return (...args: any[]) => { clearTimeout(timeout); timeout = window.setTimeout(() => func(...args), wait); };
  // }

  /* Vérifie si un email est valide */
  // public isValidEmail(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

  /* Vérifie si une URL est valide */
  // public isValidUrl(url: string): boolean { try { new URL(url); return true; } catch { return false; } }

  /* Copie un texte dans le presse-papiers */
  // public copyToClipboard(text: string): void {
  //   (navigator.clipboard?.writeText(text) ?? Promise.reject())
  //     .then(() => this.showSuccessPopup('Copied to clipboard!'))
  //     .catch(() => {
  //       const ta = document.createElement('textarea');
  //       ta.value = text; document.body.appendChild(ta); ta.select();
  //       try { document.execCommand('copy'); this.showSuccessPopup('Copied to clipboard!'); }
  //       catch { this.showErrorPopup('Failed to copy to clipboard'); }
  //       document.body.removeChild(ta);
  //     });
  // }

  /* Fait défiler la page vers le haut */
  // public scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  /* Fait défiler la page jusqu'à un élément */
  // public scrollToElement(elementId: string): void { document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth' }); }

  /* Indique si un utilisateur est bloqué côté client */
  public isUserBlocked(userId: number): boolean {
    try {
      const chatController = (window as any)?.pongApp?.chat;
      return !!chatController?.isBlocked?.(userId);
    } catch (error) {
      console.error('[UIUTILS] Error checking blocked state:', error);
      return false;
    }
  }
}




// rgb(255, 255, 255)  // #ffffff - Blanc
// rgb(198, 32, 157)   // #c6209d - Rose/Magenta
// rgb(126, 137, 242)  // #7e89f2ff - Violet-Bleu
// rgb(79, 33, 73)     // #4f2149 - Rose foncé
// rgb(14, 165, 233)   // #0ea5e9 - Bleu ciel
// rgb(15, 23, 42)     // #0f172a - Bleu ardoise
// rgb(59, 130, 246)   // #3b82f6 - Bleu vif
// rgb(255, 215, 0)    // #ffd700 - Jaune doré

