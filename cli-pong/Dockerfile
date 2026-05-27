# Dockerfile pour la CLI Pong
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
  && npm link

USER node
ENV HOME=/home/node

CMD ["sh", "-lc", "tail -f /dev/null"]
