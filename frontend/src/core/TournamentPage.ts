// frontend/src/core/TournamentPage.ts

import { TournamentBinder } from './TournamentBinder';

/* Monte la page Tournoi dans l'élément #app (ou le conteneur donné) */
export function mountTournamentPage(container?: HTMLElement): void {
  console.log('[TournamentPage] 🚀 mountTournamentPage() called');
  const root: HTMLElement = container || document.getElementById('app') || document.body;
  const app = (window as any).pongApp;

  if (!app) {
    root.innerHTML = `<div style="color:#fff;padding:2rem">App not initialized.</div>`;
    return;
  }

  const svc = app.tournamentService;
  const getUser = () => app.authService?.getCurrentUser?.();
  const wsService = app.wsService;

  // Liste blanche d'éléments à préserver
  const PRESERVE_SELECTORS = [
    '.overlay-game-invite',
    '[data-preserve="true"]',
    'nav',
    '[role="navigation"]',
    '.game-invitation',
    '[data-game-invite]',
    '[id^="inv-"]',
    '[id^="join-"]'
  ];

  /* Vérification sécurisée si un élément doit être préservé */
  const shouldPreserve = (element: Element): boolean => {
    return PRESERVE_SELECTORS.some(selector => {
      try {
        return element.matches(selector) || element.closest(selector) !== null;
      } catch {
        return false;
      }
    });
  };

  /* Nettoyage ciblé et non agressif des overlays */
  const cleanupBlockingOverlays = () => {
    try {
      console.debug('[TournamentPage] Starting cleanup of blocking overlays');
      
      // 1. Nettoyer uniquement les dialogues qui ne sont pas préservés
      const dialogSelectors = ['[role="dialog"]', '.modal', '.popup', '.overlay'];
      
      dialogSelectors.forEach(selector => {
        document.querySelectorAll<HTMLElement>(selector).forEach(el => {
          if (shouldPreserve(el)) {
            console.debug('[TournamentPage] Preserving element:', el.className || el.id);
            return;
          }

          try {
            const style = getComputedStyle(el);
            const isFixed = style.position === 'fixed';
            const zIndex = parseInt(style.zIndex) || 0;
            
            // Supprimer seulement si position fixed avec z-index élevé
            if (isFixed && zIndex > 1000) {
              console.debug('[TournamentPage] Removing blocking overlay:', el.className || el.id);
              el.remove();
            }
          } catch (e) {
            console.warn('[TournamentPage] Error checking element:', e);
          }
        });
      });

      // 2. Nettoyer les hints de jeu non préservés
      const hintElement = document.getElementById('esc-finish-hint');
      if (hintElement && !shouldPreserve(hintElement)) {
        hintElement.remove();
      }

      // 3. Neutraliser les éléments qui bloquent (sans les supprimer)
      const headerHeight = 96;
      const blockingElements = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .filter(el => {
          // Ignorer navigation
          if (el.tagName.toLowerCase() === 'nav') return false;
          
          // Ignorer éléments préservés
          if (shouldPreserve(el)) return false;

          try {
            const style = getComputedStyle(el);
            if (style.position !== 'fixed') return false;

            const rect = el.getBoundingClientRect();
            
            // Élément qui couvre une zone significative près du header
            return rect.top <= headerHeight && 
                   rect.bottom > 0 && 
                   rect.width > 200 && 
                   rect.height > 50;
          } catch {
            return false;
          }
        });

      blockingElements.forEach(el => {
        try {
          // Neutraliser plutôt que supprimer
          el.style.pointerEvents = 'none';
          el.style.zIndex = '0';
          console.debug('[TournamentPage] Neutralized blocking element:', el.className || el.id);
        } catch (e) {
          console.warn('[TournamentPage] Error neutralizing element:', e);
        }
      });

      console.debug('[TournamentPage] Cleanup completed');
      
    } catch (e) {
      console.error('[TournamentPage] Error in cleanupBlockingOverlays:', e);
    }
  };

  /* Assurer la visibilité de la navigation avec isolation */
  const ensureNavigationVisibility = () => {
    try {
      const navElements = document.querySelectorAll('nav, [role="navigation"]');
      
      navElements.forEach(nav => {
        const navEl = nav as HTMLElement;
        
        // NE PAS changer la position - respecter le fixed left de Navigation.ts
        // navEl.style.position = 'relative'; // SUPPRIMÉ - cassait la navigation à gauche
        
        // Forcer au premier plan avec isolation
        navEl.style.zIndex = '2147483647'; // Max z-index
        navEl.style.pointerEvents = 'auto';
        
        // Créer nouveau contexte de stacking
        (navEl.style as any).isolation = 'isolate';
        
        console.debug('[TournamentPage] Navigation visibility ensured');
      });
    } catch (e) {
      console.warn('[TournamentPage] Error ensuring navigation visibility:', e);
    }
  };

  /* Corriger les éléments mal positionnés de manière ciblée */
  const fixElementPositioning = () => {
    try {
      // 1. Configurer le root
      if (root.id === 'app') {
        root.style.position = 'relative';
        root.style.zIndex = '1';
        root.style.pointerEvents = 'auto';
      }

      // 2. Identifier éléments fixed problématiques (sauf navigation et préservés)
      const problematicElements = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .filter(el => {
          try {
            const style = getComputedStyle(el);
            
            // Ignorer si pas fixed
            if (style.position !== 'fixed') return false;
            
            // Ignorer navigation
            if (el.tagName.toLowerCase() === 'nav') return false;
            
            // Ignorer éléments préservés
            if (shouldPreserve(el)) return false;
            
            return true;
          } catch {
            return false;
          }
        });

      // 3. Traiter uniquement les éléments qui couvrent beaucoup d'espace
      problematicElements.forEach(el => {
        try {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const zIndex = parseInt(style.zIndex) || 0;
          
          const coversLargeArea = rect.width > window.innerWidth * 0.5 && 
                                  rect.height > window.innerHeight * 0.5;
          
          const hasHighZIndex = zIndex > 100;
          
          if (coversLargeArea && hasHighZIndex) {
            console.debug('[TournamentPage] Fixing problematic element:', el.className || el.id);
            el.style.pointerEvents = 'none';
            el.style.zIndex = '0';
          }
        } catch (e) {
          console.warn('[TournamentPage] Error fixing element:', e);
        }
      });

      console.debug('[TournamentPage] Element positioning fixed');
      
    } catch (e) {
      console.warn('[TournamentPage] Error fixing element positioning:', e);
    }
  };

  /* Vérifier l'intégrité du DOM avant render */
  const validateDOMIntegrity = (): boolean => {
    try {
      // Vérifier que root existe et est attaché au DOM
      if (!root || !document.body.contains(root)) {
        console.error('[TournamentPage] Root element not in DOM');
        return false;
      }

      // Vérifier que pongApp est disponible
      if (!app || !app.tournamentService) {
        console.error('[TournamentPage] Required app services not available');
        return false;
      }

      return true;
    } catch (e) {
      console.error('[TournamentPage] DOM integrity check failed:', e);
      return false;
    }
  };

  /* Handler d'erreur global pour le binder */
  const handleBinderError = (error: any) => {
    console.error('[TournamentPage] Binder error:', error);
    
    root.innerHTML = `
      <div style="color:#fff;padding:2rem;text-align:center;min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="max-width:500px;">
          <h1 style="margin-bottom:1rem;font-size:1.8rem;">Tournament Error</h1>
          <div style="background:rgba(255,0,0,0.1);border-radius:8px;padding:2rem;margin-bottom:2rem;">
            <p style="color:#ff6b6b;margin-bottom:1rem;">
              Failed to load tournament interface.
            </p>
            <p style="opacity:.8;font-size:.9rem;margin-bottom:1rem;">
              ${error?.message || 'Unknown error'}
            </p>
            <button 
              data-action="reload"
              style="background:#6366f1;color:white;border:none;padding:.75rem 1.5rem;border-radius:6px;cursor:pointer;font-size:.9rem;">
              Reload Page
            </button>
          </div>
        </div>
      </div>`;
  };

  /* Gérer le paramètre ?join=ID pour rejoindre un tournoi */
  console.log('[TournamentPage] 🔍 Checking for ?join parameter...');
  console.log('[TournamentPage] window.location.hash:', window.location.hash);

  // Extraire les paramètres depuis le hash (ex: #/tournament?join=6)
  const hashParts = window.location.hash.split('?');
  const queryString = hashParts.length > 1 ? hashParts[1] : '';
  const urlParams = new URLSearchParams(queryString);
  const joinTournamentId = urlParams.get('join');

  console.log('[TournamentPage] Query string from hash:', queryString);
  console.log('[TournamentPage] joinTournamentId:', joinTournamentId);

  if (joinTournamentId) {
    const tournamentId = parseInt(joinTournamentId, 10);
    if (!isNaN(tournamentId)) {
      console.log('[TournamentPage] Auto-joining tournament:', tournamentId);
      const currentUser = getUser();
      const playerAlias = currentUser?.username || `Guest${Date.now()}`;
      const userId = currentUser?.id;

      // Rejoindre le tournoi de manière asynchrone
      svc.joinTournament(tournamentId, playerAlias, userId)
        .then(() => {
          console.log('[TournamentPage] Successfully joined tournament:', tournamentId);
          // Nettoyer l'URL pour éviter de rejoindre à nouveau
          window.history.replaceState({}, '', '#/tournament');
        })
        .catch((error: any) => {
          console.error('[TournamentPage] Failed to join tournament:', error);
          console.error('[TournamentPage] Error message:', error?.message);
          console.error('[TournamentPage] Error string:', error?.toString());

          // Afficher un popup d'erreur en anglais
          let errorMessage = 'Unable to join tournament';
          const errorStr = error?.message || error?.toString() || '';

          console.log('[TournamentPage] Error string for matching:', errorStr);

          if (errorStr.includes('finished') || errorStr.includes('completed')) {
            errorMessage = 'This tournament has already finished';
          } else if (errorStr.includes('cancelled') || errorStr.includes('canceled')) {
            errorMessage = 'This tournament has been cancelled';
          } else if (errorStr.includes('full') || errorStr.includes('maximum')) {
            errorMessage = 'This tournament is full';
          } else if (errorStr.includes('started') || errorStr.includes('in progress')) {
            errorMessage = 'This tournament has already started';
          }

          console.log('[TournamentPage] Showing error popup:', errorMessage);

          // Nettoyer l'URL d'abord
          window.history.replaceState({}, '', '#/tournament');

          // Afficher le popup après un court délai pour s'assurer que la page est bien chargée
          setTimeout(() => {
            app.uiUtils.showErrorPopup(errorMessage);
          }, 100);
        });
    }
  }

  /* Création du binder avec gestion d'erreur complète */
  let binder: TournamentBinder | null = null;

  try {
    // Validation préliminaire
    if (!validateDOMIntegrity()) {
      throw new Error('DOM integrity check failed');
    }

    // ✅ Création du TournamentBinder avec 4 arguments
    binder = new TournamentBinder(
      svc,
      getUser,
      (html: string) => {
        try {
          // 1. Injecter le HTML
          root.innerHTML = html;

          // 2. Configurer le root
          root.style.pointerEvents = 'auto';
          root.style.position = 'relative';
          root.style.zIndex = '1';

          // 3. Nettoyage ciblé (SANS toucher aux invitations)
          cleanupBlockingOverlays();

          // 4. Assurer visibilité navigation en PREMIER
          ensureNavigationVisibility();

          // 5. Corriger positionnement des éléments
          fixElementPositioning();

          // 6. Protection finale de la navigation
          setTimeout(() => {
            ensureNavigationVisibility();
          }, 100);

          console.debug('[TournamentPage] Render completed successfully');

        } catch (renderError) {
          console.error('[TournamentPage] Render error:', renderError);
          throw renderError;
        }
      },
      wsService
    );

    // Nettoyage initial prudent
    try {
      cleanupBlockingOverlays();
      ensureNavigationVisibility();
    } catch (cleanupError) {
      console.warn('[TournamentPage] Initial cleanup error:', cleanupError);
    }

    // Render initial avec gestion d'erreur
    try {
      console.debug('[TournamentPage] Starting initial render');
      binder.renderAndBind();
      console.debug('[TournamentPage] Initial render completed');
    } catch (renderError) {
      console.error('[TournamentPage] Initial render failed:', renderError);
      handleBinderError(renderError);
    }

  } catch (error) {
    console.error('[TournamentPage] Initialization error:', error);
    handleBinderError(error);
  }

  /* Cleanup au démontage de la page */
  const cleanup = () => {
    try {
      console.debug('[TournamentPage] Cleanup triggered');
      
      if (binder) {
        binder.cleanup();
        binder = null;
      }

      console.debug('[TournamentPage] Cleanup completed');
    } catch (e) {
      console.error('[TournamentPage] Cleanup error:', e);
    }
  };

  // Enregistrer cleanup pour navigation SPA
  try {
    (window as any).__tournamentPageCleanup = cleanup;
  } catch (e) {
    console.warn('[TournamentPage] Could not register cleanup:', e);
  }
}

/* Fonction utilitaire pour déclencher cleanup manuellement */
export function unmountTournamentPage(): void {
  try {
    const cleanup = (window as any).__tournamentPageCleanup;
    if (typeof cleanup === 'function') {
      cleanup();
      delete (window as any).__tournamentPageCleanup;
    }
  } catch (e) {
    console.error('[TournamentPage] Unmount error:', e);
  }
}

export default { mountTournamentPage, unmountTournamentPage };