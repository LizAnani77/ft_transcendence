// main.ts - Point d'entrée de l'application ft_transcendence

import { PongApp } from './core/PongApp';
import { ModuleManager } from './core/ModuleManager';
import './styles/main.css';
import './core/initEventListeners';
import { i18n } from './core/I18n';

/* Flag environnement robuste (fonctionne même si les types Vite ne sont pas présents) */
const isProd: boolean = (() => {
  try { const env = (import.meta as any)?.env; return env?.PROD === true; } catch { return false; }
})();

/* NOUVEAU : Initialise une session unique pour cet onglet (résout le problème de connexions multiples) */
function initializeSessionIsolation(): void {
  try {
    console.log('[Session] Initialisation de l\'isolation par onglet...');
    
    // 1. Nettoyer localStorage pour éviter les conflits entre onglets
    localStorage.removeItem('token');
    
    // 2. Générer un ID de session unique pour cet onglet si pas déjà fait
    if (!sessionStorage.getItem('sessionId')) {
      const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2);
      sessionStorage.setItem('sessionId', sessionId);
      console.log('[Session] ID généré:', sessionId);
    }

    // 3. Vérifier l'état des tokens
    const sessionToken = sessionStorage.getItem('token');
    const localToken = localStorage.getItem('token');
    
    if (localToken) {
      console.warn('[Session] Token localStorage détecté et supprimé');
      localStorage.removeItem('token');
    }
    
    if (sessionToken) {
      console.log('[Session] Token de session existant');
    }
    
    console.log('[Session] Isolation configurée avec succès');
    
  } catch (e) {
    console.error('[Session] Erreur lors de l\'initialisation:', e);
  }
}

/* NOUVEAU : Configure le nettoyage de session lors de la fermeture */
function setupSessionCleanup(): void {
  window.addEventListener('beforeunload', () => {
    console.log('[Session] Fermeture onglet - nettoyage en cours...');
    // Le nettoyage détaillé se fait via AuthService et WebSocketService
  });
}

/* Affiche l'UI d'erreur bloquante lorsqu'un démarrage échoue */
function showStartupError(err: unknown): void { 
  const app = document.getElementById('app'); if (!app) return;
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:transparent;color:white;text-align:center;padding:2rem;text-shadow:0 0 5px #ffffff,0 0 10px #ffffff;">
      <h1 style="color:#c6209d;margin-bottom:1rem;font-size:2rem;">Failed to start ft_transcendence</h1>
      <p style="color:#9ca3af;margin-bottom:2rem;max-width:600px;line-height:1.6;">${err instanceof Error ? err.message : 'Unknown error occurred'}</p>
      <button data-action="reload" style="background:#4e23f8;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:bold;">Retry</button>
      <div style="margin-top:2rem;color:#6b7280;font-size:.875rem;">
        <p>Make sure:</p>
        <ul style="text-align:left;max-width:400px;">
          <li>Your browser supports WebSocket and Canvas</li>
          <li>JavaScript is enabled</li>
          <li>Backend server is running on https://localhost:3443</li>
        </ul>
      </div>
    </div>`;
}

/* Démarre l'application après chargement du DOM */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('Starting ft_transcendence...');
    
    /* NOUVEAU : Initialiser l'isolation de session AVANT tout le reste */
    initializeSessionIsolation();
    setupSessionCleanup();
    
    /* Vérifier la compatibilité du navigateur */
    if (!ModuleManager.checkBrowserCompatibility()) throw new Error('Browser not compatible with ft_transcendence');
    /* i18n: détecter et charger la langue AVANT tout rendu*/
    try {
      await i18n.loadInitialLanguage();
    } catch (e) {
      console.error('i18n init failed, forcing EN fallback', e);
      try { await i18n.setLang('en'); } catch {}
    }

    /* Créer l'instance de l'application */
    const app = new PongApp();
    
    /* Initialiser les modules de base */
    await ModuleManager.initialize(['router','game-engine','websocket','tournament-system']);
    
    /* Vérifier la connexion backend */
    const backendConnected = await ModuleManager.checkBackendConnection();
    if (!backendConnected) console.warn('Backend not available - some features may be limited');
    
    /* Démarrage de l'application */
    await app.start();

    /* ✅ Lever le rideau une fois le premier rendu injecté (évite le flash blanc/placeholder) */
    document.documentElement.classList.add('app-ready');

    console.log('ft_transcendence started successfully!\nNavigation system ready\nTournament system ready (in-memory mode)\nGame engine loaded\nWebSocket service initialized\nSession isolation active');
    
    /* Mode debug */
    if (window.location.search.includes('debug=true')) {
      ModuleManager.logSystemInfo();
      
      // NOUVEAU : Ajout des infos de session dans le debug
      console.group('[Session Debug]');
      console.log('SessionId:', sessionStorage.getItem('sessionId'));
      console.log('Session token:', sessionStorage.getItem('token') ? 'Présent' : 'Absent');
      console.log('Local token:', localStorage.getItem('token') ? 'PROBLÈME!' : 'Absent (OK)');
      console.groupEnd();
    }
    
  } catch (error) {
    console.error('Failed to start ft_transcendence:', error);
    showStartupError(error);
  }
});

/* MODIFIÉ : Nettoyage lors de la fermeture de la page avec session */
window.addEventListener('beforeunload', () => { 
  /* Nettoyage global modules/services */ 
  ModuleManager.cleanup(); 
  
  /* NOUVEAU : Log de fermeture session */
  console.log('[Session] Application fermée');
});

/* Gestion du retour en arrière du navigateur */
window.addEventListener('popstate', () => { 
  /* L'application gère déjà cela dans PongApp */ 
  console.log('Browser navigation detected'); 
});

/* Gestion des erreurs globales */
window.addEventListener('error', (event: ErrorEvent) => { 
  /* Capture des erreurs runtime non catchées */
  console.error('Global error:', event.error); 
  if (isProd) { 
    /* Exemple: sendToErrorTracking(event.error); */ 
  }
});

/* Gestion des promesses rejetées non gérées */
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => { 
  /* Capture des rejets non gérés */
  console.error('Unhandled promise rejection:', event.reason); 
  event.preventDefault(); 
  if (isProd) { 
    /* Exemple: sendToErrorTracking(event.reason); */ 
  }
});

/* NOUVEAU : Export pour debug en développement */
if (!isProd && typeof window !== 'undefined') {
  (window as any).ftSessionDebug = {
    logSessionInfo: () => {
      console.group('[Session Debug]');
      console.log('SessionId:', sessionStorage.getItem('sessionId'));
      console.log('Session token:', sessionStorage.getItem('token') ? 'Présent' : 'Absent');
      console.log('Local token:', localStorage.getItem('token') ? 'PROBLÈME!' : 'Absent (OK)');
      console.log('Protocol:', location.protocol);
      console.log('Host:', location.host);
      console.groupEnd();
    },
    clearSession: () => {
      sessionStorage.clear();
      localStorage.removeItem('token');
      console.log('[Debug] Session nettoyée');
    },
    reinitializeSession: () => {
      initializeSessionIsolation();
      console.log('[Debug] Session réinitialisée');
    }
  };
}

/* Déclaration TypeScript pour les propriétés globales */
declare global { 
  interface Window { 
    pongApp: any;
    ftSessionDebug?: {
      logSessionInfo: () => void;
      clearSession: () => void;
      reinitializeSession: () => void;
    };
  } 
}