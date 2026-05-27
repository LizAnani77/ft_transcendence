# User and Game Stats Dashboard

## Vue d'ensemble

Le **Dashboard** offre une visualisation complète des statistiques de jeu et des performances de l'utilisateur à travers des graphiques et des métriques.

### Glossaire

- **Dashboard (tableau de bord)** : Une interface qui regroupe et affiche visuellement les informations et statistiques importantes d'un utilisateur
- **Métrique** : Une mesure quantifiable d'une performance ou d'une activité (nombre de victoires, taux de réussite, etc.)
- **Visualisation de données** : Représentation graphique d'informations chiffrées pour faciliter leur compréhension (graphiques, diagrammes, etc.)

## Fonctionnalités principales

### Visualisation des données

- **Graphiques de victoires/défaites** : Pie chart pour visualiser le ratio wins/losses
- **Taux de victoire** : Pourcentage calculé automatiquement
- **Distribution des points** : Barres horizontales comparant points marqués vs points encaissés
- **Historique récent** : Liste des dernières parties jouées


### Métriques de performance

**Statistiques personnelles**
- Parties jouées (total)
- Victoires et défaites
- Win rate (taux de victoire en %)
- Tournois remportés

**Métriques affichées**
- **Points par partie** : Moyenne de points marqués
- **Win streak** : Série de victoires consécutives
- **Rang actuel** : Position dans le classement global

> **Note** : La durée moyenne des parties et le plus long rally sont calculés côté serveur et présents dans le modèle de données, mais ne sont pas affichés dans l'interface actuelle.

#### Définitions clés

- **Win streak** : Nombre de victoires consécutives, réinitialisé à zéro à chaque défaite
- **Rally** : Séquence d'échanges de balle entre les deux joueurs avant qu'un point soit marqué

### Historique des matchs

- **10 derniers matchs** affichés avec détails
- Adversaire, score final, résultat (W/L)
- Horodatage de chaque partie


## Architecture technique

### Service DashboardService

Gestion centralisée des données :
```typescript
class DashboardService {
  - loadStats()          // Charge les statistiques via HTTP
  - refreshStats()       // Rafraîchit les données via HTTP
  - getDashboardData()   // Récupère les stats
  - formatDuration()     // Formate les durées
  - formatPercentage()   // Formate les pourcentages
}
```


### Modèle de données

```typescript
DashboardStats {
  user: {
    id, username, avatar_url
    rank, rank_position
  }
  stats: {
    games_played, games_won, games_lost
    tournaments_played, tournaments_won
    total_points_scored, total_points_conceded
    longest_rally
  }
  recentMatches: MatchHistoryItem[]
  winStreak: number
  averageGameDuration: number
  winRate: number
  pointsPerGame: number
}
```


## Visualisations graphiques

Le dashboard affiche **7 cartes** organisées en deux grilles + 1 tableau :

### 1. Pie Chart (Wins/Losses)

Graphique circulaire SVG montrant :
- Code couleur : **#7e89f2ff** (bleu violet) pour victoires, **#c6209d** (rose magenta) pour défaites
- Affichage "XW" / "YL" au centre du cercle (deux lignes)
- Win rate calculé en pourcentage en dessous
- Légende avec pastilles de couleur identifiant chaque segment

### 2. Performance Metrics

Carte affichant 4 métriques clés :
- **Points par partie** : moyenne avec mini-barre sur 20 pts max (bleu)
- **Win streak** : série actuelle avec mini-barre sur 10 max (rose)
- **Current Rank** : position dans le classement (#N) — sans barre
- **Total Games** : nombre total de parties jouées — sans barre

### 3. Points Distribution

Deux barres horizontales comparatives :
- **Points marqués** (scored) : barre bleue montrant le total
- **Points encaissés** (conceded) : barre rose montrant le total
- **Différence de points** : affichée en bas avec +/- et couleur selon signe (positif=bleu, négatif=rose)
- Les barres sont normalisées sur le max des deux valeurs

### 4. Recent Performance (Graphique de tendance)

Graphique SVG polyline montrant :
- Évolution du win rate sur les **10 derniers matchs** en ordre chronologique
- Ligne dégradée (gradient rose→bleu) reliant les points
- Points circulaires colorés : bleu=victoire, rose=défaite
- Légende en bas : "Plus ancien" ← "Tendance" → "Plus récent"
- Calcul : win rate cumulé à chaque match (nb victoires / nb matchs joués)

### 5. Tournament Stats

Carte simple affichant :
- **Tournois remportés** : nombre total de tournois gagnés

### 6. Additional Stats

Carte avec statistiques complémentaires :
- **Parties cette semaine** : nombre de matchs des 7 derniers jours
- **Bandeau streak actif** (affiché uniquement si streak > 0) : fond bleu avec bordure rose, affichant le streak et un message motivant

### 7. Match History Table (Tableau complet)

Tableau détaillé des **10 derniers matchs** avec colonnes :
- **Opponent** : nom d'utilisateur de l'adversaire
- **Result** : badge arrondi "WIN" (bleu) ou "LOSS" (rose)
- **Score** : "X - Y" en gras
- **Date** : formatage intelligent selon ancienneté (algorithme basé sur Intl)
  - **Aujourd'hui** (même jour) : heure (HH:MM) + date/année en dessous en petit (.75rem, opacité .7)
  - **1-6 jours passés** : format relatif avec Intl.RelativeTimeFormat ("yesterday"/"hier", "2 days ago"/"il y a 2 jours")
  - **Plus ancien** (>7 jours) : date courte localisée avec Intl.DateTimeFormat (ex: "15 jan", "Jan 15")

Message si aucun historique : "No match history yet"

#### Définitions techniques

- **SVG** : Format vectoriel pour graphiques redimensionnables sans perte de qualité
- **Polyline** : Élément SVG qui dessine une ligne reliant plusieurs points
- **Normalisation** : Ajustement des valeurs sur une échelle commune pour faciliter la comparaison
- **Win rate cumulé** : Pourcentage de victoires calculé progressivement à chaque match
- **Intl.RelativeTimeFormat** : API JavaScript pour formater des durées relatives ("il y a 2 jours") selon la locale
- **Intl.DateTimeFormat** : API JavaScript pour formater des dates selon les conventions régionales

## Mise à jour en temps réel

### Rafraîchissement automatique

Le dashboard se met à jour automatiquement après :
- **Fin de partie** : Stats actualisées après chaque match (délai de 1000ms)
- **Création de match** : Compteurs mis à jour (délai de 500ms)

### Chargement des données

Les statistiques sont chargées via **HTTP** (`GET /api/auth/dashboard/stats`). Le service écoute ensuite les événements WebSocket pour déclencher un rechargement :

```typescript
// Événements écoutés
'dashboard:stats_loaded'  → Données chargées (réponse HTTP émulée en événement)
'dashboard:stats_error'   → Erreur de chargement
'game:finished'           → Rafraîchir après partie
'match_created'           → Actualiser compteurs
```


## Interface utilisateur

### Layout

```
┌─────────────────────────────────────┐
│  Wins/Losses (Pie)  │  Performance  │
├─────────────────────┼───────────────┤
│  Points Distrib.    │  Recent Games │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  Tournament Stats   │  Add. Stats   │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│         Match History Table         │
└─────────────────────────────────────┘
```

### Design

- **Grid 2x2** pour les 4 premières cartes, puis 2 colonnes pour les stats complémentaires
- Cartes avec fond semi-transparent
- Couleurs thématiques : bleu #7e89f2ff (victoires), rose #c6209d (défaites)

#### Définitions UI

- **Semi-transparent** : `background: rgba(255,255,255,.1)` — fond légèrement visible pour s'intégrer au thème sombre

## Fonctionnalités UX

### Loading States

- Pendant le chargement : page vide (aucun skeleton ou animation de placeholder)
- Messages d'erreur via événement `dashboard:stats_error`

### Data Freshness

- Mise à jour automatique via événements WebSocket (`game:finished`, `match_created`)
- Fonction `refreshStats()` disponible pour rafraîchissement manuel programmatique
- Les données sont rechargées après chaque partie ou création de match (pas de cache persistant)


### Formatting Utilities

```typescript
formatDuration(seconds)    // "2m 34s"
formatPercentage(value)    // "75.5%"
formatNumber(value)        // "1 234" (séparateur espace, locale fr-FR)
getStreakMessage(streak)   // Messages motivants (via i18n)
```


## Calculs et algorithmes

### Win Rate

```typescript
winRate = (games_won / games_played) * 100
```

### Points par partie

```typescript
pointsPerGame = total_points_scored / games_played
```

### Win Streak

Calcul de la série de victoires consécutives :
- Réinitialisé à chaque défaite
- Sauvegardé en base de données
- Affiché dans le bandeau de la carte "Additional Stats"


## Accès et sécurité

### Authentification requise

- Dashboard accessible uniquement aux utilisateurs connectés
- Redirection automatique vers `/auth` si non authentifié
- Données personnelles protégées

### Données privées

- Chaque utilisateur voit uniquement ses propres stats
- Classement global visible par tous
- Profils publics pour consultation des stats des autres


## API Endpoints

```
GET /api/auth/dashboard/stats    - Récupère toutes les stats dashboard (HTTP)
GET /api/auth/users/:userId/stats  - Stats d'un utilisateur
GET /api/auth/ranking              - Classement global
```

## Optimisations

### Performance

- Rafraîchissement uniquement en réponse à des événements (game:finished, match_created)
- Délais contrôlés pour synchronisation backend (1000ms après fin de partie, 500ms après création)
- Rendering HTML côté service pour éviter manipulations DOM coûteuses
- Graphiques SVG natifs (pas de bibliothèque externe lourde)

#### Définitions techniques

- **Manipulations DOM** : Opérations JavaScript pour modifier dynamiquement la structure HTML de la page (coûteuses en performance)
- **Rendering côté service** : Génération du HTML dans le service plutôt que manipulation DOM directe (plus performant)

### Responsive Design

- Grid adaptatif (2 colonnes → 1 colonne sur mobile)
- Graphiques redimensionnables


## Internationalisation

Support multilingue complet :
- Labels traduits (dashboard.*)
- Formats de date localisés
- Nombres formatés selon locale


## Nettoyage des données

```typescript
clearData()  // Lors de la déconnexion
```

Réinitialise :
- Dashboard data à null
- Loading state à false
- Timestamp à 0
