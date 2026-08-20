import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { IdeAccessControlClient } from "./control-client.js";
import { ideProxyConfigSchema } from "./config.js";
import { createIdeProxyServer } from "./server.js";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const code = "a".repeat(43);
const sessionToken = "b".repeat(43);
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("IDE proxy", () => {
  it("exchanges a fragment-delivered code for an HttpOnly bounded cookie", async () => {
    const control = fakeControl();
    const { url } = await startProxy(control);

    const landing = await fetch(url);
    expect(landing.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await landing.text()).not.toContain(code);

    const response = await fetch(`${url}api/access/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain(`Path=/workspace/${workspaceId}/`);
    expect(await response.json()).toMatchObject({ path: `/workspace/${workspaceId}/` });
  });

  it("revalidates the session and strips its cookie before proxying", async () => {
    let upstreamCookie: string | undefined;
    const upstream = createServer((request, response) => {
      upstreamCookie = request.headers.cookie;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ url: request.url }));
    });
    servers.push(upstream);
    const upstreamUrl = await listen(upstream);
    const control = fakeControl();
    const { url } = await startProxy(control, () => upstreamUrl);

    const response = await fetch(`${url}workspace/${workspaceId}/folder/file?x=1`, {
      headers: { cookie: `rad_ide_session=${sessionToken}; unrelated=value` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "/folder/file?x=1" });
    expect(upstreamCookie).toBe("unrelated=value");
    expect(control.resolved).toEqual([sessionToken]);
  });

  it("rejects missing sessions without contacting a workspace", async () => {
    const control = fakeControl();
    const { url } = await startProxy(control);

    const response = await fetch(`${url}workspace/${workspaceId}/`);

    expect(response.status).toBe(401);
    expect(control.resolved).toEqual([]);
  });
});

function fakeControl(): IdeAccessControlClient & { resolved: string[] } {
  return {
    resolved: [],
    redeem: async (receivedCode) => {
      if (receivedCode !== code) throw new Error("invalid code");
      return {
        sessionToken,
        workspaceId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    resolve: async function (receivedToken) {
      this.resolved.push(receivedToken);
      if (receivedToken !== sessionToken) throw new Error("invalid session");
      return { workspaceId, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
  };
}

async function startProxy(
  control: IdeAccessControlClient,
  target?: (workspaceId: string) => string,
): Promise<{ url: string }> {
  const config = ideProxyConfigSchema.parse({
    RAD_IDE_PROXY_HOST: "127.0.0.1",
    RAD_IDE_PROXY_PUBLIC_URL: "http://127.0.0.1:3001",
    RAD_IDE_PROXY_SHARED_SECRET: "x".repeat(32),
  });
  const server = createIdeProxyServer(config, control, target);
  servers.push(server);
  return { url: await listen(server) };
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
}
