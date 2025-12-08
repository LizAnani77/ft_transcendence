# Backend Framework (Fastify)

## Vue d'ensemble

Le backend utilise **Fastify** avec **Node.js**, un framework web performant et léger conçu pour gérer efficacement les requêtes HTTP et WebSocket.

### Glossaire

- **Backend** : La partie serveur d'une application qui traite les données, gère la base de données et exécute la logique métier. Le frontend (ce que voit l'utilisateur) communique avec le backend pour récupérer ou envoyer des informations
- **Fastify** : Un framework JavaScript qui facilite la création d'un serveur web. Il fournit des outils pour gérer les requêtes des clients et envoyer des réponses de manière optimisée
- **Node.js** : Un environnement qui permet d'exécuter du code JavaScript sur un serveur (normalement JavaScript ne fonctionne que dans les navigateurs)
- **Framework** : Un ensemble d'outils et de règles qui accélère le développement en fournissant une structure de base et des fonctionnalités communes
- **HTTP** : Le protocole standard pour communiquer sur le web. Quand vous visitez un site, votre navigateur envoie une requête HTTP au serveur qui répond avec la page demandée
- **WebSocket** : Un canal de communication qui reste ouvert en continu entre le navigateur et le serveur, permettant des échanges en temps réel (utile pour les chats, jeux multijoueurs, notifications live)

## Caractéristiques principales

- **Performance optimisée** : Traitement rapide des requêtes grâce à l'architecture asynchrone de Fastify
- **Validation automatique** : Schémas JSON pour valider les données entrantes
- **Support WebSocket** : Communication en temps réel pour le jeu et le chat
- **Plugin ecosystem** : Extension facile avec des plugins officiels et communautaires

### Définitions complémentaires

- **Architecture asynchrone** : Mode de fonctionnement où le serveur peut traiter plusieurs demandes en même temps sans attendre qu'une tâche soit terminée avant d'en commencer une autre
- **Schémas JSON** : Des règles qui définissent la structure attendue des données (exemple : un email doit contenir un @, un âge doit être un nombre)
- **Plugin** : Un module additionnel qui ajoute des fonctionnalités au framework de base (authentification, logs, compression...)

## Structure du projet

```
backend/
├── src/
│   ├── routes/          # Endpoints de l'API
│   ├── services/        # Logique métier
│   ├── plugins/         # Extensions Fastify
│   └── server.ts        # Point d'entrée
```

## Technologies utilisées

- **Fastify** : Framework backend
- **Node.js** : Environnement d'exécution JavaScript
- **TypeScript** : Typage statique pour plus de sécurité

### Définitions supplémentaires

- **TypeScript** : Une extension de JavaScript qui ajoute des types (préciser qu'une variable est un nombre, un texte, etc.) pour éviter les erreurs lors du développement
- **API** : Interface de programmation qui définit comment les applications peuvent communiquer entre elles (le frontend utilise l'API du backend pour récupérer des données)
- **Endpoint** : Une URL spécifique sur le serveur qui répond à un type de requête précis (ex: `/api/users` pour récupérer la liste des utilisateurs)

## Démarrage

```bash
cd backend
npm install
npm run dev
```

Le serveur démarre sur `http://localhost:3000`

## Points clés de l'implémentation

- Routes RESTful pour les opérations CRUD
- Middleware d'authentification JWT
- Gestion d'erreurs centralisée
- Logging structuré pour le debugging

### Définitions d'implémentation

- **REST/RESTful** : Un style d'architecture pour les API qui utilise les méthodes HTTP standards (GET, POST, PUT, DELETE) de manière cohérente et prévisible
- **CRUD** : Create (créer), Read (lire), Update (modifier), Delete (supprimer) - les 4 opérations de base sur des données
- **Middleware** : Une fonction qui s'exécute entre la réception d'une requête et l'envoi de la réponse (comme un checkpoint de sécurité)
- **JWT (JSON Web Token)** : Un système de jetons sécurisés pour authentifier les utilisateurs sans avoir à stocker leur session sur le serveur
- **Logging** : L'enregistrement des événements et erreurs du serveur dans des fichiers pour faciliter le débogage et la surveillance
