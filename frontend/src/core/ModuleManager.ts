// frontend/src/core/ModuleManager.ts

export class ModuleManager {
  /* Vérifie la compatibilité du navigateur avec les fonctionnalités requises */
  static checkBrowserCompatibility(): boolean {
    try {
      if (typeof WebSocket === 'undefined') return (console.error('WebSocket not supported'), false);
      const c = document.createElement('canvas');
      if (!c.getContext || !c.getContext('2d')) return (console.error('Canvas not supported'), false);
      if (typeof Storage === 'undefined') return (console.error('localStorage not supported'), false);
      return true;
    } catch (error) {
      console.error('Browser compatibility check failed:', error);
      return false;
    }
  }

  /* Initialise les modules (version simplifiée) */
  static async initialize(modules: string[]): Promise<void> { console.log('Initializing modules:', modules); }

  /* Vérifie la connectivité avec le backend */
  static async checkBackendConnection(): Promise<boolean> {
    try { const res = await fetch('https://localhost:3443/health', { method: 'GET', timeout: 5000 } as any); return res.ok; }
    catch (e) { console.warn('Backend connection check failed:', e); return false; }
  }

  /* Affiche les informations système (debug) */
  static logSystemInfo(): void {
    console.log('=== ft_transcendence System Info ===');
    console.table({
      'User Agent': navigator.userAgent,
      'WebSocket support': typeof WebSocket !== 'undefined',
      'Canvas support': !!document.createElement('canvas').getContext,
      'localStorage support': typeof Storage !== 'undefined'
    });
    console.log('=====================================');
  }

  /* Nettoie les ressources et réinitialise les modules */
  static cleanup(): void { console.log('Cleaning up modules...'); }
}
