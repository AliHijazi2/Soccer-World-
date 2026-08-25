# Ein Prozess, ein Port. Server und Client kommen aus demselben Image.
FROM node:22-slim

WORKDIR /app

# Abhängigkeiten zuerst, damit der Schritt bei Codeänderungen im Cache bleibt
COPY package.json package-lock.json ./
RUN npm ci --omit=optional

COPY . .
RUN npm run build:client

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Node führt die TypeScript-Dateien direkt aus — kein Build-Schritt für den
# Server, kein zusätzliches Werkzeug in der Kette
CMD ["node", "--experimental-strip-types", "--no-warnings", \
     "packages/server/src/api/server.ts"]
