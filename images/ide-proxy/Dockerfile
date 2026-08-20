FROM node:22.15.0-bookworm-slim AS build

WORKDIR /opt/rad
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev

FROM node:22.15.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /opt/rad
COPY --from=build --chown=node:node /opt/rad /opt/rad
USER node
EXPOSE 3001
CMD ["node", "apps/ide-proxy/dist/main.js"]
