# Alternativa ao systemd: mesmo projeto em container (linux/amd64 e linux/arm64).
# Base Debian: o Chromium do apt existe para arm64 (o Chrome oficial do Google nao).
FROM node:22-bookworm-slim

# Nao baixa o Chrome do puppeteer (usamos o do sistema) e fixa o fuso do anti-ban
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    TZ=America/Sao_Paulo \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primeiro: camada cacheada nas reinstalacoes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# tini propaga SIGTERM e colhe o Chrome filho (evita lock orfao no restart)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/app.js"]
