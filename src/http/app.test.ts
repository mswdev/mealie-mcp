import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { MealieClient } from "../client/MealieClient.js";
import type { Config } from "../config.js";
import { buildHttpApp } from "./app.js";

const TOKEN = "e2e-secret";

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    MEALIE_URL: "https://mealie.example.com",
    MEALIE_API_TOKEN: "api-token",
    TRANSPORT: "http",
    PORT: 0,
    HOST: "127.0.0.1",
    MEALIE_READ_ONLY: false,
    MEALIE_TOOLSETS: new Set(),
    MEALIE_HTTP_AUTH_TOKEN: TOKEN,
    MEALIE_HTTP_ALLOWED_HOSTS: undefined,
    ...overrides,
  } as Config;
}

const stubClient = {} as MealieClient;

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

function start(config: Config): Promise<number> {
  const app = buildHttpApp(config, stubClient);
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve((server?.address() as AddressInfo).port);
    });
  });
}

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
});

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function post(port: number, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/mcp", method: "POST", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("buildHttpApp auth gate", () => {
  it("rejects a POST with no Authorization header (401)", async () => {
    const port = await start(buildConfig());

    const status = await post(port, JSON_HEADERS, INITIALIZE_BODY);

    expect(status).toBe(401);
  });

  it("rejects a POST with a wrong token (401)", async () => {
    const port = await start(buildConfig());

    const status = await post(
      port,
      { ...JSON_HEADERS, Authorization: "Bearer wrong" },
      INITIALIZE_BODY,
    );

    expect(status).toBe(401);
  });

  it("admits a POST with the correct token (not 401/403)", async () => {
    const port = await start(buildConfig());

    const status = await post(
      port,
      { ...JSON_HEADERS, Authorization: `Bearer ${TOKEN}` },
      INITIALIZE_BODY,
    );

    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });
});

describe("buildHttpApp host validation", () => {
  it("rejects a foreign Host header on a localhost bind (403)", async () => {
    const port = await start(buildConfig());

    const status = await post(
      port,
      { ...JSON_HEADERS, Host: "evil.example.com", Authorization: `Bearer ${TOKEN}` },
      INITIALIZE_BODY,
    );

    expect(status).toBe(403);
  });
});
