// frontend/src/core/PageRenderer.ts

import { Navigation } from '../components/Navigation';
import { UserStats, Friend } from './interfaces';
import { UIUtils } from './UIUtils';
import { i18n } from './I18n';

export class PageRenderer {
  private uiUtils: UIUtils;

  /* Constructeur : instancie les utilitaires UI */
  constructor() { this.uiUtils = new UIUtils(); }
  
  /* Affiche la page d'accueil (landing page) */
  public renderLandingPage(): string {
    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="text-align:center;max-width:600px;padding:2rem">
          <h1 style="font-size:4rem;margin-bottom:3rem;font-weight:bold">${i18n.t('app.name')}</h1>
          <button data-action="navigate-welcome hover-elevate" style="background:#fff;color:#040011ff;border:none;padding:1.5rem 3rem;font-size:1.5rem;font-weight:bold;border-radius:8px;cursor:pointer;transition:all .3s;box-shadow:0 4px 15px rgba(255,255,255,.3)">${i18n.t('landing.enter')}</button>
        </div>
      </div>`;
  }

  public renderOAuth42Callback(currentUser: any): string {
    const card = 'background:rgba(255,255,255,.1);border-radius:10px;padding:32px;max-width:360px;width:100%;text-align:center;border:1px solid rgba(255,255,255,.2)';
    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh">
        ${Navigation.render(currentUser)}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;padding:2rem">
          <div style="${card}">
            <h2 style="margin-bottom:.5rem">${i18n.t('auth.oauth42.finalizingTitle')}</h2>
            <p style="opacity:.8;margin-bottom:0">${i18n.t('auth.oauth42.finalizingBody')}</p>
          </div>
        </div>
      </div>`;
  }

  /* Affiche la page de bienvenue avec boutons et infos utilisateur */
  public renderWelcomePage(currentUser: any, userStats: UserStats | null, friendRequests: Friend[]): string {
    const isLogged = !!currentUser;
    const rankText = isLogged && currentUser?.rank_position != null ? `#${currentUser.rank_position}` : '-';

    // Bloc utilisateur centré, 1 seul avatar (celui du profil) – pas d'avatar par défaut "nav"
    const userSection = isLogged
      ? `<div style="text-align:center;margin-bottom:2rem">
           <div style="background:rgba(255,255,255,.1);border-radius:8px;padding:1.5rem;margin:0 auto;max-width:320px">
             <div style="margin-bottom:1rem;display:flex;justify-content:center">${this.uiUtils.renderAvatar(currentUser,80)}</div>
             <p style="color:#fff;font-size:1.1rem;margin:0">${currentUser.username}</p>
             ${userStats ? `<p style="color:#fff;font-size:.85rem;margin:.5rem 0 0;opacity:.8">
               ${userStats.games_won} ${i18n.t('dashboard.winsLabel')} / ${userStats.games_lost} ${i18n.t('dashboard.lossesLabel')} | ${i18n.t('welcome.rank')}: ${rankText}
             </p>` : ''}
           </div>
         </div>` : '';

    const btn = 'padding:1rem 2rem;font-size:1rem;font-weight:bold;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;text-decoration:none;border:none;transition:all .3s;text-align:center';
    
    // Badge de notification pour le chat (exactement comme Friends)
    const chatButtonWithBadge = isLogged ? `
      <a href="/chat" data-link="/chat" class="hover-bright" style="${btn}" id="chat-link-with-badge">
        ${i18n.t('welcome.chat')}
      </a>` : '';

    const buttons = `
      <div style="display:grid;gap:1rem;max-width:400px">
        ${!isLogged ? `<a href="/auth" data-link="/auth" class="hover-bright" style="${btn}">${i18n.t('welcome.login')}</a>` : ``}
        ${!isLogged ? `<a href="/game" data-link="/game" class="hover-bright" style="${btn}">${i18n.t('welcome.play')}</a>` : ``}
        <a href="/tournament" data-link="/tournament" class="hover-bright" style="${btn}">${i18n.t('welcome.tournament')}</a>
        ${isLogged ? `
          <a href="https://localhost:3443/#/online-game" class="hover-bright" style="${btn}">${i18n.t('welcome.game')}</a>
          <a href="/profile"   data-link="/profile"  class="hover-bright" style="${btn}">${i18n.t('welcome.profile')}</a>
          <a href="/dashboard" data-link="/dashboard" class="hover-bright" style="${btn}">${i18n.t('welcome.dashboard')}</a>
          <a href="/friends"   data-link="/friends"  class="hover-bright" style="${btn}">${i18n.t('welcome.friends')} ${friendRequests.length>0?`(${friendRequests.length})`:''}</a>
          ${chatButtonWithBadge}` : ''}
      </div>`;

    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh">
        ${Navigation.render(currentUser)}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem">
          <h1 style="text-align:center;font-size:1.5rem;margin-bottom:2rem">${i18n.t('welcome.title')}</h1>
          ${userSection}${buttons}
        </div>
      </div>`;
  }

  /* Affiche la page d'authentification (login et register) */
  public renderAuth(currentUser: any): string {
    const input = 'width:100%;padding:12px;margin-bottom:12px;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:4px;box-sizing:border-box;outline:none';
    const card  = 'background:rgba(255,255,255,.1);border-radius:8px;padding:24px;margin-bottom:24px;max-width:300px;width:100%';
    const btn = 'width:100%;padding:12px;background:rgba(255,255,255,0.25);color:#fff;border-radius:4px;cursor:pointer';
      return `
      <div style="background-color:transparent;color:#fff;min-height:100vh">
        ${Navigation.render(currentUser)}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem">
          <h1 style="text-align:center;font-size:1.5rem;margin-bottom:2rem">${i18n.t('auth.title')}</h1>
          <div id="login-card" style="${card}">
              <h2 style="font-size:1rem;margin-bottom:1rem">${i18n.t('auth.login')}</h2>
            <form id="login-form" autocomplete="off">
              <input type="text" name="username" placeholder="${i18n.t('auth.username')}" value="" autocomplete="off" required style="${input}" />
              <input type="password" name="password" placeholder="${i18n.t('auth.password')}" value="" autocomplete="new-password" required style="${input.replace('margin-bottom:12px','margin-bottom:16px')}" />
              <button type="submit" style="${btn}">${i18n.t('auth.login')}</button>
            </form>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.15)">
              <button type="button" data-action="oauth42-login" style="width:100%;padding:12px;background:#0f172a;color:#fff;border:1px solid rgba(14,165,233,.6);border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600">
                <span>${i18n.t('auth.oauth42.button')}</span>
                <span style="display:inline-flex;width:22px;height:22px;border-radius:6px;background:#fff;color:#0f172a;font-weight:700;align-items:center;justify-content:center">42</span>
              </button>
            </div>
          </div>
          <div id="register-card" style="${card}">
            <h2 style="font-size:1rem;margin-bottom:1rem">${i18n.t('auth.register')}</h2>
            <form id="register-form" autocomplete="off">
              <input type="text" name="username" placeholder="${i18n.t('auth.username')}" value="" autocomplete="off" required style="${input}" />
              <input type="password" name="password" placeholder="${i18n.t('auth.password')}" value="" autocomplete="new-password" required style="${input.replace('margin-bottom:12px','margin-bottom:16px')}" />
              <button type="submit" style="${btn}">${i18n.t('auth.register')}</button>
            </form>
          </div>
		  <!-- Carte 2FA, masquée tant que non requise -->
		  <div id="twofa-card" style="${card};display:none">
			<h2 style="font-size:1rem;margin-bottom:1rem">${i18n.t('auth.twofa.title')}</h2>
			<form id="login-2fa-form" autocomplete="off">
			  <input type="text" name="code" placeholder="${i18n.t('auth.twofa.placeholder')}" inputmode="numeric" pattern="[0-9]*" maxlength="6" required style="${input}" />
			  <div style="display:flex;gap:8px">
			    <button type="submit" style="${btn}">${i18n.t('auth.verify')}</button>
			    <button type="button" id="twofa-cancel" style="width:100%;padding:12px;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:4px;cursor:pointer" >
			      ${i18n.t('auth.cancel')}
			    </button>
			  </div>
			  <p id="twofa-error" style="color:#ff6b6b;margin-top:8px;display:none"></p>
			</form>
		  </div>
        </div>
      </div>`;
  }

  /* Affiche la page de jeu en ligne (Online Game) - uniquement pour utilisateurs connectés */
  public renderOnlineGame(currentUser: any, friends: Friend[]): string {
  const btn = 'padding:1rem 2rem;font-size:1rem;font-weight:bold;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;text-decoration:none;border:none;transition:all .3s;cursor:pointer;display:block;text-align:center';
  const unblockBtn = `${btn};background:#c6209d;color:#fff;`;

    const hasFriends = friends && friends.length > 0;

    if (hasFriends) {
      friends.sort((a, b) => Number(b.is_online) - Number(a.is_online));
    }
    
    const friendListHtml = hasFriends
      ? friends.map(f => {
          const online = !!f.is_online;
          const isBlocked = this.uiUtils.isUserBlocked(f.id);
          const blockedText = isBlocked ? ` ${i18n.t('friends.blockedTag')}` : '';
          const statusDot = online
            ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7e89f2ff;margin-right:6px"></span>`
            : `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#fff ;margin-right:6px"></span>`;
          const status = online ? `${i18n.t('profile.status.online')}` : `${i18n.t('profile.status.offline')}`;
          const avatar = this.uiUtils.renderAvatar(f, 45);
          const actionButton = isBlocked
            ? `<button data-action="unblock-user" data-id="${f.id}" style="${unblockBtn}">${i18n.t('user.unblock')}</button>`
            : (online
                ? `<a data-action="challenge-friend" data-friend-id="${f.id}" class="hover-bright" style="${btn}">${i18n.t('profile.challenge')}</a>`
                : `<a class="hover-bright" style="${btn};opacity:.5;pointer-events:none">${i18n.t('profile.challenge')}</a>`);
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 1rem;background:rgba(255,255,255,.06);border-radius:8px;${isBlocked ? 'opacity:0.5;' : ''}">
              <div style="display:flex;align-items:center;gap:.75rem">
                <div style="display:flex;align-items:center;justify-content:center">${avatar}</div>
                <div style="display:flex;flex-direction:column;line-height:1.2">
                  <a href="/profile?user=${f.id}" data-link="/profile?user=${f.id}" 
                    style="margin-bottom:2px;color:inherit;text-decoration:none;cursor:pointer;font-weight:600">
                    ${f.username}${blockedText}
                  </a>
                  <span style="font-size:.85rem;opacity:.6;display:flex;align-items:center">
                     ${statusDot} <span>${status}</span>
                  </span>
                </div>
              </div>
              ${actionButton}
            </div>
          `;
        }).join('')
      : '';

    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh">
        ${Navigation.render(currentUser)}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem">
          <h1 style="text-align:center;font-size:1.5rem;margin-bottom:3rem">${i18n.t('game.online.title')}</h1>
          <div style="display:grid;gap:1.5rem;max-width:500px;width:100%">
            ${hasFriends ? friendListHtml : `
              <div style="margin-bottom:2rem">
                <div style="padding:1rem;background:#333251;border-radius:8px;margin-bottom:1rem;text-align:center">
                  <p style="color:#fff;margin:0">${i18n.t('game.online.noFriends')}</p>
                </div>
                <a href="/friends" data-link="/friends" class="hover-bright" style="${btn}">${i18n.t('game.online.addFriends')}</a>
              </div>
            `}
            <a href="/chat" data-link="/chat" class="hover-bright" style="${btn}">${i18n.t('game.online.challengeCommunity')}</a>
            <a href="/tournament" data-link="/tournament" class="hover-bright" style="${btn}">${i18n.t('game.online.tournament')}</a>
          </div>
        </div>
      </div>`;
  }

  /* Affiche la page 404 en cas de route non trouvée */
  public render404(currentUser: any): string {
    return `
      <div style="background-color:#040011ff;color:#fff;min-height:100vh">
        ${Navigation.render(currentUser)}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem">
          <h1 style="font-size:4rem;margin-bottom:1rem">404</h1>
          <p style="font-size:1.5rem;margin-bottom:2rem">${i18n.t('errors.404.title')}</p>
          <a href="/" data-link="/" style="color:#fff;text-decoration:none;padding:1rem 2rem;background:rgba(255,255,255,.1);border-radius:8px;border:1px solid rgba(255,255,255,.2)">${i18n.t('errors.404.backHome')}</a>
        </div>
      </div>`;
  }
}
