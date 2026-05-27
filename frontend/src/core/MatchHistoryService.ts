// frontend/src/core/MatchHistoryService.ts

import { MatchHistory } from './interfaces';
import { WebSocketService } from '../services/WebSocketService';

export class MatchHistoryService {
  private matchHistory: MatchHistory[] = [];
  private wsService: WebSocketService;

  /* Initialise le service avec la dépendance WebSocket */
  constructor(wsService: WebSocketService) { this.wsService = wsService; }

  /* Retourne l’historique des matchs */
  public getMatchHistory(): MatchHistory[] { return this.matchHistory; }

  /* Réinitialise l’historique (utile lors de la déconnexion) */
  public clearData(): void { this.matchHistory = []; }

  /* Charge l’historique reçu via WebSocket */
  public handleMatchHistoryLoaded(data: any): void { this.matchHistory = data.matches || []; }

  /* Rafraîchit l’historique pour un utilisateur donné */
  public refreshMatchHistory(userId: number, limit: number = 20): void { this.wsService.getMatchHistory(userId, limit); }

  /* Formate une date de match avec un temps relatif lisible */
  public formatMatchDate(dateString: string): string {
    try {
      const d = new Date(dateString), now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const min = Math.floor(diffMs / 60000), hr = Math.floor(diffMs / 3600000), day = Math.floor(diffMs / 86400000);
      if (min < 1) return 'Just now';
      if (min < 60) return `${min} minute${min > 1 ? 's' : ''} ago`;
      if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
      if (day === 0) return `Today at ${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`;
      if (day === 1) return `Yesterday at ${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`;
      if (day < 7) return `${day} day${day > 1 ? 's' : ''} ago`;
      if (day < 30) { const w = Math.floor(day/7); return `${w} week${w>1?'s':''} ago`; }
      return d.toLocaleDateString('en-US',{day:'numeric',month:'short',year:d.getFullYear()!==now.getFullYear()? 'numeric':undefined});
    } catch { return dateString; }
  }

  /* Transforme une durée en secondes en format lisible (m/s/h) */
  public formatMatchDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60), s = seconds % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60), rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
  }

  /* Retourne les matchs récents (limite par défaut 10) */
  public getRecentMatches(limit: number = 10): MatchHistory[] { return this.matchHistory.slice(0, limit); }

  /* Retourne uniquement les matchs gagnés */
  public getWins(): MatchHistory[] { return this.matchHistory.filter(m => m.result === 'win'); }

  /* Retourne uniquement les matchs perdus */
  public getLosses(): MatchHistory[] { return this.matchHistory.filter(m => m.result === 'loss'); }

  /* Calcule et retourne le taux de victoire en pourcentage */
  public getWinRate(): number { return this.matchHistory.length ? Math.round(this.getWins().length / this.matchHistory.length * 100) : 0; }

  /* Retourne le nombre total de matchs joués */
  public getTotalGames(): number { return this.matchHistory.length; }

  /* Filtre les matchs par mode de jeu */
  public getMatchesByGameMode(gameMode: string): MatchHistory[] { return this.matchHistory.filter(m => m.game_mode === gameMode); }

  /* Calcule le score moyen marqué et encaissé */
  public getAverageScore(): { scored: number; conceded: number } {
    const n = this.matchHistory.length;
    if (!n) return { scored: 0, conceded: 0 };
    const scored = this.matchHistory.reduce((s,m)=>s+m.my_score,0)/n;
    const conceded = this.matchHistory.reduce((s,m)=>s+m.opponent_score,0)/n;
    return { scored: Math.round(scored*10)/10, conceded: Math.round(conceded*10)/10 };
  }

  /* Retourne la plus longue série de victoires */
  public getLongestWinStreak(): number {
    let cur = 0, max = 0;
    const sorted = [...this.matchHistory].sort((a,b)=>new Date(a.played_at).getTime()-new Date(b.played_at).getTime());
    for (const m of sorted) { cur = m.result === 'win' ? cur + 1 : 0; if (cur > max) max = cur; }
    return max;
  }

  /* Retourne la série actuelle (victoires ou défaites) */
  public getCurrentStreak(): { type: 'win' | 'loss' | null; count: number } {
    if (!this.matchHistory.length) return { type: null, count: 0 };
    const sorted = [...this.matchHistory].sort((a,b)=>new Date(b.played_at).getTime()-new Date(a.played_at).getTime());
    const type = sorted[0].result; let count = 0;
    for (const m of sorted) { if (m.result === type) count++; else break; }
    return { type, count };
  }

  /* Compile les statistiques par adversaire (matchs, victoires, défaites) */
  public getOpponentStats(): { [opponentId: number]: { games: number; wins: number; losses: number } } {
    return this.matchHistory.reduce((acc, m) => {
      const id = m.opponent.id;
      acc[id] ??= { games: 0, wins: 0, losses: 0 };
      acc[id].games++;
      if (m.result === 'win') acc[id].wins++; else acc[id].losses++;
      return acc;
    }, {} as { [opponentId: number]: { games: number; wins: number; losses: number } });
  }
}
