FROM node:22.15.0-bookworm-slim AS build

WORKDIR /opt/rad
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev

FROM node:24.19.0-bookworm-slim

ARG CODEX_VERSION=0.148.0
ARG CODE_SERVER_VERSION=4.133.0
ENV NODE_ENV=production \
    HOME=/home/codex \
    CODEX_HOME=/home/codex/.codex

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" "code-server@${CODE_SERVER_VERSION}" \
    && npm cache clean --force \
    && useradd --uid 10001 --create-home --shell /bin/bash codex

WORKDIR /opt/rad
COPY --from=build /opt/rad/apps/agent-worker/dist ./agent-worker/dist
COPY --from=build /opt/rad/packages/agents/dist ./packages/agents/dist
COPY --from=build /opt/rad/packages/shared/dist ./packages/shared/dist
COPY --from=build /opt/rad/node_modules ./node_modules
COPY --chown=root:root images/workspace-node/entrypoint.sh /usr/local/bin/rad-workspace-entrypoint
RUN chmod 0555 /usr/local/bin/rad-workspace-entrypoint

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
HEALTHCHECK --interval=2s --timeout=2s --start-period=120s --retries=5 \
  CMD test -d /workspace/repository/.git && pgrep -f code-server >/dev/null
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/rad-workspace-entrypoint"]
