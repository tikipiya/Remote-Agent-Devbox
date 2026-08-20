import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

import httpProxy from "http-proxy";
import { z } from "zod";

import type { IdeProxyConfig } from "./config.js";
import type { IdeAccessControlClient } from "./control-client.js";

const workspaceIdSchema = z.uuid();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const redeemBodySchema = z.object({ code: tokenSchema }).strict();
const sessionCookieName = "rad_ide_session";
const workspacePathPattern = /^\/workspace\/([0-9a-f-]{36})(?:\/(.*))?$/;

interface ProxiedRequest extends IncomingMessage {
  radIdePrefix?: string;
}

type WorkspaceTargetResolver = (workspaceId: string) => string;

export function createIdeProxyServer(
  config: IdeProxyConfig,
  control: IdeAccessControlClient,
  workspaceTarget: WorkspaceTargetResolver = (workspaceId) =>
    `http://rad-ws-${workspaceId}:3000`,
): Server {
  const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true, xfwd: true });

  proxy.on("proxyReq", (proxyRequest, request: ProxiedRequest) => {
    proxyRequest.removeHeader("authorization");
    forwardNonAuthorityCookies(proxyRequest, request);
    if (request.radIdePrefix) {
      proxyRequest.setHeader("x-forwarded-prefix", request.radIdePrefix);
    }
  });
  proxy.on("proxyReqWs", (proxyRequest, request: ProxiedRequest) => {
    proxyRequest.removeHeader("authorization");
    forwardNonAuthorityCookies(proxyRequest, request);
    if (request.radIdePrefix) {
      proxyRequest.setHeader("x-forwarded-prefix", request.radIdePrefix);
    }
  });
  proxy.on("proxyRes", (proxyResponse, request: ProxiedRequest) => {
    const responseCookies = proxyResponse.headers["set-cookie"];
    if (responseCookies && request.radIdePrefix) {
      const safeCookies = responseCookies
        .filter((cookie) => !cookie.toLowerCase().startsWith(`${sessionCookieName}=`))
        .map((cookie) => scopeUpstreamCookie(cookie, request.radIdePrefix as string));
      if (safeCookies.length > 0) proxyResponse.headers["set-cookie"] = safeCookies;
      else delete proxyResponse.headers["set-cookie"];
    }
    proxyResponse.headers["referrer-policy"] = "no-referrer";
    proxyResponse.headers["x-content-type-options"] = "nosniff";
    proxyResponse.headers["x-frame-options"] = "DENY";
    const location = proxyResponse.headers.location;
    if (request.radIdePrefix && location?.startsWith("/")) {
      proxyResponse.headers.location = `${request.radIdePrefix}${location}`;
    }
  });
  proxy.on("error", (_error, _request, response) => {
    if (isServerResponse(response) && !response.headersSent) {
      writeJson(response, 502, { error: "IDE_UPSTREAM_UNAVAILABLE" });
    }
  });

  const server = createServer((request, response) => {
    void handleRequest(request, response, config, control, proxy, workspaceTarget);
  });
  server.on("upgrade", (request, socket, head) => {
    void handleUpgrade(request, socket, head, control, proxy, workspaceTarget);
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: IdeProxyConfig,
  control: IdeAccessControlClient,
  proxy: ReturnType<typeof httpProxy.createProxyServer>,
  workspaceTarget: WorkspaceTargetResolver,
): Promise<void> {
  setSecurityHeaders(response);
  const url = new URL(request.url ?? "/", config.RAD_IDE_PROXY_PUBLIC_URL);

  if (request.method === "GET" && url.pathname === "/") {
    response.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(bootstrapHtml);
    return;
  }
  if (request.method === "GET" && url.pathname === "/bootstrap.js") {
    response.setHeader("content-type", "text/javascript; charset=utf-8");
    response.end(bootstrapScript);
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/access/redeem") {
    try {
      const { code } = redeemBodySchema.parse(await readJsonBody(request));
      const session = await control.redeem(code);
      const maxAge = Math.max(
        0,
        Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1_000),
      );
      const path = `/workspace/${workspaceIdSchema.parse(session.workspaceId)}/`;
      response.setHeader(
        "set-cookie",
        serializeSessionCookie(session.sessionToken, path, maxAge, config),
      );
      writeJson(response, 200, { path, expiresAt: session.expiresAt });
    } catch {
      writeJson(response, 401, { error: "IDE_ACCESS_CODE_INVALID" });
    }
    return;
  }

  const workspaceRoute = parseWorkspaceRoute(url);
  if (!workspaceRoute) {
    writeJson(response, 404, { error: "NOT_FOUND" });
    return;
  }
  try {
    const sessionToken = requireSessionCookie(request);
    const session = await control.resolve(sessionToken);
    if (session.workspaceId !== workspaceRoute.workspaceId) throw new Error("workspace mismatch");
    const proxiedRequest = request as ProxiedRequest;
    proxiedRequest.url = workspaceRoute.upstreamPath;
    proxiedRequest.radIdePrefix = workspaceRoute.prefix;
    proxy.web(proxiedRequest, response, { target: workspaceTarget(workspaceRoute.workspaceId) });
  } catch {
    writeJson(response, 401, { error: "IDE_SESSION_INVALID" });
  }
}

async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  control: IdeAccessControlClient,
  proxy: ReturnType<typeof httpProxy.createProxyServer>,
  workspaceTarget: WorkspaceTargetResolver,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://ide-proxy.invalid");
    const workspaceRoute = parseWorkspaceRoute(url);
    if (!workspaceRoute) throw new Error("invalid workspace path");
    const sessionToken = requireSessionCookie(request);
    const session = await control.resolve(sessionToken);
    if (session.workspaceId !== workspaceRoute.workspaceId) throw new Error("workspace mismatch");
    const proxiedRequest = request as ProxiedRequest;
    proxiedRequest.url = workspaceRoute.upstreamPath;
    proxiedRequest.radIdePrefix = workspaceRoute.prefix;
    proxy.ws(proxiedRequest, socket as Socket, head, {
      target: workspaceTarget(workspaceRoute.workspaceId),
    });
  } catch {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  }
}

function parseWorkspaceRoute(url: URL): {
  workspaceId: string;
  upstreamPath: string;
  prefix: string;
} | undefined {
  const match = workspacePathPattern.exec(url.pathname);
  if (!match?.[1]) return undefined;
  const workspaceId = workspaceIdSchema.safeParse(match[1]);
  if (!workspaceId.success) return undefined;
  return {
    workspaceId: workspaceId.data,
    upstreamPath: `/${match[2] ?? ""}${url.search}`,
    prefix: `/workspace/${workspaceId.data}`,
  };
}

function requireSessionCookie(request: IncomingMessage): string {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === sessionCookieName) return tokenSchema.parse(valueParts.join("="));
  }
  throw new Error("IDE session cookie is missing");
}

function forwardNonAuthorityCookies(
  proxyRequest: { removeHeader(name: string): void; setHeader(name: string, value: string): void },
  request: IncomingMessage,
): void {
  const cookies = (request.headers.cookie?.split(";") ?? [])
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.split("=", 1)[0] !== sessionCookieName);
  if (cookies.length === 0) proxyRequest.removeHeader("cookie");
  else proxyRequest.setHeader("cookie", cookies.join(";"));
}

function scopeUpstreamCookie(cookie: string, prefix: string): string {
  const withoutDomain = cookie.replace(/;\s*Domain=[^;]*/gi, "");
  if (/;\s*Path=/i.test(withoutDomain)) {
    return withoutDomain.replace(/;\s*Path=[^;]*/i, `; Path=${prefix}/`);
  }
  return `${withoutDomain}; Path=${prefix}/`;
}

function serializeSessionCookie(
  token: string,
  path: string,
  maxAge: number,
  config: IdeProxyConfig,
): string {
  tokenSchema.parse(token);
  return [
    `${sessionCookieName}=${token}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    config.RAD_IDE_PROXY_PUBLIC_URL.startsWith("https://") ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 4_096) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function writeJson(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function isServerResponse(value: unknown): value is ServerResponse {
  return Boolean(value && typeof value === "object" && "headersSent" in value);
}

const bootstrapHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Opening IDE…</title></head>
<body><p id="status">Exchanging one-time IDE access…</p><script type="module" src="/bootstrap.js"></script></body>
</html>`;

const bootstrapScript = `const status = document.querySelector("#status");
const match = /^#access=([A-Za-z0-9_-]{43})$/.exec(location.hash);
history.replaceState(null, "", location.pathname);
if (!match) {
  status.textContent = "This IDE access URL is invalid or has already been used.";
} else {
  fetch("/api/access/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: match[1] }),
    credentials: "same-origin"
  }).then(async (response) => {
    if (!response.ok) throw new Error("access rejected");
    const result = await response.json();
    location.replace(result.path);
  }).catch(() => {
    status.textContent = "This IDE access URL is invalid or has expired.";
  });
}`;
