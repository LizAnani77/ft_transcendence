// frontend/src/core/SocialRenderer.ts

import { Navigation } from '../components/Navigation';
import { UIUtils } from './UIUtils';
import { Friend } from './interfaces';
import { i18n } from './I18n';

export class SocialRenderer {
  private uiUtils: UIUtils;

  constructor(uiUtils: UIUtils) { this.uiUtils = uiUtils; }

  /* Page Chat*/
  public renderChat(currentUser: any, friends: Friend[]): string {
    if (!currentUser) return '';
    const page = 'background-color:transparent;color:#ffffff;min-height:100vh;';
    const shell = 'max-width:1200px;margin:0 auto;padding:2rem;';
    const card = 'background:rgba(255,255,255,.1);border-radius:8px;padding:1rem;';
    const profileLink = 'color:#fff;text-decoration:none;transition:color 0.2s ease;';
    const truncatedNameStyle = `${profileLink};display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    
    const allFriends = friends || [];

    const tabStyle = 'padding:0.75rem 1.5rem;background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px 8px 0 0;font-weight:bold;font-size:0.9rem;margin-bottom:0;';

    const listHTML = allFriends.length
      ? allFriends.map(friend => {
          
          const isBlocked = this.uiUtils.isUserBlocked(friend.id);
          const opacity = isBlocked ? 'opacity:0.5;' : '';
          const blockedIndicator = isBlocked ? ' 🚫' : '';
          const statusColor = friend.is_online ? '#7e89f2ff' : '#666';
          const statusLabel = friend.is_online ? i18n.t('profile.status.online') : i18n.t('profile.status.offline');
          
          return `
            <div class="chat-recipient" data-action="select-chat-recipient hover-highlight"
                data-friend-id="${friend.id}" data-friend-username="${friend.username}" 
                style="display:flex;align-items:center;gap:0.5rem;justify-content:space-between;padding:0.5rem;border-radius:4px;cursor:pointer;transition:background 0.2s ease;${opacity}">
              <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0;">
                ${this.uiUtils.renderAvatar(friend,40)}
                <div style="display:flex;flex-direction:column;gap:0.2rem;min-width:0;">
                  <a href="/profile?user=${friend.id}" data-link="/profile?user=${friend.id}" 
                     style="${truncatedNameStyle}" data-hover-link="true"
                     data-action="stop-propagation">${friend.username}${blockedIndicator}</a>
                  <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.7rem;color:#888;min-width:0;">
                    <span style="color:${statusColor};flex-shrink:0;">●</span>
                    <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${statusLabel}</span>
                  </div>
                </div>
              </div>
            </div>`;
        }).join('')
      : `<div style="font-size:.75rem;color:#888;text-align:center;margin-top:1rem;">${i18n.t('chat.noFriends')}</div>`;

    return `
      <div style="${page}">
        ${Navigation.render(currentUser)}
        <div style="${shell}">
          <h1 style="text-align:left;font-size:1.5rem;margin-bottom:5rem;"> </h1>

          <div style="display:grid;grid-template-columns:1fr 3fr;gap:2rem;height:70vh;">
            <!-- Sidebar -->
            <div style="display:flex;flex-direction:column;gap:1rem;">
              
              <!-- Global Chat (always visible) -->
              <div style="${card}">
                <div style="margin-bottom:1rem;">
                  <button id="tab-global" style="${tabStyle}" data-action="switch-to-global">
                    ${i18n.t('chat.global')}
                  </button>
                </div>
                <div style="font-size:.75rem;color:#888;">
                </div>
              </div>

              <!-- Friends list -->
              <div style="${card}">
                <h3 style="margin-bottom:1rem;font-size:.85rem;text-transform:uppercase;font-weight:bold;">${i18n.t('friends.title')}</h3>
                <div style="color:#ccc;">
                  <div style="padding:.5rem;background:rgba(255,255,255,.1);border-radius:4px;margin-bottom:.5rem;font-size:.85rem;">
                    ${this.uiUtils.renderAvatar(currentUser,40)} 
                    <a href="/profile" data-link="/profile" style="${profileLink}" data-hover-link="true">${currentUser.username}</a> (${i18n.t('chat.you')})
                  </div>
                  ${listHTML}
                </div>
              </div>
            </div>

            <!-- Main Chat Area -->
            <div class="chat-under">
              <div class="chat-under__row">
                <h3 id="chat-header-name" style="text-transform:uppercase;font-weight:bold;">${i18n.t('chat.global')}</h3>
                <div id="chat-profile-link" style="display:none;">
                  <a href="#" id="chat-view-profile" style="${profileLink};font-size:0.8rem;" data-hover-link="true">
                    ${i18n.t('chat.viewProfile')}
                  </a>
                </div>
              </div>

              <!-- Global chat limitation indicator -->
              <div id="global-chat-notice" style="display:none;font-size:0.7rem;color:#888;margin-bottom:0.5rem;">
              </div>

              <!-- Messages area -->
              <div id="chat-messages" style="flex:1;overflow-y:auto;border-radius:6px;background:rgba(255,255,255,.04);padding:1rem;font-size:.75rem;">
                <!-- Géré dynamiquement -->
              </div>

              <!-- Typing indicators -->
              <div id="typing-indicators" style="display:none;font-size:0.7rem;color:#888;margin:0.5rem 0;padding:0.25rem 0.5rem;background:rgba(255,255,255,.02);border-radius:4px;font-style:italic;">
              </div>

              <!-- Input area -->
              <div style="display:flex;gap:.5rem;margin-top:.5rem;">
                <input id="chat-input" type="text" placeholder="${i18n.t('chat.loading')}" 
                  style="flex:1;padding:.5rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#fff;" disabled />
                <button id="chat-send" data-action="send-chat-message"
                style="padding:.5rem .75rem;border-radius:6px;background:rgba(255,255,255,0.25);color:#fff;border:none;cursor:pointer;font-weight:bold;"disabled>${i18n.t('chat.send')}</button>
              </div>
              <!-- Character counter -->
              <div style="text-align:right;margin-top:0.15rem;">
                <span id="chat-char-counter" style="font-size:0.65rem;color:#aaa;">0/500</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* Friends Page */
  public renderFriends(currentUser: any, friends: Friend[], requests: Friend[], searchResults: any[]): string {
    if (!currentUser) return '';
    const page = 'background-color:transparent;color:#ffffff;min-height:100vh;';
    const shell = 'max-width:1200px;margin:0 auto;padding:2rem;';
    const card = 'background:rgba(255,255,255,.1);border-radius:8px;padding:1rem;';
    const row  = 'display:flex;align-items:center;justify-content:space-between;padding:.5rem;background:rgba(255,255,255,.05);border-radius:4px;margin-bottom:.5rem;gap:.75rem;flex-wrap:wrap;';
    const btn  = 'font-size:.8rem;padding:.4rem .6rem;border-radius:6px;border:none;cursor:pointer;';
    const mbtn = (bg:string, color='#040011ff') => `${btn};background:${bg};color:${color};`;
    const profileLink = 'color:#fff;text-decoration:none;transition:color 0.2s ease;';
    const truncatedNameStyle = `${profileLink};display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    const statusLineStyle = 'display:flex;align-items:center;gap:.35rem;font-size:.75rem;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const rowLeft = 'display:flex;align-items:center;gap:.5rem;flex:1 1 200px;min-width:0;';
    const actionGroup = 'display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;flex:1 1 180px;max-width:100%;';

  
    const allFriends = friends || [];
    const allRequests = requests || [];
    const allSearchResults = searchResults || [];

    const friendsHTML = allFriends.length
      ? allFriends.map(f => {
          const isBlocked = this.uiUtils.isUserBlocked(f.id);
          const opacity = isBlocked ? 'opacity:0.5;' : '';
          const blockedText = isBlocked ? ` ${i18n.t('friends.blockedTag')}` : '';
          
          const actionButtons = isBlocked
            ? `<button data-action="unblock-user" data-id="${f.id}" style="${mbtn('#c6209d','#fff')};border:1px solid #c6209d">${i18n.t('user.unblock')}</button>`
            : `
              <button data-action="challenge-friend" data-friend-id="${f.id}" style="${mbtn('rgba(255,255,255,0.25)', '#fff')}">${i18n.t('profile.challenge')}</button>
              <button data-action="remove-friend" data-id="${f.id}" style="${mbtn('rgba(99,102,241,0.2)', '#ffffff')};font-weight:600">${i18n.t('profile.removeFriend')}</button>
            `;
          
          return `
            <div style="${row}${opacity}">
              <div style="${rowLeft}">
                ${this.uiUtils.renderAvatar(f,40)}
                <div style="display:flex;flex-direction:column;gap:.15rem;min-width:0;">
                  <a href="/profile?user=${f.id}" data-link="/profile?user=${f.id}" style="${truncatedNameStyle}" data-hover-link="true">${f.username}${blockedText}</a>
                  <div style="${statusLineStyle}">
                    ${f.is_online ? `<span style="color:#7e89f2ff;flex-shrink:0;">●</span> ${i18n.t('profile.status.online')}` : i18n.t('profile.status.offline')}
                  </div>
                </div>
              </div>
              <div style="${actionGroup}">
                ${actionButtons}
              </div>
            </div>`;
        }).join('')
      : `<div style="color:#ccc;font-size:.85rem;text-align:center;">${i18n.t('friends.none')}</div>`;

    const requestsHTML = allRequests.length
      ? allRequests.map(r => {
          const isBlocked = this.uiUtils.isUserBlocked(r.id);
          const opacity = isBlocked ? 'opacity:0.5;' : '';
          const blockedText = isBlocked ? ` ${i18n.t('friends.blockedTag')}` : '';
          const actionButtons = isBlocked
            ? `<button data-action="unblock-user" data-id="${r.id}" style="${mbtn('#c6209d','#fff')}">${i18n.t('user.unblock')}</button>`
            : `
              <button data-action="accept-friend" data-id="${r.id}" style="${mbtn('rgba(255,255,255,0.25)', '#fff')}">${i18n.t('friends.accept')}</button>
              <button data-action="decline-friend" data-id="${r.id}" style="${mbtn('#4f2149','#fff')};font-weight:900">${i18n.t('friends.decline')}</button>
            `;
          
          return `
            <div style="${row}${opacity}">
              <div style="${rowLeft}">
                ${this.uiUtils.renderAvatar(r,40)}
                <div style="min-width:0;">
                  <a href="/profile?user=${r.id}" data-link="/profile?user=${r.id}" style="${truncatedNameStyle}" data-hover-link="true">${r.username}${blockedText}</a>
                </div>
              </div>
              <div style="${actionGroup}">
                ${actionButtons}
              </div>
            </div>`;
        }).join('')
      : `<div style="color:#ccc;font-size:.85rem;text-align:center;">${i18n.t('friends.requests.none')}</div>`;

    const resultsHTML = (allSearchResults && allSearchResults.length)
      ? allSearchResults.map((u:any)=>{
          const isBlocked = this.uiUtils.isUserBlocked(u.id);
          const opacity = isBlocked ? 'opacity:0.5;' : '';
          const blockedText = isBlocked ? ` ${i18n.t('friends.blockedTag')}` : '';
          const actionButton = isBlocked
            ? `<button data-action="unblock-user" data-id="${u.id}" style="${mbtn('#c6209d','#fff')}">${i18n.t('user.unblock')}</button>`
            : `<button data-action="add-friend" data-id="${u.id}" style="${mbtn('rgba(255,255,255,0.25)', '#fff')}">${i18n.t('profile.addFriend')}</button>`;
          
          return `
            <div style="${row}${opacity}">
              <div style="${rowLeft}">
                ${this.uiUtils.renderAvatar(u,40)}
                <div style="min-width:0;">
                  <a href="/profile?user=${u.id}" data-link="/profile?user=${u.id}" style="${truncatedNameStyle}" data-hover-link="true">${u.username}${blockedText}</a>
                </div>
              </div>
              <div style="${actionGroup}">
                ${actionButton}
              </div>
            </div>`;
        }).join('')
      : `<div style="color:#ccc;font-size:.85rem;text-align:center;">${i18n.t('friends.search.none')}</div>`;

    return `
      <div style="${page}">
        ${Navigation.render(currentUser)}
        <div style="${shell}">
          <h1 style="text-align:left;font-size:1.5rem;margin-bottom:5rem;"></h1>

          <div style="display:grid;grid-template-columns:2fr 1fr;gap:2rem;">
            <!-- Friends List -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:.85rem;text-transform:uppercase;font-weight:bold;">${i18n.t('friends.title')}</h3>
              <div>${friendsHTML}</div>
            </div>

            <!-- Requests & Search -->
            <div style="display:flex;flex-direction:column;gap:2rem;">
              <div style="${card}">
                <h3 style="margin-bottom:.5rem;font-size:.85rem;text-transform:uppercase;font-weight:bold;">${i18n.t('friends.requests.title')}</h3>
                <div>${requestsHTML}</div>
              </div>

              <div style="${card}">
                <h3 style="margin-bottom:.5rem;font-size:.85rem;text-transform:uppercase;font-weight:bold;">${i18n.t('friends.search.title')}</h3>
                <form id="search-users-form" style="display:flex;gap:.5rem;">
                  <input type="text" name="query" placeholder="${i18n.t('friends.search.placeholder')}" style="flex:1;padding:.5rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#fff;" />
                <button type="submit" style="${mbtn('rgba(255,255,255,0.25)', '#fff')}">${i18n.t('friends.search.button')}</button>
                </form>
                <div style="margin-top:1rem;">${resultsHTML}</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* Attacher seulement les hover effects, les actions sont gérées par PongApp */
  public attachEventListeners(): void {
    console.log('[SOCIAL] ✅ Attaching hover listeners (actions handled by PongApp)...');
    
    // Hover effects sur les liens
    document.querySelectorAll('[data-hover-link="true"]').forEach(link => {
      link.addEventListener('mouseenter', (e) => {
        (e.target as HTMLElement).style.color = '#ccc';
      });
      
      link.addEventListener('mouseleave', (e) => {
        (e.target as HTMLElement).style.color = '#fff';
      });
    });

    document.querySelectorAll('[data-action="stop-propagation"]').forEach(element => {
      element.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });

    console.log('[SOCIAL] ✅ Hover listeners attached (PongApp handles all data-action clicks)');
  }
}
