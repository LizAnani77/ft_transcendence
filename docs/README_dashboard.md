# User and Game Stats Dashboard

## Vue d'ensemble

Le **Dashboard** offre une visualisation complète des statistiques de jeu et des performances de l'utilisateur à travers des graphiques interactifs et des métriques en temps réel.

### Glossaire

- **Dashboard (tableau de bord)** : Une interface qui regroupe et affiche visuellement les informations et statistiques importantes d'un utilisateur
- **Métrique** : Une mesure quantifiable d'une performance ou d'une activité (nombre de victoires, taux de réussite, etc.)
- **Temps réel** : Données qui se mettent à jour automatiquement et immédiatement sans nécessiter de rafraîchissement manuel
- **Visualisation de données** : Représentation graphique d'informations chiffrées pour faciliter leur compréhension (graphiques, diagrammes, etc.)

## Fonctionnalités principales

### Visualisation des données

- **Graphiques de victoires/défaites** : Pie chart pour visualiser le ratio wins/losses
- **Taux de victoire** : Pourcentage calculé automatiquement
- **Distribution des points** : Bar chart comparant points marqués vs points encaissés
- **Historique récent** : Liste des dernières parties jouées


### Métriques de performance

**Statistiques personnelles**
- Parties jouées (total)
- Victoires et défaites
- Win rate (taux de victoire en %)
- Tournois participés et remportés

**Métriques avancées**
- **Points par partie** : Moyenne de points marqués
- **Win streak** : Série de victoires consécutives
- **Rang actuel** : Position dans le classement global
- **Durée moyenne des parties** : Temps de jeu moyen
- **Plus long rally** : Record de rebonds dans une partie

#### Définitions clés

- **Win streak** : Nombre de victoires consécutives, réinitialisé à zéro à chaque défaite
- **Rally** : Séquence d'échanges de balle entre les deux joueurs avant qu'un point soit marqué

### Historique des matchs

- **10 derniers matchs** affichés avec détails
- Adversaire, score final, résultat (W/L)
- Horodatage de chaque partie
- Statistiques détaillées par match


## Architecture technique

### Service DashboardService

Gestion centralisée des données :
```typescript
class DashboardService {
  - loadStats()          // Charge les statistiques
  - refreshStats()       // Rafraîchit les données
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

Le dashboard affiche 6 cartes principales organisées en grille 2x2 + 2 cartes supplémentaires :

### 1. Pie Chart (Wins/Losses)

Graphique circulaire SVG animé montrant :
- Code couleur : **#7e89f2ff** (bleu violet) pour victoires, **#c6209d** (rose magenta) pour défaites
- Affichage du compteur "XW / YL" au centre du cercle
- Win rate calculé en pourcentage en dessous
- Légende avec pastilles de couleur identifiant chaque segment

### 2. Performance Metrics

Carte affichant 4 métriques clés avec mini-barres :
- **Points par partie** : moyenne avec barre sur 20 pts max (bleu)
- **Win streak** : série actuelle avec barre sur 10 max (rose)
- **Current Rank** : position dans le classement (#N)
- **Total Games** : nombre total de parties jouées

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
- **Bandeau streak actif** (si streak > 0) : fond bleu avec bordure rose, affichant le streak et un message motivant

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
- **Victoire en tournoi** : Trophées et ranks recalculés

### WebSocket Integration

```typescript
// Événements écoutés
'dashboard:stats_loaded'  → Données chargées
'dashboard:stats_error'   → Erreur de chargement
'game:finished'           → Rafraîchir après partie
'match_created'           → Actualiser compteurs
```


## Interface utilisateur

### Layout responsive

```
┌─────────────────────────────────────┐
│  Wins/Losses (Pie)  │  Performance  │
├─────────────────────┼───────────────┤
│  Points Distrib.    │  Recent Games │
└─────────────────────────────────────┘
```

### Design

- **Grid 2x2** pour desktop
- Cartes avec fond semi-transparent
- Animations de chargement (skeleton)
- Tooltips sur les graphiques
- Couleurs thématiques cohérentes

#### Définitions UI

- **Skeleton screen** : Animation placeholder qui simule la structure du contenu pendant le chargement

## Fonctionnalités UX

### Loading States

- Skeleton screens pendant le chargement
- Indicateur de chargement visuel
- Messages d'erreur informatifs

### Data Freshness

- Mise à jour automatique via événements WebSocket
- Fonction `refreshStats()` disponible pour rafraîchissement manuel programmatique
- Les données sont rechargées après chaque partie ou création de match (pas de cache persistant)


### Formatting Utilities

```typescript
formatDuration(seconds)    // "2m 34s"
formatPercentage(value)    // "75.5%"
formatNumber(value)        // "1,234"
getWinRateColor(rate)      // Classes CSS dynamiques
getStreakMessage(streak)   // Messages motivants
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
- Affiché avec couleurs progressives


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
WS  dashboard:get_stats          - Récupérer stats dashboard
WS  dashboard:stats_loaded       - Stats chargées (broadcast)
WS  dashboard:stats_error        - Erreur de chargement

GET /api/users/:id/stats         - Stats utilisateur
GET /api/matches/recent/:userId  - Historique récent
GET /api/leaderboard             - Classement global
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
- Touch-friendly sur mobile

## Internationalisation

Support multilingue complet :
- Labels traduits (dashboard.*)
- Formats de date localisés
- Nombres formatés selon locale


## Messages motivants

Selon le win streak :
- `0` : "Start your winning streak!" (gris #ccc)
- `1` : "Good start!" (blanc #fff)
- `2` : "Building momentum" (blanc #fff)
- `3-4` : "On fire!" (jaune #d6b50a)
- `5-9` : "Unstoppable!" (bleu #7e89f2ff)
- `10+` : "Legendary streak!" (bleu #7e89f2ff)

Le système de couleurs progressives donne un feedback visuel sur la qualité du streak.

## Nettoyage des données

```typescript
clearData()  // Lors de la déconnexion
```

Réinitialise :
- Dashboard data à null
- Loading state à false
- Timestamp à 0

