# Limites du Système

Configuration centralisée dans [backend/src/config/limits.ts](backend/src/config/limits.ts)

---

## Limites Implémentées ✅

### 1. Utilisateurs Enregistrés : 10 000 max
- **Fichier** : [auth.ts:166-170](backend/src/routes/auth.ts#L166-L170)
- **Comportement** : Bloque l'inscription quand la limite est atteinte
- **Message** : "Registration temporarily closed. User limit reached."

### 2. Amis par Utilisateur : 5 max
- **Fichier** : [auth.ts:724-734](backend/src/routes/auth.ts#L724-L734)
- **Comportement** : Bloque l'ajout d'un 6ème ami
- **Messages** :
  - "Friend limit reached (5 maximum)"
  - "This user has reached their friend limit (5 maximum)"

### 3. Utilisateurs Connectés Simultanément : 200 max
- **Fichier** : [server.ts:1606-1613](backend/src/server.ts#L1606-L1613)
- **Comportement** : Rejette les connexions WebSocket au-delà de 200
- **Message** : "Server is full. Please try again later."

### 4. Tournois Actifs Simultanés : 50 max
- **Fichier** : [tournaments.ts:670-680](backend/src/routes/tournaments.ts#L670-L680)
- **Comportement** : Bloque la création d'un 51ème tournoi actif
- **Message** : "Active tournament limit reached (50 maximum). Please try again later."

---

## Contraintes de Validation

| Élément | Min | Max | Fichier |
|---------|-----|-----|---------|
| Nom d'utilisateur | 3 | 10 | [auth.ts:159-160](backend/src/routes/auth.ts#L159-L160) |
| Mot de passe | 6 | 100 | [auth.ts:161-162](backend/src/routes/auth.ts#L161-L162) |
| Message chat | 1 | 500 | [server.ts](backend/src/server.ts) |
| Nom tournoi | 1 | 20 (frontend), 100 (backend) | [tournaments.ts](backend/src/routes/tournaments.ts) |
| Joueurs par tournoi | - | 4 | [database.schema.ts](backend/src/services/database.schema.ts) |

