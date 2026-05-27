// frontend/src/core/initEventListeners.ts

import { i18n } from './I18n';

declare global { interface Window { pongApp: any; } }
export {};

/* Récupère un entier depuis data-* (id/index) */
function getInt(el: HTMLElement, key: 'id'|'index'|'friendId'): number | null {
  const v = el.dataset[key]; const n = v ? parseInt(v, 10) : NaN; return Number.isNaN(n) ? null : n;
}

/* Zoom lock for sidebar icons (taille fixe indépendante du zoom navigateur) */
function applyZoomVar() {
    const dpr = window.devicePixelRatio || 1;
    document.documentElement.style.setProperty('--page-zoom', String(dpr));
  }

  applyZoomVar();

  window.addEventListener('resize', applyZoomVar);
  window.addEventListener('orientationchange', applyZoomVar);

  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyZoomVar();
});

/* Initialise les listeners au chargement du DOM */
document.addEventListener('DOMContentLoaded', () => {
  const elements = document.querySelectorAll('[data-action]');
  elements.forEach((el) => {
    const node = el as HTMLElement;
    const actions = (node.dataset.action || '').split(/\s+/).filter(Boolean);
    for (const action of actions) {
      switch (action) {
        case 'logout':                node.addEventListener('click', () => window.pongApp.logout()); break;
        case 'send-on-enter':         node.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') document.getElementById('chat-send')?.click(); }); break;
        case 'navigate-welcome':      node.addEventListener('click', () => window.pongApp.navigate('/welcome')); break;
        case 'start-tournament':      node.addEventListener('click', () => window.pongApp.startTournament()); break;
        case 'play-match':            node.addEventListener('click', () => window.pongApp.playCurrentMatch()); break;
        case 'reset-tournament':      node.addEventListener('click', () => window.pongApp.resetTournament()); break;
        case 'generate-next-match':   node.addEventListener('click', () => window.pongApp.generateNextMatch()); break;
        case 'add-player':            node.addEventListener('click', () => window.pongApp.addPlayer()); break;
        case 'remove-player':         node.addEventListener('click', () => { const i = getInt(node,'index') ?? 0; window.pongApp.removePlayer(i); }); break;
        case 'reload':                node.addEventListener('click', () => window.location.reload()); break;
        case 'refresh-history':       node.addEventListener('click', () => window.pongApp.refreshMatchHistory()); break;
        case 'declare-winner':        node.addEventListener('click', () => { const w = node.dataset.winner; if (w) window.pongApp.declareWinner(w); }); break;
        case 'add-friend':            node.addEventListener('click', () => { const id = getInt(node,'id'); if (id!=null) window.pongApp.addFriend(id); }); break;
        case 'accept-friend':         node.addEventListener('click', () => { const id = getInt(node,'id'); if (id!=null) window.pongApp.acceptFriend(id); }); break;
        case 'decline-friend':        node.addEventListener('click', () => { const id = getInt(node,'id'); if (id!=null) window.pongApp.declineFriend(id); }); break;
        case 'challenge-friend':      node.addEventListener('click', () => { const id = getInt(node,'id'); if (id!=null) window.pongApp.challengeFriend(id); }); break;
        case 'remove-friend':         node.addEventListener('click', () => { const id = getInt(node,'id'); if (id!=null) window.pongApp.removeFriend(id); }); break;
        case 'dev-debug':             node.addEventListener('click', () => console.log('Debug button clicked')); break;
        case 'start-match':           node.addEventListener('click', () => window.pongApp.playCurrentMatch()); break;
        case 'set-lang':              node.addEventListener('click', async (e) => { e.preventDefault(); const code = (node.getAttribute('data-lang') || 'en') as any; if (code === i18n.lang) return; try { await i18n.setLang(code); } catch (err) { console.error('Failed to switch language', err); } }); break;
        default:                      console.warn(`Action inconnue : ${action}`); break;
      }
    }
  });
});

/* Délégation globale pour les clics (fonctionne pour les éléments ajoutés après coup) */
document.addEventListener('click', (evt) => {
  const target = (evt.target as HTMLElement)?.closest?.('[data-action]') as HTMLElement | null; if (!target) return;
  const actions = (target.dataset.action || '').split(/\s+/).filter(Boolean);
  for (const action of actions) {
    switch (action) {
      case 'navigate-welcome':        window.pongApp.navigate('/welcome'); break;
      case 'logout':                  window.pongApp.logout(); break;
      case 'start-tournament':        window.pongApp.startTournament(); break;
      case 'play-match':              window.pongApp.playCurrentMatch(); break;
      case 'reset-tournament':        window.pongApp.resetTournament(); break;
      case 'generate-next-match':     window.pongApp.generateNextMatch(); break;
      case 'declare-winner':          { const w = target.dataset.winner; if (w) window.pongApp.declareWinner(w); } break;
      case 'add-friend':              { const id = getInt(target,'id'); if (id!=null) window.pongApp.addFriend(id); } break;
      case 'accept-friend':           { const id = getInt(target,'id'); if (id!=null) window.pongApp.acceptFriend(id); } break;
      case 'decline-friend':          { const id = getInt(target,'id'); if (id!=null) window.pongApp.declineFriend(id); } break;
      case 'remove-friend':           { const id = getInt(target,'id'); if (id!=null) window.pongApp.removeFriend(id); } break;
      case 'challenge-friend':        { const id = getInt(target,'id'); if (id!=null) window.pongApp.challengeFriend(id); } break;
      case 'start-match':             window.pongApp.playCurrentMatch(); break;
      case 'set-lang':                { evt.preventDefault(); const code = (target.getAttribute('data-lang') || 'en') as any; if (code === i18n.lang) return; i18n.setLang(code).then(() => (window as any).pongApp?.authService?.updatePreferredLanguage?.(code).catch(() => {})).catch((err) => console.error('Failed to switch language', err)); } break;
      default:                        break;
    }
  }
});

/* Délégation globale pour les survols (hover-highlight / hover-elevate) */
document.addEventListener('mouseover', (evt) => {
  const el = (evt.target as HTMLElement)?.closest?.('[data-action*="hover-highlight"],[data-action*="hover-elevate"]') as HTMLElement | null;
  if (!el) return;
  if (el.dataset.action?.includes('hover-highlight')) {
    el.style.backgroundColor = 'rgba(255,255,255,0.1)';
  }
  if (el.dataset.action?.includes('hover-elevate')) {
    (el as HTMLElement).style.transform = 'scale(1.05)';
    (el as HTMLElement).style.boxShadow = '0 6px 20px rgba(255,255,255,.4)';
  }
}, true);

document.addEventListener('mouseout', (evt) => {
  const el = (evt.target as HTMLElement)?.closest?.('[data-action*="hover-highlight"],[data-action*="hover-elevate"]') as HTMLElement | null;
  if (!el) return;
  if (el.dataset.action?.includes('hover-highlight')) {
    el.style.backgroundColor = 'transparent';
  }
  if (el.dataset.action?.includes('hover-elevate')) {
    (el as HTMLElement).style.transform = 'scale(1)';
    (el as HTMLElement).style.boxShadow = '0 4px 15px rgba(255,255,255,.3)';
  }
}, true);

/* Gestion erreurs <img> (fallback avatar) */
document.addEventListener('error', (evt) => {
  const t = evt.target as HTMLElement; if (!t.dataset?.action) return;
  switch (t.dataset.action) {
    case 'img-fallback':
      if (t instanceof HTMLImageElement) { t.style.display='none'; const s = t.nextElementSibling as HTMLElement | null; if (s) s.style.display='flex'; }
      break;
  }
}, true);
