FROM node:20-slim

WORKDIR /app

# Solo dependencias del sistema, NO chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copiar y instalar dependencias npm
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

# Variable de entorno
ENV NODE_ENV=production

CMD ["node", "index.js"]