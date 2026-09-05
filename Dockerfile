FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

FROM node:24-alpine AS production

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=peer && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY scripts/routing ./scripts/routing

RUN mkdir -p /app/var/whatsapp-media /app/var/imports/whatsapp /app/var/knowledge \
  && chown -R node:node /app/var

USER node
EXPOSE 3333
CMD ["node", "dist/main.js"]
