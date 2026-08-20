FROM node:22.15.0-bookworm-slim AS build

WORKDIR /opt/rad
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev

FROM docker:28.3.3-cli AS docker-cli

FROM node:22.15.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /opt/rad
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build --chown=node:node /opt/rad /opt/rad
RUN mkdir -p /var/lib/rad/artifacts && chown node:node /var/lib/rad/artifacts
USER node
EXPOSE 3000
CMD ["node", "apps/control/dist/main.js"]
