// frontend/src/core/ProfileRenderer.ts

import { Navigation } from '../components/Navigation';
import { UserStats, MatchHistory } from './interfaces';
import { UIUtils } from './UIUtils';
import { OtherUserData } from './OtherUserProfileService';
import { WebSocketService } from '../services/WebSocketService';
import * as QRCode from 'qrcode';
import { i18n } from './I18n';

export class ProfileRenderer {

  private uiUtils: UIUtils;
  private wsService: WebSocketService;

  /* Constructeur, initialise l'outil utilitaire pour l'UI */
  constructor(uiUtils: UIUtils, wsService: WebSocketService) {
    this.uiUtils = uiUtils;
    this.wsService = wsService;
  }

  /* Affiche la page de profil utilisateur avec ses informations, statistiques et historique récent */
  public renderProfile(currentUser: any, userStats: UserStats | null, matchHistory: MatchHistory[]): string {
    return this.renderOwnProfile(currentUser, userStats, matchHistory);
  }

  /* Affiche le profil d'un autre utilisateur (lecture seule) avec système de blocage CORRIGÉ */
  public renderOtherUserProfile(currentUser: any, otherUserData: OtherUserData | null, isLoading: boolean = false): string {
    if (!currentUser) return '';

    if (isLoading) {
      return this.renderLoadingProfile(currentUser);
    }

    if (!otherUserData) {
      return this.renderUserNotFound(currentUser);
    }

    const { user: otherUser, stats, matches, actions, relationship } = otherUserData;
    const winRate = stats && stats.games_played > 0 ? Math.round((stats.games_won / stats.games_played) * 100) : 0;

    const card = 'background:rgba(255,255,255,.1);border-radius:8px;padding:2rem;';
    const grid2 = 'display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:2rem;';

    // Interface unifiée pour utilisateur bloqué avec bouton débloquer cohérent
    if (relationship?.isBlocked) {
      return `
        <div style="background-color:transparent;color:#fff;min-height:100vh;">
          ${Navigation.render(currentUser)}
          <div style="max-width:1000px;margin:0 auto;padding:2rem;">
            <div style="height:4.75rem;"></div>
            
            <!-- Navigation retour -->
            <div style="margin-bottom:2rem;"></div>

            <div style="${card}">
              <div style="text-align:center;padding:2rem;">
      
                <h2 style="margin-bottom:1rem; font-size:1.2rem;text-transform:uppercase;">${i18n.t('profile.blocked.title')}</h2>
                <p style="color:#ccc;margin-bottom:2rem;">${i18n.t('profile.blocked.desc')}</p>
                
                <!-- CORRECTION : Bouton débloquer avec data-action pour le handler global -->
                <button
                  data-action="unblock-user"
                  data-id="${otherUser.id}"
                  style="padding:.5rem 1rem;background:rgba(236,54,200,0.25);color:#fff;border:1px solid #c6209d;border-radius:4px;cursor:pointer;">
                  ${i18n.t('profile.unblock').replace('{username}', otherUser.username)}
                </button>
              </div>
            </div>
          </div>
        </div>`;
    }

    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div style="max-width:1000px;margin:0 auto;padding:2rem;">
          <div style="height:4.75rem;"></div>
          
          <!-- Navigation retour -->
          <div style="margin-bottom:2rem;"></div>

          <div style="${grid2}">
            <!-- Informations de profil (lecture seule) -->
            <div style="${card}">
              <h2 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.header')}</h2>

              <!-- Prévisualisation avatar -->
              <div style="text-align:center;margin-bottom:2rem;">
                <div style="display:inline-block;">${this.uiUtils.renderAvatar(otherUser, 80)}</div>
                <p style="margin-top:.5rem;font-size:.85rem;color:#ccc;">${i18n.t('profile.avatarOf').replace('{username}', otherUser.username)}</p>
              </div>

              <div style="display:grid;gap:1rem;font-size:.85rem;">
                <div><strong>${i18n.t('profile.username')}:</strong> ${otherUser.username}</div>
                <div><strong>${i18n.t('profile.memberSince')}:</strong> ${otherUser.created_at ? new Date(otherUser.created_at).toLocaleDateString() : '—'}</div>
                <div><strong>${i18n.t('profile.lastLogin')}:</strong> ${otherUser.last_login ? new Date(otherUser.last_login).toLocaleDateString() : i18n.t('profile.never')}</div>
              </div>

              <!-- Actions avec système de blocage CORRIGÉ -->
              <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.2);display:flex;gap:1rem;flex-wrap:wrap;">
                ${this.renderActionButtons(otherUser, actions)}
              </div>
            </div>

            <!-- Statistiques de jeu -->
            <div style="${card}">
              <h2 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.stats.header')}</h2>
              ${stats ? `
                <div style="display:grid;gap:1rem;font-size:.85rem;">
                  <div><strong>${i18n.t('profile.rank')}:</strong> ${otherUser?.rank ? `#${otherUser.rank}` : '—'}</div>
                  <div><strong>${i18n.t('profile.stats.gamesPlayed')}:</strong> ${stats.games_played}</div>
                  <div><strong>${i18n.t('profile.stats.wins')}:</strong> ${stats.games_won}</div>
                  <div><strong>${i18n.t('profile.stats.losses')}:</strong> ${stats.games_lost}</div>
                  <div><strong>${i18n.t('profile.stats.winRate')}:</strong> ${winRate}%</div>
                  <div><strong>${i18n.t('profile.stats.tournamentWins')}:</strong> ${stats.tournaments_won}</div>
                  <div><strong>${i18n.t('profile.stats.pointsScored')}:</strong> ${stats.total_points_scored}</div>
                  <div><strong>${i18n.t('profile.stats.pointsConceded')}:</strong> ${stats.total_points_conceded}</div>
                  ${stats.longest_rally > 0 ? `<div><strong>${i18n.t('profile.stats.longestRally')}:</strong> ${stats.longest_rally}</div>` : ''}
                </div>` : `<div style="color:#ccc;font-style:italic;">${i18n.t('profile.stats.none')}</div>`}
            </div>
          </div>

          <!-- Historique des matchs -->
          <div style="${card}">
            <h2 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.history.header')}</h2>
            ${matches && matches.length ? `
              <div style="max-height:300px;overflow-y:auto;">
                ${matches.map(match => `
                  <div style="background:rgba(255,255,255,.1);border-radius:4px;padding:1rem;margin-bottom:.5rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <div style="display:flex;align-items:center;gap:.5rem;font-size:.85rem">
                        ${this.uiUtils.renderAvatar(otherUser, 40)}
                        <div>
                          <strong>vs ${match.opponent.username}</strong>
                          <span style="margin-left:.5rem;color:${match.result === 'win' ? '#7e89f2ff' : '#c6209d'};font-weight:900;">${match.result === 'win' ? i18n.t('profile.match.win') : i18n.t('profile.match.loss')}</span>
                        </div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:1rem;font-weight:bold;">${match.my_score} - ${match.opponent_score}</div>
                        <div style="font-size:.75rem;color:#ccc;">${this.formatMatchDate(match.played_at)}</div>
                      </div>
                    </div>
                  </div>`).join('')}
              </div>` : `
              <div style="color:#fff;font-size:.85rem;text-align:center;">${i18n.t('profile.history.noMatches')}</div>`}
          </div>
        </div>
      </div>`;
  }

  /* Boutons d'action avec data-id uniformisé */
  private renderActionButtons(otherUser: any, actions: any): string {
    if (!actions) return '';

    let buttons: string[] = [];

    // Bouton de blocage unifié (un bouton selon l'état)
    if (actions.isBlocked) {
      // Utilisateur déjà bloqué - Afficher le bouton débloquer avec data-action
      buttons.push(`
        <button
          data-action="unblock-user"
          data-id="${otherUser.id}"
          style="padding:.5rem 1rem;background:rgba(236,54,200,0.25);color:#fff;border-radius:4px;cursor:pointer;"
        >${i18n.t('profile.unblockUser')}</button>
      `);
    } else if (actions.canBlock) {
      // Utilisateur non bloqué - Afficher le bouton bloquer avec data-action
      buttons.push(`
        <button
          data-action="block-user"
          data-id="${otherUser.id}"
          style="padding:.5rem 1rem;background:rgba(236,54,200,0.25);color:#fff;border:1px solid #c6209d;border-radius:4px;cursor:pointer;"
        >${i18n.t('profile.blockUser')}</button>
      `);
    }

    // Boutons normaux (seulement si non bloqué)
    if (!actions.isBlocked) {
      // Bouton défier - EXACTEMENT comme sur Friends
      buttons.push(`
        <button data-action="challenge-friend" data-friend-id="${otherUser.id}"
          style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border:1px solid rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;">
          ${i18n.t('profile.challenge')}
        </button>
      `);

      // Utiliser data-id au lieu de data-user-id
      if (actions.canMessage) {
        buttons.push(`
          <button data-action="chat-with-user" data-id="${otherUser.id}"
            style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border:1px solid rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;">
            ${i18n.t('profile.sendMessage')}
          </button>
        `);
      }

      // Utiliser les MÊMES data-action que sur Friends
      if (actions.canAddFriend) {
        buttons.push(`
          <button data-action="add-friend" data-id="${otherUser.id}"
            style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border:1px solid rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;">
            ${i18n.t('profile.addFriend')}
          </button>
        `);
      } else if (actions.canRemoveFriend) {
        buttons.push(`
          <button data-action="remove-friend" data-id="${otherUser.id}"
            style="padding:.5rem 1rem;background:rgba(99,102,241,0.2);color:#ffffff;border:1px solid #7e89f2ff;border-radius:4px;cursor:pointer;font-weight:600">
            ${i18n.t('profile.removeFriend')}
          </button>
        `);
      } else if (actions.hasPendingRequest) {
        buttons.push(`
          <button disabled
            style="padding:.5rem 1rem;background:#666;color:#ccc;border:none;border-radius:4px;cursor:not-allowed;">
            ${i18n.t('profile.requestSent')}
          </button>
        `);
      }
    }

    return buttons.join('');
  }

  /* Affiche le profil personnel (avec édition) - INCHANGÉ */
  private renderOwnProfile(currentUser: any, userStats: UserStats | null, matchHistory: MatchHistory[]): string {
    if (!currentUser) return '';
    const stats = userStats;
    const winRate = stats && stats.games_played > 0 ? Math.round((stats.games_won / stats.games_played) * 100) : 0;

    const card = 'background:rgba(255,255,255,.1);border-radius:8px;padding:2rem;';
    const input = 'width:100%;padding:.5rem;background:rgba(255,255,255,.1);color:#fff;border-radius:4px;outline:none;box-sizing:border-box;';
    const btn = 'width:100%;padding:12px;background:rgba(255,255,255,0.25);color:#fff;border:1px solid rgba(255,255,255,0.6);border-radius:4px;cursor:pointer';
    const grid2 = 'display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:2rem;';

    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div style="max-width:1000px;margin:0 auto;padding:2rem;">
          <div style="height:4.75rem;"></div>
          <div style="${grid2}">
            <!-- Informations de profil avec avatar -->
            <div style="${card}">
              <h2 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.header')}</h2>

              <!-- Prévisualisation avatar -->
              <div style="text-align:center;margin-bottom:2rem;">
                <div class="avatar-preview-container" style="display:inline-block;">${this.uiUtils.renderAvatar(currentUser, 80)}</div>
                <p style="margin-top:.5rem;font-size:.85rem;color:#ccc;">${i18n.t('profile.currentAvatar')}</p>
              </div>

              <form id="profile-form" style="display:grid;gap:1rem;">
                <div>
                  <label style="display:block;margin-bottom:.5rem;font-size:.85rem;">${i18n.t('profile.username')}:</label>
                  <input type="text" name="username" value="${currentUser.username || ''}" style="${input}" />
                </div>
                <div>
                  <label style="display:block;margin-bottom:.5rem;font-size:.85rem;">${i18n.t('profile.email')}:</label>
                  <input type="email" name="email" value="${currentUser.email || ''}" style="${input}" />
                </div>

                <div>
                  <label style="display:block;margin-bottom:.5rem;font-size:.85rem;">${i18n.t('profile.chooseAvatar')}:</label>
                  <!-- Input caché pour avatar_url -->
                  <input type="hidden" name="avatar_url" value="${currentUser.avatar_url || ''}" />
                  <!-- Sélecteur d'avatar par défaut -->
                  <div style="margin-bottom:1rem;">
                    <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:.5rem;max-width:500px;margin-bottom:1rem;grid-auto-rows:min-content;">
                      ${Array.from({ length: 8 }, (_, i) => i + 1).map(num => `
                        <div data-avatar-num="${num}" style="cursor:pointer;border:1px solid ${currentUser.avatar_url === `/uploads/${num}.png` ? '#fff' : 'transparent'};border-radius:4px;padding:2px;transition:border-color .2s;width:54px;height:54px;display:flex;align-items:center;justify-content:center;">
                          <img src="/uploads/${num}.png" alt="Avatar ${num}" style="width:50px;height:50px;border-radius:4px;display:block;" />
                        </div>`).join('')}
                    </div>
                    <button type="button" data-clear-avatar style="padding:.5rem 1rem;background:rgba(236,54,200,0.25);color:#fff;border:1px solid #c6209d;border-radius:4px;cursor:pointer;">${i18n.t('profile.defaultAvatar')}</button>
                  </div>
                </div>

                <button type="submit" style="${btn}">${i18n.t('profile.update')}</button>
              </form>

			  <!-- Two-Factor Authentication (2FA) -->
        <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.2);">
          <h3 style="margin-bottom:.75rem;font-size:1rem;">${i18n.t('profile.twofa')}</h3>
          ${currentUser.two_factor_enabled
        ? `
              <div style="color:#9be7c4;margin-bottom:.75rem;"><strong>${i18n.t('profile.twofa.status')}: ${i18n.t('profile.twofa.enabled')}</strong></div>
              <p style="font-size:.85rem;color:#ccc;margin:0;">
                ${i18n.t('profile.twofa.protectedInfo')}
              </p>
              <button type="button" id="btn-2fa-disable"
                style="margin-top:.75rem;padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border-radius:4px;cursor:pointer;">
                ${i18n.t('profile.twofa.disableBtn')}
              </button>
              <!-- Panneau de désactivation (caché par défaut) -->
              <div id="twofa-disable" style="display:none;margin-top:.75rem;">
                <form id="twofa-disable-form" style="display:flex;gap:.5rem;align-items:center;">
                  <input name="code" placeholder="${i18n.t('auth.twofa.placeholder')}" inputmode="numeric" pattern="[0-9]*" maxlength="6" required
                    style="flex:1;padding:.5rem;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:4px;">
                  <button type="submit"
                    style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;">
                    ${i18n.t('profile.twofa.disable')}
                  </button>
                  <button type="button" id="twofa-disable-cancel"
                    style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border-radius:4px;cursor:pointer;">
                    ${i18n.t('profile.twofa.cancel')}
                  </button>
                </form>
                <p id="twofa-disable-error" style="color:#ff6b6b;margin-top:.5rem;display:none"></p>
              </div>
            `
        : `
              <div style="color:#c6209d;margin-bottom:.75rem;"><strong>${i18n.t('profile.twofa.status')}: ${i18n.t('profile.twofa.disabled')}</strong></div>
              <button type="button" id="btn-2fa-setup"
                style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border:1px solid rgba(255,255,255,0.6);border-radius:4px;cursor:pointer;">
                ${i18n.t('profile.twofa.enable')}
              </button>
              <!-- Zone d'enrôlement (cachée jusqu'au click) -->
              <div id="twofa-setup" style="display:none;margin-top:1rem;">
                <div style="font-size:.85rem;color:#ccc;margin-bottom:.5rem; font-weight:bold;">
                  ${i18n.t('profile.twofa.setup.instructions')}
                </div>
                <label style="display:block;font-size:.8rem;margin:.5rem 0 .25rem;">${i18n.t('profile.twofa.setup.scanQr')}</label>
                <div id="twofa-qr" style="display:inline-block;padding:.5rem;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;">
                  <!-- QR will be rendered here -->
                </div> 
                <label style="display:block;font-size:.8rem;margin:.75rem 0 .25rem;">${i18n.t('profile.twofa.setup.manualKey')}</label>
                <input id="twofa-secret" type="text" readonly
                  style="width:100%;padding:.5rem;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:4px;">
                <form id="twofa-activate-form" style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center;">
                  <input name="code" placeholder="${i18n.t('auth.twofa.placeholder')}" inputmode="numeric" pattern="[0-9]*" maxlength="6" required
                    style="flex:1;padding:.5rem;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:4px;">
                  <button type="submit"
                    style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border-radius:4px;cursor:pointer;">
                    ${i18n.t('profile.twofa.activate')}
                  </button>
                </form>
                <p id="twofa-setup-error" style="color:#ff6b6b;margin-top:.5rem;display:none"></p>
              </div>
            `
      }
        </div>

              <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.2);">
                <div style="display:grid;gap:.5rem;font-size:.85rem;">               
                </div>
              </div>
            </div>

            <!-- Statistiques de jeu -->
            <div style="${card}">
              <h2 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.stats.header')}</h2>
              ${stats ? `
                <div style="display:grid;gap:1rem;font-size:.85rem;">
                  <div><strong>${i18n.t('profile.rank')}:</strong> ${currentUser?.rank ? `#${currentUser.rank}` : '—'}</div>
                  <div><strong>${i18n.t('profile.stats.gamesPlayed')}:</strong> ${stats.games_played}</div>
                  <div><strong>${i18n.t('profile.stats.wins')}:</strong> ${stats.games_won}</div>
                  <div><strong>${i18n.t('profile.stats.losses')}:</strong> ${stats.games_lost}</div>
                  <div><strong>${i18n.t('profile.stats.winRate')}:</strong> ${winRate}%</div>
                  <div><strong>${i18n.t('profile.stats.tournamentWins')}:</strong> ${stats.tournaments_won}</div>
                  <div><strong>${i18n.t('profile.stats.pointsScored')}:</strong> ${stats.total_points_scored}</div>
                  <div><strong>${i18n.t('profile.stats.pointsConceded')}:</strong> ${stats.total_points_conceded}</div>
                  <div><strong>${i18n.t('profile.memberSince')}:</strong> ${new Date(currentUser.created_at).toLocaleDateString()}</div>
                  <div><strong>${i18n.t('profile.lastLogin')}:</strong> ${currentUser.last_login ? new Date(currentUser.last_login).toLocaleDateString() : i18n.t('profile.never')}</div>
                  ${stats.longest_rally > 0 ? `<div><strong>${i18n.t('profile.stats.longestRally')}:</strong> ${stats.longest_rally}</div>` : ''}
                </div>` : `<div style="color:#ccc;font-style:italic;">${i18n.t('profile.stats.loading')}</div>`}
            </div>
          </div>

          <!-- Historique des matchs -->
          <div style="${card}">
            <h2 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.history.header')}</h2>
            ${matchHistory.length ? `
              <div style="max-height:300px;overflow-y:auto;">
                ${matchHistory.map(match => `
                  <div style="background:rgba(255,255,255,.1);border-radius:4px;padding:1rem;margin-bottom:.5rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <div style="display:flex;align-items:center;gap:.5rem;font-size:.85rem">
                        ${this.uiUtils.renderAvatar(currentUser, 40)}
                        <div>
                          <strong>vs ${match.opponent.username}</strong>
                          <span style="margin-left:.5rem;color:${match.result === 'win' ? '#7e89f2ff' : '#c6209d'};font-weight:900;">${match.result === 'win' ? i18n.t('profile.match.win') : i18n.t('profile.match.loss')}</span>
                        </div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:1rem;font-weight:bold;">${match.my_score} - ${match.opponent_score}</div>
                        <div style="font-size:.75rem;color:#ccc;">${this.formatMatchDate(match.played_at)}</div>
                      </div>
                    </div>
                  </div>`).join('')}
              </div>` : `
              <div style="color:#fff;font-size:.85rem">${i18n.t('profile.history.noMatches')}. <a href="/game" data-link="/game" style="color:#fff;">${i18n.t('profile.history.startPlaying')}</a></div>`}
          </div>
        </div>
      </div>`;
  }

  /* Affiche l'état de chargement */
  private renderLoadingProfile(currentUser: any): string {
    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div style="max-width:1000px;margin:0 auto;padding:2rem;">
          <div style="height:4.75rem;"></div>
          <div style="text-align:center;margin-top:4rem;">
            <div style="color:#ccc;font-size:1.2rem;">${i18n.t('profile.loading')}</div>
          </div>
        </div>
      </div>`;
  }

  /* Affiche l'erreur utilisateur non trouvé */
  private renderUserNotFound(currentUser: any): string {
    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div style="max-width:1000px;margin:0 auto;padding:2rem;">
          <div style="height:4.75rem;"></div>
          <div style="text-align:center;margin-top:4rem;">
            <div style="color:#ccc;font-size:1.2rem;margin-bottom:2rem;">${i18n.t('profile.notFound')}</div>
          </div>
        </div>
      </div>`;
  }

  public attachTwoFAEvents(currentUser?: any): void {
    // Bouton "Enable Two-Factor" → appelle le service 2FA setup
    document.getElementById('btn-2fa-setup')?.addEventListener('click', async () => {
      try {
        const { otpauth_url } = await this.wsService.setupTwoFA();

        // Parse secret=xxx
        const secret = (String(otpauth_url).match(/secret=([^&]+)/)?.[1] || '').trim();

        // Afficher la zone + secret
        const zone = document.getElementById('twofa-setup') as HTMLElement | null;
        if (zone) zone.style.display = '';
        (document.getElementById('twofa-secret') as HTMLInputElement | null)?.setAttribute('value', secret);

        // Générer le QR (import statique en haut: `import * as QRCode from 'qrcode';`)
        const qrBox = document.getElementById('twofa-qr');
        if (qrBox) {
          const canvas = document.createElement('canvas');
          await QRCode.toCanvas(canvas, otpauth_url, { width: 200, margin: 1 });
          qrBox.innerHTML = '';
          qrBox.appendChild(canvas);
        }

        this.uiUtils.showSuccessPopup(i18n.t('profile.twofa.msg.secretGenerated'));
      } catch (e: any) {
        this.uiUtils.showErrorPopup(e?.message || i18n.t('profile.twofa.msg.setupFailed'));
      }
    });

    // Affiche le panneau inline
    document.getElementById('btn-2fa-disable')?.addEventListener('click', () => {
      const box = document.getElementById('twofa-disable') as HTMLElement | null;
      if (!box) return;
      box.style.display = '';
      (box.querySelector('input[name="code"]') as HTMLInputElement | null)?.focus();
    });

    // Cancel du panneau
    document.getElementById('twofa-disable-cancel')?.addEventListener('click', () => {
      const box = document.getElementById('twofa-disable') as HTMLElement | null;
      if (!box) return;
      box.style.display = 'none';
      const errEl = document.getElementById('twofa-disable-error') as HTMLElement | null;
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      const input = box.querySelector('input[name="code"]') as HTMLInputElement | null;
      if (input) input.value = '';
    });

    // Submit du formulaire
    const disableForm = document.getElementById('twofa-disable-form') as HTMLFormElement | null;
    if (disableForm) {
      disableForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const code = String(new FormData(disableForm).get('code') || '').trim();
        const errEl = document.getElementById('twofa-disable-error') as HTMLElement | null;

        if (!/^\d{6}$/.test(code)) {
          if (errEl) { errEl.textContent = i18n.t('profile.twofa.msg.codeInvalidFormat'); errEl.style.display = 'block'; }
          return;
        }

        try {
          await this.wsService.disableTwoFA(code);
          this.uiUtils.showSuccessPopup(i18n.t('profile.twofa.msg.disabled'));

          // Mettre à jour l'état utilisateur côté SPA au lieu de recharger la page
          const app = (window as any)?.pongApp;
          const currentUser = app?.authService?.getCurrentUser?.();
          if (currentUser && app?.authService?.setCurrentUser) {
            app.authService.setCurrentUser({ ...currentUser, two_factor_enabled: false });
          }

          // Fermer le panneau et nettoyer les erreurs/champs
          const box = document.getElementById('twofa-disable') as HTMLElement | null;
          if (box) {
            box.style.display = 'none';
            const input = box.querySelector('input[name="code"]') as HTMLInputElement | null;
            if (input) input.value = '';
          }
          if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

          // Re-render la vue profil pour refléter le nouvel état
          setTimeout(() => app?.render?.(), 50);
        } catch (e: any) {
          if (errEl) { errEl.textContent = e?.message || i18n.t('profile.twofa.msg.disableFailed'); errEl.style.display = 'block'; }
        }
      });
    }

    // Form "Activate" → appelle le service 2FA activate
    const form = document.getElementById('twofa-activate-form') as HTMLFormElement | null;
    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const code = String(fd.get('code') || '').trim();
        const errEl = document.getElementById('twofa-setup-error') as HTMLElement | null;

        if (!code) {
          if (errEl) { errEl.textContent = i18n.t('profile.twofa.msg.enterCode'); errEl.style.display = 'block'; }
          return;
        }

        try {
          await this.wsService.activateTwoFA(code);
          this.uiUtils.showSuccessPopup(i18n.t('profile.twofa.msg.enabled'));

          // Mettre à jour l'état utilisateur côté SPA au lieu de recharger la page
          const app = (window as any)?.pongApp;
          const currentUser = app?.authService?.getCurrentUser?.();
          if (currentUser && app?.authService?.setCurrentUser) {
            app.authService.setCurrentUser({ ...currentUser, two_factor_enabled: true });
          }

          // Masquer la zone de setup et nettoyer
          const zone = document.getElementById('twofa-setup') as HTMLElement | null;
          if (zone) zone.style.display = 'none';
          if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

          // Re-render la vue profil pour refléter le nouvel état
          setTimeout(() => app?.render?.(), 50);
        } catch (e: any) {
          if (errEl) { errEl.textContent = e?.message || i18n.t('profile.twofa.msg.invalidCode'); errEl.style.display = 'block'; }
        }
      });
    }
  }

  /* Attache les événements JavaScript pour les avatars après le rendu DOM */
  public attachAvatarEvents(currentUser?: any): void {
    // Gérer les effets de survol pour les liens avec data-hover-link
    this.attachHoverEffects();

    // Récupérer le currentUser depuis le DOM ou le contexte global si non fourni
    const user = currentUser || this.getCurrentUserFromDOM();

    // Gestion de la sélection d'avatar
    document.querySelectorAll('[data-avatar-num]').forEach(el => {
      el.addEventListener('click', () => {
        const num = el.getAttribute('data-avatar-num');
        const input = document.querySelector('input[name="avatar_url"]') as HTMLInputElement;
        if (!input || !num) return;
        input.value = `/uploads/${num}.png`;
        document.querySelectorAll('[data-avatar-num]').forEach(e => ((e as HTMLElement).style.border = '2px solid transparent'));
        (el as HTMLElement).style.border = '2px solid #ffffff';
        const pc = document.querySelector('.avatar-preview-container');
        if (pc && user) pc.innerHTML = this.uiUtils.renderAvatar({ avatar_url: `/uploads/${num}.png`, username: user.username }, 80);
      });
    });

    // Gestion du bouton "Avatar par défaut"
    document.querySelector('[data-clear-avatar]')?.addEventListener('click', () => {
      const input = document.querySelector('input[name="avatar_url"]') as HTMLInputElement;
      if (!input) return;
      input.value = '';
      document.querySelectorAll('[data-avatar-num]').forEach(e => ((e as HTMLElement).style.border = '2px solid transparent'));
      const pc = document.querySelector('.avatar-preview-container');
      if (pc && user) pc.innerHTML = this.uiUtils.renderAvatar({ avatar_url: '', username: user.username }, 80);
    });

    // Gestion du bouton actualiser dans l'historique des matchs
    document.querySelectorAll('[data-action="refresh-history"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if ((window as any).pongApp) {
          (window as any).pongApp.refreshMatchHistory();
        }
      });
    });
  }

  /* Récupère le currentUser depuis le DOM ou le contexte global */
  private getCurrentUserFromDOM(): any {
    // Essayer de récupérer depuis l'input username
    const usernameInput = document.querySelector('input[name="username"]') as HTMLInputElement;
    if (usernameInput && usernameInput.value) {
      return { username: usernameInput.value };
    }

    // Essayer de récupérer depuis le contexte global
    const app = (window as any)?.pongApp;
    if (app?.authService?.getCurrentUser) {
      return app.authService.getCurrentUser();
    }

    // Valeur par défaut si rien n'est trouvé
    return { username: 'User' };
  }

  /* Attache les effets de survol pour les liens */
  private attachHoverEffects(): void {
    document.querySelectorAll('[data-hover-link="true"]').forEach(link => {
      // Supprimer les anciens listeners s'ils existent
      const newLink = link.cloneNode(true);
      link.parentNode?.replaceChild(newLink, link);

      // Ajouter les nouveaux listeners
      newLink.addEventListener('mouseenter', (e) => {
        (e.target as HTMLElement).style.opacity = '1';
      });

      newLink.addEventListener('mouseleave', (e) => {
        (e.target as HTMLElement).style.opacity = '0.8';
      });
    });
  }

  /* Met à jour la prévisualisation d'avatar en temps réel */
  private updateAvatarPreview(avatarUrl: string, currentUser?: any): void {
    const user = currentUser || this.getCurrentUserFromDOM();
    const pc = document.querySelector('.avatar-preview-container');
    if (pc && user) pc.innerHTML = this.uiUtils.renderAvatar({ avatar_url: avatarUrl, username: user.username }, 80);
  }

  /* Affiche une page dédiée pour l'historique complet des matchs */
  public renderMatchHistory(currentUser: any, matchHistory: MatchHistory[]): string {
    if (!currentUser) return '';
    const card = 'background:rgba(255,255,255,.1);border-radius:8px;padding:2rem;';
    return `
      <div style="background-color:#040011ff;color:#fff;min-height:100vh;">
        ${Navigation.render(currentUser)}
        <div style="max-width:1000px;margin:0 auto;padding:2rem;">
          <h1 style="text-align:center;font-size:1.5rem;margin-bottom:2rem;">${i18n.t('profile.matchHistory.title')}</h1>
          <div style="${card}">
            ${matchHistory.length ? `
              <div style="display:flex;items-center;justify-content:space-between;margin-bottom:1rem;">
                <h2 style="margin:0;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('profile.matchHistory.recent').replace('{count}', String(matchHistory.length))}</h2>
                <button data-action="refresh-history" style="padding:.5rem 1rem;background:rgba(255,255,255,0.25);color:#fff;border-radius:4px;cursor:pointer;">${i18n.t('profile.matchHistory.refresh')}</button>
              </div>
              <div style="max-height:500px;overflow-y:auto;">
                ${matchHistory.map(m => `
                  <div style="background:rgba(255,255,255,.1);border-radius:4px;padding:1rem;margin-bottom:.5rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <div style="display:flex;align-items:center;gap:.5rem;">
                        ${this.uiUtils.renderAvatar(m.opponent, 32)}
                        <div>
                          <strong>${i18n.t('profile.vs').replace('{username}', m.opponent.username)}</strong>
                          <div style="font-size:.75rem;color:#ccc;">${m.game_mode} • ${this.formatMatchDate(m.played_at)}</div>
                        </div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:1.2rem;font-weight:bold;margin-bottom:.25rem;">${m.my_score} - ${m.opponent_score}</div>
                        <span style="padding:.25rem .5rem;border-radius:12px;font-size:.75rem;font-weight:bold;background:${m.result === 'win' ? '#7e89f2ff' : '#c6209d'};color:#fff;font-weight:900;">${m.result === 'win' ? i18n.t('profile.match.victory') : i18n.t('profile.match.defeat')}</span>
                        ${m.duration ? `<div style="font-size:.75rem;color:#ccc;margin-top:.25rem;">${this.formatMatchDuration(m.duration)}</div>` : ''}
                      </div>
                    </div>
                  </div>`).join('')}
              </div>` : `
              <div style="text-align:center;padding:3rem;color:#ccc;">
                <h3 style="margin-bottom:1rem;">${i18n.t('profile.history.noMatches')}</h3>
                <p style="margin-bottom:2rem;">${i18n.t('profile.match.playFirst')}</p>
                <a href="/game" data-link="/game" style="display:inline-block;padding:.75rem 1.5rem;background:rgba(255,255,255,0.25);color:#fff;border:1px solid #fff;border-radius:4px;text-decoration:none;font-weight:bold;">${i18n.t('profile.match.playNow')}</a>
              </div>`}
          </div>
        </div>
      </div>`;
  }

  /* Formate une date de match en texte lisible (aujourd'hui, hier, X jours, date complète) */
  public formatMatchDate(dateString: string): string {
    try {
      const d = new Date(dateString), n = new Date();
      const diffDays = Math.floor((n.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      if (diffDays === 0) return i18n.t('profile.date.todayAt').replace('{time}', time);
      if (diffDays === 1) return i18n.t('profile.date.yesterdayAt').replace('{time}', time);
      if (diffDays < 7) return i18n.t('profile.date.daysAgo').replace('{n}', String(diffDays));
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: d.getFullYear() !== n.getFullYear() ? 'numeric' : undefined });
    } catch { return dateString; }
  }

  /* Formate la durée du match en minutes et secondes lisibles */
  public formatMatchDuration(seconds: number): string {
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return m > 0 ? i18n.t('time.duration.ms').replace('{m}', String(m)).replace('{s}', String(s)) : i18n.t('time.duration.s').replace('{s}', String(s));
  }
}