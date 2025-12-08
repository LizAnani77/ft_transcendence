
// frontend/src/game/MatchHistoryService.ts

import { MatchHistoryResponse } from '../types';

export class MatchHistoryService {
  private baseUrl = 'https://localhost:3443';

  /* Récupère le token JWT depuis le stockage local */
  private getToken(): string | null { return localStorage.getItem('token'); }

  /* Helper HTTP JSON (ajoute l’Authorization et gère les erreurs JSON) */
  private async fetchJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...init
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Erreur réseau');
    return data as T;
  }

  /* Récupère l'historique des matchs d'un utilisateur */
  async getUserMatchHistory(userId: number, limit: number = 20): Promise<MatchHistoryResponse> {
    try { return await this.fetchJson<MatchHistoryResponse>(`/api/auth/users/${userId}/matches?limit=${limit}`); }
    catch (error) { console.error('Erreur MatchHistoryService.getUserMatchHistory:', error); throw error; }
  }

  /* Récupère l'historique des matchs de l'utilisateur connecté */
  async getMyMatchHistory(limit: number = 20): Promise<MatchHistoryResponse> {
    try {
      const me = await this.fetchJson<any>('/api/auth/me');
      if (!me?.success || !me?.user) throw new Error('Impossible de récupérer les informations utilisateur');
      return this.getUserMatchHistory(me.user.id, limit);
    } catch (error) {
      console.error('Erreur MatchHistoryService.getMyMatchHistory:', error);
      throw error;
    }
  }

  /* Formate une durée exprimée en secondes */
  static formatDuration(seconds?: number): string {
    if (!seconds) return 'N/A';
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  }

  /* Formate une date pour l'affichage */
  static formatDate(dateString: string): string {
    try {
      const d = new Date(dateString), now = new Date();
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
      if (diffDays === 0) return `Aujourd'hui à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
      if (diffDays === 1) return `Hier à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
      if (diffDays < 7) return `Il y a ${diffDays} jours`;
      return d.toLocaleDateString('fr-FR',{ day:'numeric', month:'short', year: d.getFullYear()!==now.getFullYear()? 'numeric': undefined });
    } catch { return dateString; }
  }

  /* Retourne le texte correspondant au résultat */
  static getResultText(result: 'win' | 'loss'): string { return result === 'win' ? 'Victoire' : 'Défaite'; }

  /* Retourne la couleur CSS en fonction du résultat */
  static getResultColor(result: 'win' | 'loss'): string { return result === 'win' ? 'text-green-600' : 'text-red-600'; }
}

/* Instance singleton */
export const matchHistoryService = new MatchHistoryService();
