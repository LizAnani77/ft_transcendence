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

#### Définitions d'authentification

- **Inscription** : Processus de création d'un nouveau compte utilisateur en fournissant des informations de base (nom d'utilisateur, email, mot de passe)
- **Connexion/Login** : Action de s'identifier auprès du système avec ses identifiants (username/email et mot de passe) pour accéder à son compte
- **JWT (JSON Web Token)** : Un jeton sécurisé contenant des informations sur l'utilisateur, utilisé pour maintenir la session sans stocker de données sur le serveur
- **Déconnexion/Logout** : Action de terminer sa session active, rendant le token d'authentification invalide
- **Invalidation de token** : Processus qui rend un token inutilisable, forçant l'utilisateur à se reconnecter pour obtenir un nouveau token

### Profil utilisateur

- **Avatar personnalisé** : Upload d'image de profil
- **Display name** : Nom d'affichage unique pour les tournois
- **Statistiques** : Wins/losses, historique de jeux
- **Paramètres** : Préférences de compte

#### Définitions de profil

- **Avatar** : Une image qui représente visuellement l'utilisateur dans l'application (photo de profil)
- **Upload** : Action de télécharger un fichier depuis votre ordinateur vers le serveur
- **Display name (nom d'affichage)** : Le nom public visible par les autres utilisateurs, peut être différent du nom d'utilisateur de connexion
- **Wins/Losses (victoires/défaites)** : Compteur des parties gagnées et perdues par un joueur
- **Historique** : Liste chronologique des parties jouées avec leurs détails (adversaire, score, date)
- **Paramètres/Préférences** : Options configurables par l'utilisateur pour personnaliser son expérience (notifications, confidentialité, etc.)

### Système social

- **Liste d'amis** : Ajout et gestion d'amis
- **Statut en ligne** : Visibilité de la présence
- **Blocage** : Bloquer des utilisateurs indésirables
- **Profils publics** : Consultation des stats des autres joueurs

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
- **Validation des entrées** : Vérification que les données fournies par l'utilisateur respectent les règles attendues avant de les traiter (format d'email valide, longueur de mot de passe, etc.)
- **XSS (Cross-Site Scripting)** : Attaque où un utilisateur malveillant insère du code malicieux dans une page web pour voler des informations ou compromettre d'autres utilisateurs
- **CSRF (Cross-Site Request Forgery)** : Attaque qui force un utilisateur authentifié à exécuter des actions non désirées sur une application web à son insu
- **Token sécurisé** : Jeton d'authentification chiffré et signé numériquement pour empêcher sa falsification ou son interception

### Politiques de mot de passe

- Longueur minimale requise
- Complexité recommandée
- Pas de réutilisation immédiate

#### Définitions des politiques de mot de passe

- **Longueur minimale** : Nombre minimum de caractères requis pour un mot de passe (généralement 8-12 caractères minimum pour une sécurité acceptable)
- **Complexité** : Ensemble de règles encourageant l'utilisation d'une combinaison de lettres majuscules, minuscules, chiffres et symboles pour renforcer la sécurité
- **Réutilisation** : Politique qui empêche l'utilisation d'un mot de passe déjà utilisé récemment, forçant le choix d'un nouveau mot de passe distinct

## Workflow utilisateur

1. **Création de compte** → Validation email → Profil actif
2. **Connexion** → Génération token JWT → Accès autorisé
3. **Personnalisation** → Modification profil → Sauvegarde
4. **Interaction sociale** → Ajout d'amis → Réseau actif

### Définitions du workflow

- **Workflow (flux de travail)** : La séquence ordonnée des étapes qu'un utilisateur suit pour accomplir une tâche dans l'application
- **Validation email** : Processus de vérification qu'une adresse email appartient bien à l'utilisateur, généralement via un lien envoyé par email
- **Génération de token** : Création d'un jeton unique d'authentification lors de la connexion, qui sera utilisé pour identifier l'utilisateur durant sa session
- **Accès autorisé** : État où l'utilisateur est authentifié et peut accéder aux fonctionnalités réservées aux membres connectés
- **Réseau actif** : Ensemble des connexions sociales (amis) actives permettant les interactions (invitations, chat, voir le statut en ligne)

## API Endpoints

```
POST   /api/auth/register    - Inscription
POST   /api/auth/login       - Connexion
GET    /api/users/:id        - Profil utilisateur
PUT    /api/users/:id        - Mise à jour profil
GET    /api/users/:id/stats  - Statistiques
POST   /api/friends/add      - Ajouter un ami
DELETE /api/friends/:id      - Retirer un ami
```

### Définitions des API endpoints

- **POST** : Méthode HTTP utilisée pour créer ou envoyer de nouvelles données au serveur (inscription, connexion, ajout d'ami)
- **GET** : Méthode HTTP utilisée pour récupérer des données sans les modifier (consulter un profil, voir les statistiques)
- **PUT** : Méthode HTTP utilisée pour mettre à jour des données existantes (modifier les informations du profil)
- **DELETE** : Méthode HTTP utilisée pour supprimer des ressources (retirer un ami de la liste)
- **/api/auth/** : Préfixe d'URL regroupant tous les endpoints liés à l'authentification (register, login)
- **:id** : Paramètre dynamique dans l'URL représentant l'identifiant unique d'un utilisateur (ex: /api/users/123)

## Persistance des données

Toutes les données utilisateur sont stockées dans SQLite avec des relations appropriées entre les tables (users, friendships, stats).

### Définitions de persistance

- **Persistance** : Conservation permanente des données dans une base de données, garantissant qu'elles ne sont pas perdues après la fermeture de l'application ou un redémarrage du serveur
- **SQLite** : Un système de base de données léger qui stocke toutes les informations dans un fichier unique, sans nécessiter de serveur dédié
- **Relations entre tables** : Liens logiques entre différentes tables de la base de données permettant d'associer les données (ex: la table friendships lie deux entrées de la table users)
- **Table users** : Table contenant les informations de base de tous les comptes utilisateurs (identifiants, mots de passe, profils)
- **Table friendships** : Table gérant les relations d'amitié entre utilisateurs (qui est ami avec qui)
- **Table stats** : Table stockant les statistiques de jeu de chaque utilisateur (victoires, défaites, scores, historique)
