# Dockerfile pour le backend Node.js avec TypeScript et SQLite3
FROM node:18-alpine

WORKDIR /app

# --- AJOUTER LES DEPS DE BUILD AVANT npm install ---
USER root
RUN apk add --no-cache su-exec \
    python3 py3-setuptools \
    build-base pkgconfig sqlite-dev \
    jq curl

# node-gyp doit connaître python3 et forcer la build locale
ENV npm_config_python=/usr/bin/python3
ENV npm_config_build_from_source=true

# Préparer le répertoire et permissions
RUN mkdir -p /app && chown -R node:node /app

# Copier les manifests d'abord
COPY --chown=node:node package*.json ./

# Installer les deps en utilisateur non-root
USER node
RUN npm ci --no-audit --no-fund && \
    npm i -D typescript @types/node @types/ws

# Copier le code et builder
COPY --chown=node:node . .
COPY --chown=node:node entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
RUN npx tsc

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
