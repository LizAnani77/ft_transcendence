# Dockerfile pour le frontend (alternative)
FROM node:18-alpine

RUN apk update && apk add --no-cache curl

# Créer et configurer le répertoire de travail d'abord
RUN mkdir -p /app && chown -R node:node /app

WORKDIR /app

# Définir l'utilisateur node dès le début
USER node

# Copier les fichiers package.json
COPY --chown=node:node package*.json ./

# Installer les dépendances
RUN npm install

# Copier le reste du code
COPY --chown=node:node . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
