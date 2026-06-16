import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { MealieClient } from "../client/MealieClient.js";
import type { Config } from "../config.js";
import { parseAllowedHosts } from "../config.js";
import { buildHttpApp, respondInternalError, shouldWarnUnprotectedBind } from "./app.js";
import { JSON_RPC_SERVER_ERROR } from "./json-rpc.js";

type FakeResponse = Response & { statusCode: number; body: unknown };

function buildFakeResponse(headersSent = false): FakeResponse {
  const res = {
    headersSent,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as FakeResponse;
}

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

function send(
  method: string,
  port: number,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/mcp", method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("respondInternalError", () => {
  it("sends a JSON-RPC 500 that never leaks the error detail", () => {
    const res = buildFakeResponse();

    respondInternalError(res, new Error("sensitive detail"));

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ jsonrpc: "2.0", id: null });
    expect((res.body as { error: { code: number } }).error.code).toBe(JSON_RPC_SERVER_ERROR);
    expect(JSON.stringify(res.body)).not.toContain("sensitive detail");
  });

  it("does not write a response once headers have already been sent", () => {
    const res = buildFakeResponse(true);

    respondInternalError(res, new Error("boom"));

    expect(res.statusCode).toBe(0);
    expect(res.body).toBeUndefined();
  });
});

describe("shouldWarnUnprotectedBind", () => {
  it.each(["127.0.0.1", "localhost", "::1"])(
    "does not warn for loopback host %s regardless of allow-list",
    (host) => {
      expect(shouldWarnUnprotectedBind(host, undefined)).toBe(false);
      expect(shouldWarnUnprotectedBind(host, ["mealie.example.com"])).toBe(false);
    },
  );

  it.each(["0.0.0.0", "::", "192.168.1.5", "mealie.example.com"])(
    "warns for non-loopback host %s when no allow-list is configured",
    (host) => {
      expect(shouldWarnUnprotectedBind(host, undefined)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "::", "192.168.1.5", "mealie.example.com"])(
    "does not warn for non-loopback host %s once an allow-list is configured",
    (host) => {
      expect(shouldWarnUnprotectedBind(host, ["mealie.example.com", "localhost"])).toBe(false);
    },
  );
});

describe("buildHttpApp auth gate", () => {
  it("rejects a POST with no Authorization header (401)", async () => {
    const port = await start(buildConfig());

    const { status } = await send("POST", port, JSON_HEADERS, INITIALIZE_BODY);

    expect(status).toBe(401);
  });

  it("rejects a POST with a wrong token (401)", async () => {
    const port = await start(buildConfig());

    const { status } = await send(
      "POST",
      port,
      { ...JSON_HEADERS, Authorization: "Bearer wrong" },
      INITIALIZE_BODY,
    );

    expect(status).toBe(401);
  });

  it("admits a POST with the correct token and returns an initialize result (200)", async () => {
    const port = await start(buildConfig());

    const { status, body } = await send(
      "POST",
      port,
      { ...JSON_HEADERS, Authorization: `Bearer ${TOKEN}` },
      INITIALIZE_BODY,
    );

    expect(status).toBe(200);
    expect(body).toContain('"result"');
    expect(body).not.toContain('"error"');
  });
});

describe("buildHttpApp host validation", () => {
  it("rejects a foreign Host header on a localhost bind (403)", async () => {
    const port = await start(buildConfig());

    const { status } = await send(
      "POST",
      port,
      { ...JSON_HEADERS, Host: "evil.example.com", Authorization: `Bearer ${TOKEN}` },
      INITIALIZE_BODY,
    );

    expect(status).toBe(403);
  });

  it("admits a configured Host on a non-loopback bind with an allow-list (200)", async () => {
    const config = buildConfig({
      HOST: "0.0.0.0",
      MEALIE_HTTP_ALLOWED_HOSTS: parseAllowedHosts("mealie.example.com"),
    });
    const port = await start(config);

    const { status } = await send(
      "POST",
      port,
      { ...JSON_HEADERS, Host: "mealie.example.com", Authorization: `Bearer ${TOKEN}` },
      INITIALIZE_BODY,
    );

    expect(status).toBe(200);
  });

  it("rejects an off-list Host on a non-loopback bind with an allow-list (403)", async () => {
    const config = buildConfig({
      HOST: "0.0.0.0",
      MEALIE_HTTP_ALLOWED_HOSTS: parseAllowedHosts("mealie.example.com"),
    });
    const port = await start(config);

    const { status } = await send(
      "POST",
      port,
      { ...JSON_HEADERS, Host: "evil.example.com", Authorization: `Bearer ${TOKEN}` },
      INITIALIZE_BODY,
    );

    expect(status).toBe(403);
  });
});

describe("buildHttpApp method handling", () => {
  it.each(["GET", "DELETE"])(
    "rejects %s /mcp with a 405 JSON-RPC error for an authenticated request",
    async (method) => {
      const port = await start(buildConfig());

      const { status, body } = await send(method, port, {
        ...JSON_HEADERS,
        Authorization: `Bearer ${TOKEN}`,
      });

      expect(status).toBe(405);
      const parsed = JSON.parse(body);
      expect(parsed.error.code).toBe(JSON_RPC_SERVER_ERROR);
      expect(parsed.id).toBeNull();
    },
  );
});
