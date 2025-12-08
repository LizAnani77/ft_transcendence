# Database (SQLite)

## Vue d'ensemble

**SQLite** est utilisé comme système de gestion de base de données. C'est une solution légère, fiable et sans serveur, idéale pour stocker les données de l'application.

### Glossaire

- **Base de données** : Un système organisé pour stocker, gérer et récupérer des informations de manière structurée (comme un classeur numérique géant)
- **SQLite** : Un moteur de base de données qui stocke toutes les données dans un seul fichier, sans nécessiter de serveur dédié
- **SQL** : Langage standardisé pour interroger et manipuler des bases de données (SELECT pour lire, INSERT pour créer, UPDATE pour modifier, DELETE pour supprimer)
- **SGBD (Système de Gestion de Base de Données)** : Un logiciel qui gère l'organisation, le stockage et la récupération des données

## Caractéristiques principales

- **Serverless** : Pas de processus serveur séparé à gérer
- **Zero-configuration** : Prêt à l'emploi sans installation complexe
- **ACID compliant** : Transactions fiables et cohérentes
- **Portable** : Un seul fichier pour toute la base de données

### Définitions des caractéristiques

- **Serverless (sans serveur)** : La base de données fonctionne directement dans l'application sans nécessiter un programme serveur séparé qui tourne en arrière-plan
- **Zero-configuration** : Aucune installation ou configuration préalable nécessaire, il suffit d'utiliser le fichier de base de données
- **ACID** : Propriétés garantissant la fiabilité des transactions (Atomicité, Cohérence, Isolation, Durabilité) - en gros, vos données sont toujours dans un état cohérent même en cas d'erreur
- **Transaction** : Un ensemble d'opérations sur la base de données qui s'exécutent entièrement ou pas du tout (pas de demi-mesure)
- **Portable** : Le fichier de base de données peut être copié et utilisé sur n'importe quel système d'exploitation sans conversion

## Structure de la base de données

### Tables principales

**users**
- Informations de compte (username, email, password hash)
- Profil (avatar, display name)
- Statistiques de jeu (wins, losses, points)

**games**
- Historique des parties
- Scores et résultats
- Horodatage

**friendships**
- Relations entre utilisateurs
- Statut (pending, accepted, blocked)

**messages**
- Messages du chat
- Conversations privées

**tournaments**
- Organisation des tournois
- Participants et résultats

### Définitions de structure

- **Table** : Une structure qui organise les données en lignes et colonnes, comme une feuille de calcul (chaque table représente un type d'entité : users, games, etc.)
- **Ligne/Enregistrement** : Une entrée unique dans une table (par exemple, un utilisateur spécifique)
- **Colonne/Champ** : Une propriété de l'entité (par exemple, le username d'un utilisateur)
- **Hash** : Une transformation irréversible d'une donnée sensible (ici le mot de passe) en une chaîne aléatoire pour la sécurité
- **Horodatage/Timestamp** : Date et heure précises d'un événement (création, modification)
- **Clé étrangère** : Un champ qui référence l'ID d'une autre table pour créer des relations (ex: un message référence l'ID de l'utilisateur qui l'a envoyé)

## Sécurité

- Mots de passe hashés avec bcrypt
- Requêtes paramétrées pour prévenir les injections SQL
- Validation des données avant insertion

### Définitions de sécurité

- **bcrypt** : Un algorithme de hachage spécialement conçu pour sécuriser les mots de passe en les rendant très difficiles à craquer même avec beaucoup de puissance de calcul
- **Injection SQL** : Une attaque où un utilisateur malveillant insère du code SQL dans un champ de formulaire pour manipuler la base de données
- **Requêtes paramétrées** : Une technique qui sépare le code SQL des données utilisateur, empêchant les injections SQL
- **Validation** : Vérification que les données respectent certaines règles avant de les accepter (ex: un email doit avoir un @, un âge doit être positif)

## Utilisation

L'accès à la base de données se fait via un service dédié qui abstrait les opérations SQL :

```typescript
// Exemple d'opération
const user = await db.users.findById(userId);
await db.users.update(userId, { wins: user.wins + 1 });
```

### Définitions d'utilisation

- **Service** : Une couche de code qui encapsule la logique d'accès aux données et fournit des méthodes simples pour interagir avec la base de données
- **Abstraction** : Cacher la complexité des requêtes SQL derrière des fonctions simples (au lieu d'écrire `SELECT * FROM users WHERE id = ?`, on utilise `findById()`)
- **async/await** : Syntaxe JavaScript pour gérer des opérations asynchrones (qui prennent du temps) de manière plus lisible

## Maintenance

- Sauvegardes régulières du fichier `.db`
- Migrations pour les changements de schéma
- Indexes pour optimiser les requêtes fréquentes

### Définitions de maintenance

- **Sauvegarde/Backup** : Copie du fichier de base de données pour pouvoir restaurer les données en cas de problème ou de perte
- **Migration** : Script qui modifie la structure de la base de données de manière contrôlée (ajout d'une table, modification d'une colonne...) sans perdre les données existantes
- **Schéma** : La structure complète de la base de données (quelles tables existent, quelles colonnes elles contiennent, quels types de données)
- **Index** : Une structure de données auxiliaire qui accélère les recherches dans une table, comme un index dans un livre qui permet de trouver rapidement une information
