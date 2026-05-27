# Standard User Management

## Vue d'ensemble

Système complet de gestion des utilisateurs permettant l'inscription, la connexion, et la personnalisation du profil.

### Glossaire

- **Gestion des utilisateurs** : Ensemble de fonctionnalités permettant de créer, gérer et sécuriser les comptes utilisateurs d'une application
- **Authentification** : Processus qui vérifie l'identité d'un utilisateur (prouver que vous êtes bien qui vous prétendez être)
- **Session** : Une période de connexion active pendant laquelle l'utilisateur est identifié par le système
- **Profil** : Ensemble des informations personnelles et préférences associées à un compte utilisateur

## Fonctionnalités

### Authentification

- **Inscription** : Création de compte
- **Connexion** : Authentification sécurisée par mot de passe
- **Sessions** : Gestion de sessions utilisateur avec JWT
- **Déconnexion** : Invalidation des tokens de session
- **2FA (authentification à deux facteurs)** : Protection renforcée par TOTP (voir [README_2FA.md](security/README_2FA.md))
- **OAuth 42** : Connexion via compte Intra 42 (voir [README_oauth2.md](README_oauth2.md))

#### Définitions d'authentification

- **Inscription** : Processus de création d'un nouveau compte utilisateur en fournissant des informations de base (nom d'utilisateur, email, mot de passe)
- **Connexion/Login** : Action de s'identifier auprès du système avec ses identifiants (username et mot de passe) pour accéder à son compte
- **JWT (JSON Web Token)** : Un jeton sécurisé contenant des informations sur l'utilisateur, utilisé pour maintenir la session sans stocker de données sur le serveur
- **Déconnexion/Logout** : Action de terminer sa session active, rendant le token d'authentification invalide

### Profil utilisateur

- **Avatar personnalisé** : Upload d'image de profil
- **Display name** : Nom d'affichage unique
- **Statistiques** : Wins/losses, historique de jeux
- **Préférences de langue** : EN / FR / ES

#### Définitions de profil

- **Avatar** : Une image qui représente visuellement l'utilisateur dans l'application (photo de profil)
- **Upload** : Action de télécharger un fichier depuis votre ordinateur vers le serveur
- **Display name (nom d'affichage)** : Le nom public visible par les autres utilisateurs
- **Wins/Losses (victoires/défaites)** : Compteur des parties gagnées et perdues par un joueur
- **Historique** : Liste chronologique des parties jouées avec leurs détails (adversaire, score, date)

### Système social

- **Liste d'amis** : Ajout et gestion d'amis (max 5 par utilisateur)
- **Statut en ligne** : Visibilité de la présence
- **Blocage** : Bloquer des utilisateurs indésirables
- **Profils publics** : Consultation des stats des autres joueurs
- **Recherche d'utilisateurs** : Trouver d'autres joueurs par nom

#### Définitions du système social

- **Liste d'amis** : Ensemble des utilisateurs avec lesquels vous avez établi une connexion mutuelle dans l'application
- **Statut en ligne/Présence** : Indicateur qui montre si un utilisateur est actuellement connecté et actif sur la plateforme
- **Blocage** : Action qui empêche un utilisateur spécifique de vous contacter, de voir votre profil ou de vous défier (protection contre le harcèlement)
- **Profil public** : Les informations d'un utilisateur visibles par les autres (statistiques, historique de parties) sans donner accès aux informations privées (email, mot de passe)

## Sécurité

### Protection des données

- Hachage des mots de passe (bcrypt)
- Validation des entrées utilisateur
- Protection contre les attaques XSS et CSRF
- Tokens JWT sécurisés

#### Définitions de protection des données

- **Hachage** : Transformation irréversible d'un mot de passe en une chaîne aléatoire, rendant impossible la récupération du mot de passe original même si la base de données est compromise
- **bcrypt** : Un algorithme de hachage spécialement conçu pour sécuriser les mots de passe, très résistant aux tentatives de déchiffrement
- **Validation des entrées** : Vérification que les données fournies par l'utilisateur respectent les règles attendues avant de les traiter
- **XSS (Cross-Site Scripting)** : Attaque où un utilisateur malveillant insère du code malicieux dans une page web pour voler des informations
- **CSRF (Cross-Site Request Forgery)** : Attaque qui force un utilisateur authentifié à exécuter des actions non désirées sur une application web à son insu
- **Token sécurisé** : Jeton d'authentification chiffré et signé numériquement pour empêcher sa falsification

### Politiques de mot de passe

- Longueur minimale : **6 caractères**
- Longueur maximale : 100 caractères
- Nom d'utilisateur : 3 à 10 caractères

#### Définitions des politiques de mot de passe

- **Longueur minimale** : Nombre minimum de caractères requis pour un mot de passe (6 caractères dans ce projet)

## Workflow utilisateur

1. **Création de compte** → Compte actif immédiatement
2. **Connexion** → Génération token JWT → Accès autorisé
3. **Personnalisation** → Modification profil → Sauvegarde
4. **Interaction sociale** → Ajout d'amis → Réseau actif

> **Note** : Il n'y a pas de validation d'email. Le compte est actif dès l'inscription.

### Définitions du workflow

- **Workflow (flux de travail)** : La séquence ordonnée des étapes qu'un utilisateur suit pour accomplir une tâche dans l'application
- **Génération de token** : Création d'un jeton unique d'authentification lors de la connexion, qui sera utilisé pour identifier l'utilisateur durant sa session
- **Accès autorisé** : État où l'utilisateur est authentifié et peut accéder aux fonctionnalités réservées aux membres connectés
- **Réseau actif** : Ensemble des connexions sociales (amis) actives permettant les interactions (invitations, chat, voir le statut en ligne)

## API Endpoints

Tous les endpoints sont préfixés par `/api/auth/` :

```
POST   /api/auth/register              - Inscription
POST   /api/auth/login                 - Connexion
POST   /api/auth/logout                - Déconnexion
GET    /api/auth/me                    - Profil de l'utilisateur connecté
PUT    /api/auth/profile               - Mise à jour du profil
GET    /api/auth/users/search          - Recherche d'utilisateurs
GET    /api/auth/users/:userId/stats   - Statistiques d'un utilisateur
GET    /api/auth/users/:userId/matches - Historique des matchs d'un utilisateur
GET    /api/auth/users/:userId/rank    - Rang d'un utilisateur
GET    /api/auth/ranking               - Classement global
POST   /api/auth/friends/add           - Envoyer une demande d'ami
POST   /api/auth/friends/accept        - Accepter une demande d'ami
DELETE /api/auth/friends/:friendId     - Supprimer un ami
DELETE /api/auth/friends/decline/:friendId - Refuser une demande d'ami
GET    /api/auth/friends               - Liste des amis
GET    /api/auth/friends/requests      - Demandes d'amis en attente
GET    /api/auth/language              - Langue préférée
PUT    /api/auth/language              - Mettre à jour la langue préférée
```

### Définitions des API endpoints

- **POST** : Méthode HTTP utilisée pour créer ou envoyer de nouvelles données au serveur (inscription, connexion, ajout d'ami)
- **GET** : Méthode HTTP utilisée pour récupérer des données sans les modifier (consulter un profil, voir les statistiques)
- **PUT** : Méthode HTTP utilisée pour mettre à jour des données existantes (modifier les informations du profil)
- **DELETE** : Méthode HTTP utilisée pour supprimer des ressources (retirer un ami de la liste)
- **/api/auth/** : Préfixe d'URL regroupant tous les endpoints liés à l'authentification et à la gestion des utilisateurs
- **:userId** : Paramètre dynamique dans l'URL représentant l'identifiant unique d'un utilisateur (ex: /api/auth/users/123/stats)

## Persistance des données

Toutes les données utilisateur sont stockées dans SQLite avec des relations appropriées entre les tables (users, friendships, stats).

### Définitions de persistance

- **Persistance** : Conservation permanente des données dans une base de données, garantissant qu'elles ne sont pas perdues après la fermeture de l'application ou un redémarrage du serveur
- **SQLite** : Un système de base de données léger qui stocke toutes les informations dans un fichier unique, sans nécessiter de serveur dédié
- **Relations entre tables** : Liens logiques entre différentes tables de la base de données permettant d'associer les données (ex: la table friendships lie deux entrées de la table users)
- **Table users** : Table contenant les informations de base de tous les comptes utilisateurs (identifiants, mots de passe, profils)
- **Table friendships** : Table gérant les relations d'amitié entre utilisateurs (qui est ami avec qui)
- **Table stats** : Table stockant les statistiques de jeu de chaque utilisateur (victoires, défaites, scores, historique)
