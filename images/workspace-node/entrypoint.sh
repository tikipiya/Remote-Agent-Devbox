#!/bin/sh
set -eu

umask 077
unset GIT_ASKPASS SSH_ASKPASS SSH_AUTH_SOCK GITHUB_TOKEN GH_TOKEN
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

if [ ! -d /workspace/repository/.git ]; then
  rm -rf /workspace/repository
  git -c credential.helper= -c core.hooksPath=/dev/null clone \
    --branch "$RAD_REPOSITORY_BRANCH" --single-branch -- \
    "$RAD_REPOSITORY_URL" /workspace/repository
  git -C /workspace/repository -c core.hooksPath=/dev/null switch \
    -c "$RAD_AGENT_BRANCH"
fi

codex exec-server \
  --listen ws://127.0.0.1:4500 \
  --strict-config \
  --disable multi_agent &

exec code-server \
  --bind-addr 0.0.0.0:3000 \
  --auth none \
  --disable-telemetry \
  /workspace/repository
