// frontend/src/core/DashboardRenderer.ts

import { DashboardStats } from '../types';
import { DashboardService } from './DashboardService';
import { Navigation } from '../components/Navigation';
import { i18n } from './I18n';

export class DashboardRenderer {
  
  /* Rendu principal de la page Dashboard avec graphiques */
  public renderDashboard(user: any, dashboardData: DashboardStats | null): string {
    const navigation = Navigation.render(user);

    if (!dashboardData) {
      return `
        <div style="background-color:transparent;color:#fff;min-height:100vh;">
          ${navigation}
          <div style="max-width:1200px;margin:0 auto;padding:2rem;">
            <div style="height:4.75rem;"></div>
          </div>
        </div>
      `;
    }

    const stats = dashboardData.stats;
    const winRate = dashboardData.winRate;
    const card = 'background:rgba(255,255,255,.1);border-radius:8px;padding:1.5rem;margin-bottom:1.5rem;';

    return `
      <div style="background-color:transparent;color:#fff;min-height:100vh;">
        ${navigation}
        <div style="max-width:1200px;margin:0 auto;padding:2rem;">
          <div style="height:3rem;"></div>
          
          <!-- Grid principal 2x2 -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem;">
            
            <!-- Win Rate Chart (Pie Chart) -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.winsLosses')}</h3>
              <div style="position:relative;text-align:center;">
                ${this.renderPieChart(stats.games_won, stats.games_lost)}
                <div style="margin-top:1rem;">
                  <div style="display:flex;justify-content:center;gap:1rem;font-size:.85rem;">
                    <div><span style="display:inline-block;width:12px;height:12px;background:#7e89f2ff;border-radius:2px;margin-right:.5rem;"></span>${i18n.t('dashboard.winsLabel')}</div>
                    <div><span style="display:inline-block;width:12px;height:12px;background:#c6209d;border-radius:2px;margin-right:.5rem;"></span>${i18n.t('dashboard.lossesLabel')}</div>
                  </div>
                  <div style="margin-top:.5rem;font-weight:bold;">${i18n.t('dashboard.winRate')}: ${this.formatPercentage(winRate)}</div>
                </div>
              </div>
            </div>

            <!-- Performance Metrics -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.performance')}</h3>
              <div style="display:grid;gap:.8rem;font-size:.9rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span>${i18n.t('dashboard.pointsPerGame')}</span>
                  <div style="display:flex;align-items:center;gap:.5rem;">
                    ${this.renderMiniBar(dashboardData.pointsPerGame, 20, '#7e89f2ff', 80)}
                    <strong>${dashboardData.pointsPerGame.toFixed(1)}</strong>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span>${i18n.t('dashboard.winStreak')}</span>
                  <div style="display:flex;align-items:center;gap:.5rem;">
                    ${this.renderMiniBar(dashboardData.winStreak, 10, '#c6209d', 60)}
                    <strong style="color:#fff;">${dashboardData.winStreak}</strong>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span>${i18n.t('dashboard.currentRank')}</span>
                  <strong style="color:#fff;">#${dashboardData.user.rank_position}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span>${i18n.t('dashboard.totalGames')}</span>
                  <strong style="color:#fff;">${stats.games_played}</strong>
                </div>
              </div>
            </div>

            <!-- Points Distribution -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.pointsDistribution')}</h3>
              <div style="display:grid;gap:1rem;">
                <div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:.3rem;font-size:.85rem;">
                    <span>${i18n.t('dashboard.pointsScored')}</span>
                    <span>${stats.total_points_scored}</span>
                  </div>
                  ${this.renderHorizontalBar(stats.total_points_scored, Math.max(stats.total_points_scored, stats.total_points_conceded), '#7e89f2ff')}
                </div>
                <div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:.3rem;font-size:.85rem;">
                    <span>${i18n.t('dashboard.pointsConceded')}</span>
                    <span>${stats.total_points_conceded}</span>
                  </div>
                  ${this.renderHorizontalBar(stats.total_points_conceded, Math.max(stats.total_points_scored, stats.total_points_conceded), '#c6209d')}
                </div>
                <div style="border-top:1px solid rgba(255,255,255,.2);padding-top:.8rem;">
                  <div style="display:flex;justify-content:space-between;font-weight:bold;">
                    <span>${i18n.t('dashboard.pointDiff')}</span>
                    <span style="color:${stats.total_points_scored - stats.total_points_conceded >= 0 ? '#7e89f2ff' : '#c6209d'}">
                      ${stats.total_points_scored - stats.total_points_conceded >= 0 ? '+' : ''}${stats.total_points_scored - stats.total_points_conceded}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Match History Trend -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.recentPerformance')}</h3>
              ${this.renderMatchHistoryChart(dashboardData.recentMatches)}
            </div>

          </div>

          <!-- Tournament & Detailed Stats -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem;">
            
            <!-- Tournament Stats -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.tournamentStats')}</h3>
              <div style="display:grid;gap:.8rem;font-size:.9rem;">
                <div style="display:flex;justify-content:space-between;">
                  <span>${i18n.t('dashboard.tournamentsWon')}</span>
                  <strong style="color:#fff;">${stats.tournaments_won}</strong>
                </div>
              </div>
            </div>

            <!-- Additional Stats -->
            <div style="${card}">
              <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.additionalStats')}</h3>
              <div style="display:grid;gap:.8rem;font-size:.9rem;">
                <div style="display:flex;justify-content:space-between;">
                  <span>${i18n.t('dashboard.gamesThisWeek')}</span>
                  <strong>${this.getWeeklyGames(dashboardData.recentMatches)}</strong>
                </div>
                ${dashboardData.winStreak > 0 ? `
                  <div style="margin-top:1rem;padding:.8rem;background:rgba(126,137,242,0.2);border-radius:4px;border-left:4px solid rgba(198,32,157,0.5);">
                    <div style="font-weight:bold;margin-bottom:.3rem;">${i18n.t('dashboard.currentStreak')} ${dashboardData.winStreak}</div>
                    <div style="font-size:.8rem;color:#ccc;">${this.getStreakMessage(dashboardData.winStreak)}</div>
                  </div>
                ` : ''}
              </div>
            </div>

          </div>

          <!-- Match History Table -->
          <div style="${card}">
            <h3 style="margin-bottom:1rem;font-size:1rem;text-transform:uppercase;font-weight:bold;">${i18n.t('dashboard.recentHistory')}</h3>
            ${dashboardData.recentMatches.length === 0 ? `
              <div style="text-align:center;padding:2rem;color:#ccc;">
                <p style="margin-bottom:1rem;">${i18n.t('dashboard.noMatchHistory')}</p>
              </div>
            ` : `
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                  <thead>
                    <tr style="border-bottom:1px solid rgba(255,255,255,.2);">
                      <th style="text-align:left;padding:.75rem;font-size:.85rem;color:#ccc;">${i18n.t('dashboard.table.opponent')}</th>
                      <th style="text-align:center;padding:.75rem;font-size:.85rem;color:#ccc;">${i18n.t('dashboard.table.result')}</th>
                      <th style="text-align:center;padding:.75rem;font-size:.85rem;color:#ccc;">${i18n.t('dashboard.table.score')}</th>
                      <th style="text-align:right;padding:.75rem;font-size:.85rem;color:#ccc;">${i18n.t('dashboard.table.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${dashboardData.recentMatches.slice(0, 10).map(match => `
                      <tr style="border-bottom:1px solid rgba(255,255,255,.1);">
                        <td style="padding:.75rem;">${match.opponent.username}</td>
                        <td style="text-align:center;padding:.75rem;">
                          <span style="padding:.25rem .75rem;border-radius:12px;font-size:.8rem;font-weight:bold;background:${match.result === 'win' ? '#7e89f2ff' : '#c6209d'};">
                            ${match.result === 'win' ? i18n.t('dashboard.win') : i18n.t('dashboard.loss')}
                          </span>
                        </td>
                        <td style="text-align:center;padding:.75rem;font-weight:bold;">${match.my_score} - ${match.opponent_score}</td>
                        <td style="text-align:right;padding:.75rem;color:#ccc;font-size:.85rem;">${this.formatMatchDate(match.played_at)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  /* Génère un graphique circulaire pour victoires/défaites */
  private renderPieChart(wins: number, losses: number, size: number = 150): string {
    if (wins === 0 && losses === 0) {
      return `<div style="text-align:center;padding:2rem;color:#ccc;">${i18n.t('dashboard.noGames')}</div>`;
    }

    const total = wins + losses;
    const winPercentage = (wins / total) * 100;
    
    return `
      <div style="position:relative;width:${size}px;height:${size}px;margin:0 auto;">
        <svg width="${size}" height="${size}" style="transform:rotate(-90deg);">
          <circle cx="${size/2}" cy="${size/2}" r="${(size-8)/2}" stroke="#c6209d" stroke-width="8" fill="none" stroke-dasharray="${2 * Math.PI * ((size-8)/2)}" stroke-dashoffset="0"/>
          <circle cx="${size/2}" cy="${size/2}" r="${(size-8)/2}" stroke="#7e89f2ff" stroke-width="8" fill="none" stroke-dasharray="${(winPercentage/100) * 2 * Math.PI * ((size-8)/2)} ${2 * Math.PI * ((size-8)/2)}" stroke-dashoffset="0"/>
        </svg>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
          <div style="font-size:.9rem;font-weight:bold;">${wins}W</div>
          <div style="font-size:.9rem;font-weight:bold;">${losses}L</div>
        </div>
      </div>
    `;
  }

  /* Génère une barre horizontale */
  private renderHorizontalBar(value: number, max: number, color: string): string {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return `
      <div style="background:rgba(255,255,255,.1);border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${color};height:100%;width:${percentage}%;transition:width 0.5s ease;border-radius:4px;"></div>
      </div>
    `;
  }

  /* Génère une mini-barre pour les métriques */
  private renderMiniBar(value: number, max: number, color: string, width: number = 60): string {
    const percentage = Math.min((value / max) * 100, 100);
    return `
      <div style="background:rgba(255,255,255,.1);border-radius:2px;height:6px;width:${width}px;overflow:hidden;">
        <div style="background:${color};height:100%;width:${percentage}%;transition:width 0.5s ease;border-radius:2px;"></div>
      </div>
    `;
  }

  /* Génère un graphique de tendance des derniers matchs */
  private renderMatchHistoryChart(matches: any[]): string {
    if (matches.length === 0) {
      return `<div style="text-align:center;color:#ccc;padding:2rem;">${i18n.t('dashboard.noMatchesToDisplay')}</div>`;
    }

    const chartHeight = 100;
    const chartWidth = 300;
    const recentMatches = matches.slice(0, 10).reverse(); // 10 derniers matchs, ordre chronologique
    
    let points = '';
    let winCount = 0;
    
    recentMatches.forEach((match, index) => {
      if (match.result === 'win') winCount++;
      const x = (index / Math.max(recentMatches.length - 1, 1)) * chartWidth;
      const y = chartHeight - (winCount / (index + 1)) * chartHeight;
      points += `${x},${y} `;
    });

    return `
      <div style="position:relative;height:120px;margin:1rem 0;">
        <svg width="100%" height="${chartHeight}" style="overflow:visible;">
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#c6209d;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#7e89f2ff;stop-opacity:1" />
            </linearGradient>
          </defs>
          <polyline points="${points.trim()}" fill="none" stroke="url(#gradient)" stroke-width="3" stroke-linecap="round"/>
          ${recentMatches.map((match, index) => {
            const x = (index / Math.max(recentMatches.length - 1, 1)) * chartWidth;
            let winCount = 0;
            for (let i = 0; i <= index; i++) {
              if (recentMatches[i].result === 'win') winCount++;
            }
            const y = chartHeight - (winCount / (index + 1)) * chartHeight;
            return `<circle cx="${x}" cy="${y}" r="4" fill="${match.result === 'win' ? '#7e89f2ff' : '#c6209d'}"/>`;
          }).join('')}
        </svg>
        <div style="display:flex;justify-content:space-between;margin-top:.5rem;font-size:.75rem;color:#ccc;">
          <span>${i18n.t('dashboard.legend.oldest')}</span>
          <span>${i18n.t('dashboard.legend.trend')}</span>
          <span>${i18n.t('dashboard.legend.recent')}</span>
        </div>
      </div>
    `;
  }

  /* Méthodes utilitaires */
  private formatNumber(value: number): string {
    return value.toLocaleString('fr-FR');
  }

  private formatPercentage(value: number): string {
    return `${Math.round(value * 100) / 100}%`;
  }

  private formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return 'N/A';
    
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
  }

  private getStreakColor(streak: number): string {
    if (streak >= 5) return '#7e89f2ff';
    if (streak >= 3) return '#d6b50a';
    if (streak >= 1) return '#fff';
    return '#ccc';
  }

  private getStreakMessage(streak: number): string {
    if (streak === 0) return i18n.t('streak.start');
    if (streak === 1) return i18n.t('streak.goodStart');
    if (streak < 3) return i18n.t('streak.building');
    if (streak < 5) return i18n.t('streak.onFire');
    if (streak < 10) return i18n.t('streak.unstoppable');
    return i18n.t('streak.legendary');
  }

  private formatMatchDate(dateString: string): string {
    try {
      const d = new Date(dateString);
      const now = new Date();
      const msDiff = d.getTime() - now.getTime();
      const dayDiff = Math.round(msDiff / (1000 * 60 * 60 * 24)); // négatif si passé

      const lang = document.documentElement.getAttribute('lang') || 'en';
      const dtf = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' });

      // < 7 jours -> relatif (hier, il y a X jours / hoy, hace X días…)
      if (dayDiff >= -6 && dayDiff <= -1) {
        const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
        return rtf.format(dayDiff, 'day'); // ex: "yesterday" / "hier" / "ayer"
      }

      // même jour -> heure sur une ligne, date + année en dessous
      const sameDay = now.toDateString() === d.toDateString();
      if (sameDay) {
        const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
        const date = d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
        return `<div style="line-height:1.3;">${time}<br><span style="font-size:.75rem;opacity:.7;">${date}</span></div>`;
      }

      // sinon -> date courte locale
      return dtf.format(d);
    } catch {
      return dateString;
    }
  }

  private getWeeklyGames(matches: any[]): number {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    return matches.filter(match => {
      try {
        const matchDate = new Date(match.played_at);
        return matchDate >= oneWeekAgo;
      } catch {
        return false;
      }
    }).length;
  }

  /* Attache les event listeners */
  public attachEventListeners(): void {
    // Retrait des boutons
  }
}
