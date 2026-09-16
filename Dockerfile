FROM node:20.19-alpine
RUN apk add --no-cache openssl
# Pin npm to the lockfile's generator so `npm ci` stays in sync on Alpine.
RUN npm install -g npm@11.6.2

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./
COPY extensions ./extensions

RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
