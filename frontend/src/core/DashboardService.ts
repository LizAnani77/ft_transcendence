// frontend/src/core/DashboardService.ts

import { WebSocketService } from '../services/WebSocketService';
import { DashboardStats } from '../types';

export class DashboardService {
  private dashboardData: DashboardStats | null = null;
  private isLoading: boolean = false;
  private lastUpdate: number = 0;

  constructor(private wsService: WebSocketService) {
    // Écouter les mises à jour des stats via WebSocket
    this.wsService.onMessage('dashboard:stats_loaded', (message: any) => {
      this.dashboardData = message.dashboard;
      this.isLoading = false;
      this.lastUpdate = Date.now();
      console.log('[Dashboard] Stats loaded:', this.dashboardData);
    });

    this.wsService.onMessage('dashboard:stats_error', (message: any) => {
      console.error('[Dashboard] Error loading stats:', message.error);
      this.isLoading = false;
    });

    // Rafraîchir automatiquement après une partie terminée
    this.wsService.onMessage('game:finished', () => {
      setTimeout(() => this.refreshStats(), 1000); // Délai pour laisser le backend enregistrer
    });

    // Rafraîchir après création de match
    this.wsService.onMessage('match_created', () => {
      setTimeout(() => this.refreshStats(), 500);
    });
  }

  /* Charge les statistiques du dashboard */
  public async loadStats(): Promise<void> {
    if (this.isLoading) return;
    
    this.isLoading = true;
    await this.wsService.getDashboardStats();
  }

  /* Rafraîchit les statistiques */
  public async refreshStats(): Promise<void> {
    this.isLoading = true;
    await this.wsService.getDashboardStats();
  }

  /* Récupère les données du dashboard */
  public getDashboardData(): DashboardStats | null {
    return this.dashboardData;
  }

  /* Indique si les données sont en cours de chargement */
  public isLoadingStats(): boolean {
    return this.isLoading;
  }

  /* Indique si les données ont été chargées */
  public hasData(): boolean {
    return this.dashboardData !== null;
  }

  /* Récupère la dernière mise à jour (timestamp) */
  // public getLastUpdateTime(): number {
  //   return this.lastUpdate;
  // }

  /* Indique si les données sont récentes (moins de 5 minutes) */
  // public isDataFresh(): boolean {
  //   const now = Date.now();
  //   const fiveMinutes = 5 * 60 * 1000;
  //   return (now - this.lastUpdate) < fiveMinutes;
  // }

  /* Formate une durée en secondes vers un format lisible */
  public static formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return 'N/A';

    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
  }

  /* Formate un pourcentage */
  public static formatPercentage(value: number): string {
    return `${Math.round(value * 100) / 100}%`;
  }

  /* Formate une valeur numérique avec séparateurs de milliers */
  public static formatNumber(value: number): string {
    return value.toLocaleString('fr-FR');
  }

  /* Détermine la couleur CSS selon le win rate */
  // public static getWinRateColor(winRate: number): string {
  //   if (winRate >= 70) return 'text-green-400';
  //   if (winRate >= 50) return 'text-yellow-400';
  //   return 'text-red-400';
  // }

  /* Détermine la couleur CSS selon le streak */
  public static getStreakColor(streak: number): string {
    if (streak >= 5) return 'text-green-400';
    if (streak >= 3) return 'text-yellow-400';
    if (streak >= 1) return 'text-blue-400';
    return 'text-gray-400';
  }

  /* Génère un message descriptif pour le streak */
  public static getStreakMessage(streak: number): string {
    if (streak === 0) return 'Start your winning streak!';
    if (streak === 1) return 'Good start!';
    if (streak < 3) return 'Building momentum';
    if (streak < 5) return 'On fire!';
    if (streak < 10) return 'Unstoppable!';
    return 'Legendary streak!';
  }

  /* Nettoie les données (utile lors de la déconnexion) */
  public clearData(): void {
    this.dashboardData = null;
    this.isLoading = false;
    this.lastUpdate = 0;
  }
}