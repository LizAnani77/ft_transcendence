// frontend/src/components/Navigation.ts

import { i18n } from '../core/I18n';

export class Navigation {
  /* Affiche la barre de navigation latérale en fonction de l'état de connexion de l'utilisateur */
  static render(currentUser: any = null): string {
    const isLogged = !!currentUser;
    const getCurrentPath = () => {
      const h = (window.location.hash || '').replace(/^#/, '');
      const path = h.startsWith('/') ? h : window.location.pathname;
      return path.split('?')[0];
    };

    // Style de la sidebar
    const sidebarStyle = `
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--sidebar-width);
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
      padding: 2rem 0;
      z-index: 2147483647;
      pointer-events: auto;
      isolation: isolate;
      transition: width 0.3s ease;
      height: 100svh;
      max-height: 100dvh; /* fallback haute précision desktop */
      overflow: hidden;
      min-height: 0;
    `;

    // Style du brand en haut de la sidebar
    const brandStyle = `
      color: #fff;
      text-decoration: none;
      font-size: calc(var(--brand-size-px) / var(--page-zoom) * 1px);
      line-height: 1.1;
      white-space: nowrap;
      font-weight: bold;
      padding: 0 1.5rem;
      margin-bottom: 2rem;
      display: block;
      pointer-events: auto;
    `;

    // Style des liens de navigation
    const getLinkStyle = (isActive: boolean) => {
      const baseStyle = `
        color: #fff;
        text-decoration: none;
        padding: 0.75rem 1.5rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.95rem;
        transition: all 0.3s ease;
        border-left: 3px solid ${isActive ? '#fff' : 'transparent'};
        background: ${isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent'};
        pointer-events: auto;
      `;
      return baseStyle;
    };

    // Badge utilisateur - en haut de la sidebar
    const userBadgeStyle = `
      padding: 1rem 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    `;

    const avatarWrapStyle = `
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #fff;
    `;

    const logoutBtnStyle = `
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 0.85rem;
      font-family: Jura, sans-serif;
      outline: none;
      pointer-events: auto;
      width: 100%;
    `;

    // Langues switcher - en bas de la sidebar
    const langSwitcherStyle = `
      display: flex;
      gap: 0.4rem;
      padding: 1rem 1.5rem;
      margin-top: auto;
      justify-content: center;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const LANG_BTN = (code: string) =>
      `<button data-action="set-lang" data-lang="${code}" title="${code.toUpperCase()}"
          style="background: rgba(255, 255, 255, 0.08); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; flex: 1; transition: all 0.3s ease;">
        ${code.toUpperCase()}
      </button>`;

    const link = (href: string, label: string, icon: string) => {
      const isActive = getCurrentPath() === href;
      const hoverClass = isActive ? '' : 'sidebar-link-hover';
      return `<a class="nav-link ${hoverClass}" href="${href}" data-link="${href}" style="${getLinkStyle(isActive)}" title="${label}">
        <span class="material-symbols-outlined">${icon}</span>
        <span>${label}</span>
      </a>`;
    };

    // Navigation links selon l'état de connexion
    const navigationLinks = isLogged
      ? `
        ${link('/welcome', i18n.t('nav.home'), 'home')}
        ${link('/profile', i18n.t('nav.profile'), 'person')}
        ${link('/dashboard', i18n.t('nav.dashboard'), 'dashboard')}
        ${link('/online-game', i18n.t('nav.onlineGame'), 'sports_esports')}
        ${link('/friends', i18n.t('nav.friends'), 'group')}
        ${link('/chat', i18n.t('nav.chat'), 'chat')}
        ${link('/tournament', i18n.t('nav.tournament'), 'emoji_events')}
      `
      : `
        ${link('/welcome', i18n.t('nav.home'), 'home')}
        ${link('/auth', i18n.t('nav.login'), 'login')}
        ${link('/game', i18n.t('nav.play'), 'sports_esports')}
        ${link('/tournament', i18n.t('nav.tournament'), 'emoji_events')}
      `;

    // Badge utilisateur si connecté
    const userBadge = isLogged
      ? `
      <div style="${userBadgeStyle}">
        <div style="${avatarWrapStyle}">
          ${currentUser.avatar_url
            ? `<img src="${currentUser.avatar_url}" alt="${currentUser.username}" 
                style="width: 40px; height: 40px; border-radius: 50%; pointer-events: auto;" />`
            : ''}
          <span style="font-size: 0.9rem; font-weight: 500;">${currentUser.username}</span>
        </div>
        <button class="nav-button" data-action="logout" style="${logoutBtnStyle}">${i18n.t('nav.logout')}</button>
      </div>`
      : '';

    const langSwitcher = `
      <div style="${langSwitcherStyle}">
        ${LANG_BTN('en')}
        ${LANG_BTN('fr')}
        ${LANG_BTN('es')}
      </div>
    `;

    return `
      <nav class="sidebar-nav" style="${sidebarStyle}">
        <a class="nav-link" href="/" data-link="/" style="${brandStyle}">PONG</a>
        ${userBadge}
        <div style="
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-height: 0;                 
          overflow-y: auto;             
          overscroll-behavior: contain;  
          scrollbar-gutter: stable both-edges; 
          padding-right: 0.25rem;       
        ">
          ${navigationLinks}
        </div>
        ${langSwitcher}
      </nav>
    `;
  }
}
