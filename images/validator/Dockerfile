FROM node:22.15.0-bookworm-slim AS build

WORKDIR /opt/rad
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build --workspace=@rad/validator

FROM node:22.15.0-bookworm-slim

ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10002 --home-dir /nonexistent --shell /usr/sbin/nologin validator
WORKDIR /opt/rad
COPY --from=build --chown=validator:validator /opt/rad/apps/validator/dist ./validator
USER validator
ENTRYPOINT ["node", "/opt/rad/validator/main.js"]
