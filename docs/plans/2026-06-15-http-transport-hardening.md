# HTTP Transport Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Execution mode for this run: **sequential TDD in the main loop** (per the task owner). Every bug fix starts with a failing test.

**Goal:** Close the three documented HTTP-mode security gaps (unauthenticated, binds `0.0.0.0`, no host allow-listing) so HTTP transport is secure by default, without touching the stdio path.

**Architecture:** Drive bind-host **and** DNS-rebinding protection through the SDK's own `createMcpExpressApp({ host, allowedHosts })` Express helper (the non-deprecated path), default the bind host to `127.0.0.1`, and add a static-bearer Express auth middleware that is **hard-required** in HTTP mode. The process entry (`src/index.ts`) becomes a thin bootstrap; HTTP app construction + route handlers move to a testable `src/http/` layer.

**Key SDK finding (verified against installed `@modelcontextprotocol/sdk@1.29.0`):**
- The transport-level `allowedHosts` / `allowedOrigins` / `enableDnsRebindingProtection` options **exist but are `@deprecated`** ("Use external middleware for host validation instead"). **We do NOT use them.**
- `createMcpExpressApp({ host })` auto-applies `localhostHostValidation()` when `host ∈ {127.0.0.1, localhost, ::1}`; `createMcpExpressApp({ host, allowedHosts })` applies port-agnostic `hostHeaderValidation(allowedHosts)`; `host ∈ {0.0.0.0, ::}` with no `allowedHosts` only warns.
- `createMcpExpressApp` checks `if (allowedHosts)` — an **empty array is truthy**, so `[]` would 403 every request. The parsed value MUST be `undefined` when unset, never `[]`.
- `hostHeaderValidation` lowercases via the URL API and compares with `Array.includes` — allowed entries must be lowercase. Localhost trio = `['localhost','127.0.0.1','[::1]']`.

**Design decisions (settled with owner):**
1. Auth default: **hard-require** `MEALIE_HTTP_AUTH_TOKEN` in HTTP mode (refuse to start without it).
2. Auth scheme: **static shared bearer**; constant-time compare via fixed-width SHA-256 digests (avoids `crypto.timingSafeEqual` throwing on length mismatch).
3. `MEALIE_HTTP_ALLOWED_HOSTS`: when set, **merge in the localhost trio** so loopback/health checks survive; when unset, rely on `createMcpExpressApp`'s host-based auto-protection.
4. Env names: `HOST` (joins un-prefixed `PORT`/`TRANSPORT`), `MEALIE_HTTP_AUTH_TOKEN`, `MEALIE_HTTP_ALLOWED_HOSTS`.

**Scope note (deliberate):** The SDK validates the `Host` header only, not `Origin`. Acceptable because hard-required bearer auth is the primary control (an attacker's browser-driven request won't carry the token). Recorded in the README security note.

**Tech Stack:** `@modelcontextprotocol/sdk@1.29.0`, `express` + `@types/express` (type-only devDep), `zod@^3.25`, `node:crypto`, Vitest, Biome, TypeScript with `exactOptionalPropertyTypes`.

**File map:**
- Modify: `src/config.ts` — `HOST`, `MEALIE_HTTP_AUTH_TOKEN`, `MEALIE_HTTP_ALLOWED_HOSTS`, `parseAllowedHosts`, cross-field refine, `parseConfig` export.
- Modify: `src/config.test.ts` — tests for `parseAllowedHosts` + `parseConfig` cross-field.
- Create: `src/http/json-rpc.ts` — shared `jsonRpcError(message)` envelope.
- Create: `src/http/auth.ts` — `createBearerAuthMiddleware(token)`.
- Create: `src/http/auth.test.ts` — middleware unit tests.
- Create: `src/http/app.ts` — `buildHttpApp(config, client)` + route handlers.
- Create: `src/http/app.test.ts` — HTTP e2e auth + host-validation gate.
- Modify: `src/index.ts` — thin bootstrap using `buildHttpApp`.
- Modify: `README.md` — rewrite security note + config table.

---

### Task 1: Config — `parseAllowedHosts` (pure parser, TDD)

**Files:**
- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write failing tests** (append to `src/config.test.ts`, import `parseAllowedHosts`):

```typescript
describe("parseAllowedHosts", () => {
  it("returns undefined when unset or effectively empty", () => {
    expect(parseAllowedHosts(undefined)).toBeUndefined();
    expect(parseAllowedHosts("")).toBeUndefined();
    expect(parseAllowedHosts("  ,  ")).toBeUndefined();
  });

  it("merges configured hosts with the localhost trio (deduped, lowercased, trimmed)", () => {
    const hosts = parseAllowedHosts(" Mealie.Example.com , api.local ");

    expect(hosts).toEqual(
      expect.arrayContaining([
        "mealie.example.com",
        "api.local",
        "localhost",
        "127.0.0.1",
        "[::1]",
      ]),
    );
    expect(hosts).toHaveLength(5);
  });

  it("does not duplicate a localhost entry the user already supplied", () => {
    const hosts = parseAllowedHosts("localhost,mealie.example.com");

    expect(hosts).toEqual(
      expect.arrayContaining(["localhost", "127.0.0.1", "[::1]", "mealie.example.com"]),
    );
    expect(hosts).toHaveLength(4);
  });
});
```

**Step 2: Run — confirm fail.** `npm test -- src/config.test.ts` → FAIL (`parseAllowedHosts` not exported).

**Step 3: Implement** in `src/config.ts` (add near `parseToolsets`):

```typescript
/** Loopback hostnames always permitted so local health checks survive an allow-list. */
const LOCALHOST_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"] as const;

/**
 * Parses MEALIE_HTTP_ALLOWED_HOSTS into the Host-header allow-list for DNS-rebinding
 * protection. The value is a comma-separated list; tokens are trimmed, lower-cased, and
 * de-duplicated, then merged with the loopback trio so localhost access always works.
 *
 * Returns `undefined` (never `[]`) when no hosts are configured: createMcpExpressApp treats
 * any array as "validate against this list", so an empty array would reject every request.
 *
 * @param value - Raw env value (or undefined when unset)
 * @returns The merged allow-list, or undefined when nothing is configured
 */
export function parseAllowedHosts(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const hosts = new Set<string>();
  for (const raw of value.split(",")) {
    const token = raw.trim().toLowerCase();
    if (token !== "") hosts.add(token);
  }
  if (hosts.size === 0) return undefined;
  for (const localhost of LOCALHOST_HOSTNAMES) hosts.add(localhost);
  return [...hosts];
}
```

**Step 4: Run — confirm pass.** `npm test -- src/config.test.ts` → PASS.

**Step 5: Commit.**
```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): add parseAllowedHosts for DNS-rebinding allow-list"
```

---

### Task 2: Config — new env fields + hard-require refine + `parseConfig` (TDD)

**Files:**
- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write failing tests** (append; import `parseConfig`):

```typescript
const BASE_ENV = {
  MEALIE_URL: "https://mealie.example.com",
  MEALIE_API_TOKEN: "api-token",
} as const;

describe("parseConfig", () => {
  it("defaults HOST to 127.0.0.1 and leaves auth token unset in stdio mode", () => {
    const result = parseConfig({ ...BASE_ENV });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.HOST).toBe("127.0.0.1");
    expect(result.data.TRANSPORT).toBe("stdio");
    expect(result.data.MEALIE_HTTP_AUTH_TOKEN).toBeUndefined();
  });

  it("rejects http mode without an auth token", () => {
    const result = parseConfig({ ...BASE_ENV, TRANSPORT: "http" });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path[0] === "MEALIE_HTTP_AUTH_TOKEN",
    );
    expect(issue?.message).toContain("required when TRANSPORT=http");
  });

  it("rejects http mode with a whitespace-only auth token", () => {
    const result = parseConfig({ ...BASE_ENV, TRANSPORT: "http", MEALIE_HTTP_AUTH_TOKEN: "   " });

    expect(result.success).toBe(false);
  });

  it("accepts http mode with an auth token and parses the allow-list", () => {
    const result = parseConfig({
      ...BASE_ENV,
      TRANSPORT: "http",
      MEALIE_HTTP_AUTH_TOKEN: "secret",
      MEALIE_HTTP_ALLOWED_HOSTS: "mealie.example.com",
      HOST: "0.0.0.0",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.HOST).toBe("0.0.0.0");
    expect(result.data.MEALIE_HTTP_AUTH_TOKEN).toBe("secret");
    expect(result.data.MEALIE_HTTP_ALLOWED_HOSTS).toEqual(
      expect.arrayContaining(["mealie.example.com", "localhost", "127.0.0.1", "[::1]"]),
    );
  });
});
```

**Step 2: Run — confirm fail.** FAIL (`parseConfig` not exported; fields missing).

**Step 3: Implement** in `src/config.ts`:

3a. Add fields to the object schema and convert it to a refined schema. Replace the `configSchema` definition:

```typescript
const baseConfigSchema = z.object({
  MEALIE_URL: z.string().url("MEALIE_URL must be a valid URL (e.g. https://mealie.example.com)"),
  MEALIE_API_TOKEN: z.string().min(1, "MEALIE_API_TOKEN is required"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PORT),
  HOST: z.string().min(1).default(DEFAULT_HOST),
  MEALIE_READ_ONLY: z
    .preprocess(
      (value) => parseReadOnly(typeof value === "string" ? value : undefined),
      z.boolean(),
    )
    .default(false),
  MEALIE_TOOLSETS: z
    .string()
    .optional()
    .transform((value) => parseToolsets(value)),
  MEALIE_HTTP_AUTH_TOKEN: z.string().optional(),
  MEALIE_HTTP_ALLOWED_HOSTS: z
    .string()
    .optional()
    .transform((value) => parseAllowedHosts(value)),
});

const configSchema = baseConfigSchema.superRefine((config, ctx) => {
  if (config.TRANSPORT !== "http") return;
  if (config.MEALIE_HTTP_AUTH_TOKEN !== undefined && config.MEALIE_HTTP_AUTH_TOKEN.trim() !== "") {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["MEALIE_HTTP_AUTH_TOKEN"],
    message: "MEALIE_HTTP_AUTH_TOKEN is required when TRANSPORT=http",
  });
});
```

3b. Add the default-host constant near the other constants:

```typescript
/** Default HTTP bind host — loopback only, so HTTP mode is not exposed by default. */
const DEFAULT_HOST = "127.0.0.1";
```

3c. Export a pure `parseConfig` and refactor `loadConfig` to use it:

```typescript
/**
 * Validates environment variables against the config schema without side effects.
 * Use this for testing; loadConfig wraps it with process-exit-on-failure.
 *
 * @param env - The environment record to validate (typically process.env)
 * @returns A zod SafeParseReturnType with the validated Config on success
 */
export function parseConfig(env: NodeJS.ProcessEnv): ReturnType<typeof configSchema.safeParse> {
  return configSchema.safeParse(env);
}
```

In `loadConfig`, replace `const result = configSchema.safeParse(process.env);` with `const result = parseConfig(process.env);`.

**Step 4: Run — confirm pass.** `npm test -- src/config.test.ts` → PASS (all old + new).

**Step 5: Commit.**
```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): add HOST, MEALIE_HTTP_AUTH_TOKEN, allowed-hosts; require token for http"
```

---

### Task 3: Shared JSON-RPC error envelope

**Files:**
- Create: `src/http/json-rpc.ts`

No dedicated test (trivial builder; exercised by Task 4 + 5). Extracts the helper currently inlined in `index.ts` so 405 and 401 share it.

**Step 1: Write** `src/http/json-rpc.ts`:

```typescript
/** JSON-RPC error code used by the MCP transport layer for server-side errors. */
export const JSON_RPC_SERVER_ERROR = -32000;

/** A JSON-RPC 2.0 error envelope with a null id. */
export type JsonRpcErrorBody = {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: null;
};

/**
 * Builds a JSON-RPC 2.0 error envelope with a null id.
 *
 * @param message - The human-readable error message to embed
 * @returns A JSON-RPC error object suitable for sending as the response body
 */
export function jsonRpcError(message: string): JsonRpcErrorBody {
  return {
    jsonrpc: "2.0",
    error: { code: JSON_RPC_SERVER_ERROR, message },
    id: null,
  };
}
```

**Step 2: Commit.**
```bash
git add src/http/json-rpc.ts
git commit -m "refactor(http): extract shared jsonRpcError envelope"
```

---

### Task 4: Bearer auth middleware (TDD)

**Files:**
- Create: `src/http/auth.ts`
- Test: `src/http/auth.test.ts`

**Step 1: Write failing tests** `src/http/auth.test.ts` (hand-written fakes, per testing rules):

```typescript
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createBearerAuthMiddleware } from "./auth.js";

const TOKEN = "s3cret-token";

type FakeResponse = Response & { statusCode: number; body: unknown };

function buildFakeResponse(): FakeResponse {
  const res = {
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

function runMiddleware(authorization: string | undefined): {
  res: FakeResponse;
  nextCalled: boolean;
} {
  const req = { headers: { authorization } } as unknown as Request;
  const res = buildFakeResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  createBearerAuthMiddleware(TOKEN)(req, res, next);

  return { res, nextCalled };
}

describe("createBearerAuthMiddleware", () => {
  it("rejects a request with no Authorization header (401)", () => {
    const { res, nextCalled } = runMiddleware(undefined);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects a non-bearer Authorization header (401)", () => {
    const { res, nextCalled } = runMiddleware(`Basic ${TOKEN}`);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects an empty bearer token (401)", () => {
    const { res, nextCalled } = runMiddleware("Bearer ");

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects a wrong token of the SAME length (401)", () => {
    const wrong = "x".repeat(TOKEN.length);
    const { res, nextCalled } = runMiddleware(`Bearer ${wrong}`);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects a wrong token of a DIFFERENT length without throwing (401)", () => {
    const { res, nextCalled } = runMiddleware("Bearer short");

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("accepts the correct token and calls next()", () => {
    const { res, nextCalled } = runMiddleware(`Bearer ${TOKEN}`);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it("never echoes the expected token in the rejection body", () => {
    const { res } = runMiddleware("Bearer wrong");

    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});
```

**Step 2: Run — confirm fail.** FAIL (`./auth.js` missing).

**Step 3: Implement** `src/http/auth.ts`:

```typescript
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { jsonRpcError } from "./json-rpc.js";

/** HTTP status returned when a request fails bearer authentication. */
const HTTP_UNAUTHORIZED = 401;
/** Prefix of an RFC 6750 bearer Authorization header. */
const BEARER_PREFIX = "Bearer ";

/**
 * Hashes a value to a fixed-width SHA-256 digest. Comparing digests keeps the
 * constant-time check safe: timingSafeEqual throws a RangeError on length mismatch,
 * which would otherwise leak the secret's length via the error path.
 *
 * @param value - The string to hash
 * @returns A 32-byte SHA-256 digest buffer
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time string equality via fixed-width SHA-256 digests.
 *
 * @param provided - The candidate value supplied by the caller
 * @param expected - The secret to compare against
 * @returns true when the two strings are byte-for-byte equal
 */
function constantTimeEquals(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Extracts the token from a bearer Authorization header.
 *
 * @param header - The raw Authorization header value (or undefined when absent)
 * @returns The token, or null when the header is missing/malformed/empty
 */
function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * Builds Express middleware that rejects any request lacking a matching
 * `Authorization: Bearer <token>` header with a 401 JSON-RPC error. The token is
 * compared in constant time and never logged or echoed.
 *
 * @param expectedToken - The shared secret required on every request
 * @returns Express middleware enforcing bearer authentication
 */
export function createBearerAuthMiddleware(
  expectedToken: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const provided = extractBearerToken(req.headers.authorization);
    if (provided === null || !constantTimeEquals(provided, expectedToken)) {
      res.status(HTTP_UNAUTHORIZED).json(jsonRpcError("Unauthorized"));
      return;
    }
    next();
  };
}
```

**Step 4: Run — confirm pass.** `npm test -- src/http/auth.test.ts` → PASS.

**Step 5: Commit.**
```bash
git add src/http/auth.ts src/http/auth.test.ts
git commit -m "feat(http): add constant-time bearer auth middleware"
```

---

### Task 5: HTTP app factory + route handlers, with e2e (TDD)

**Files:**
- Create: `src/http/app.ts`
- Test: `src/http/app.test.ts`

This moves `handleMcpPost` / `respondMethodNotAllowed` out of `index.ts` into a testable factory and wires auth + host validation. `buildHttpApp` returns the Express app (no `listen`), so a test can boot it on an ephemeral port.

**Step 1: Write failing e2e** `src/http/app.test.ts`:

```typescript
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
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
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
});

function post(
  port: number,
  headers: Record<string, string>,
  body: string,
): Promise<number> {
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

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

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
```

**Step 2: Run — confirm fail.** FAIL (`./app.js` missing).

**Step 3: Implement** `src/http/app.ts`:

```typescript
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CreateMcpExpressAppOptions } from "@modelcontextprotocol/sdk/server/express.js";
import type { Express, Request, Response } from "express";
import type { MealieClient } from "../client/MealieClient.js";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { createServer } from "../server.js";
import { createBearerAuthMiddleware } from "./auth.js";
import { jsonRpcError } from "./json-rpc.js";

/** HTTP status for an unsupported HTTP method on the /mcp endpoint. */
const HTTP_METHOD_NOT_ALLOWED = 405;

/** The per-request context needed to build a fresh MCP server + transport. */
type HttpContext = { config: Config; client: MealieClient };

/**
 * Builds the createMcpExpressApp options from config, including allowedHosts only when
 * an allow-list is configured (exactOptionalPropertyTypes: never assign `allowedHosts: undefined`).
 *
 * @param config - The validated server configuration
 * @returns Options for createMcpExpressApp (host always; allowedHosts when present)
 */
function buildExpressOptions(config: Config): CreateMcpExpressAppOptions {
  if (config.MEALIE_HTTP_ALLOWED_HOSTS === undefined) return { host: config.HOST };
  return { host: config.HOST, allowedHosts: config.MEALIE_HTTP_ALLOWED_HOSTS };
}

/**
 * Narrows the auth token to a non-empty string. loadConfig guarantees this in HTTP mode;
 * the guard keeps the type honest and fails loudly if reached without a token.
 *
 * @param config - The validated server configuration
 * @returns The required HTTP auth token
 * @throws {Error} when the auth token is missing (should be unreachable after loadConfig)
 */
function requireAuthToken(config: Config): string {
  const token = config.MEALIE_HTTP_AUTH_TOKEN;
  if (token === undefined || token.trim() === "") {
    throw new Error("MEALIE_HTTP_AUTH_TOKEN is required in HTTP mode");
  }
  return token;
}

/**
 * Handles a POST /mcp request with a fresh stateless server + transport pair.
 *
 * @param req - The incoming Express request carrying a JSON-RPC message body
 * @param res - The Express response to stream the MCP reply through
 * @param context - The config + client used to build the per-request server
 * @returns A promise that resolves once the request has been handled
 */
async function handleMcpPost(req: Request, res: Response, context: HttpContext): Promise<void> {
  const server = createServer(context.client, {
    readOnly: context.config.MEALIE_READ_ONLY,
    toolsets: context.config.MEALIE_TOOLSETS,
  });
  const transport = new StreamableHTTPServerTransport({});
  await server.connect(transport as Transport);

  res.on("close", () => {
    server.close().catch((err) => logger.error({ err }, "error closing MCP server"));
  });

  await transport.handleRequest(req, res, req.body);
}

/**
 * Rejects unsupported HTTP methods on the /mcp endpoint with a 405 JSON-RPC error.
 *
 * @param _req - The incoming Express request (unused)
 * @param res - The Express response used to send the 405 error
 */
function respondMethodNotAllowed(_req: Request, res: Response): void {
  res.status(HTTP_METHOD_NOT_ALLOWED).json(jsonRpcError("Method not allowed"));
}

/**
 * Builds the Express app for HTTP transport: DNS-rebinding host validation (via the SDK
 * helper), bearer auth, and the /mcp routes. Does not bind a port — the caller listens.
 *
 * @param config - The validated server configuration
 * @param client - The MealieClient shared across per-request servers
 * @returns A configured Express application ready to listen
 */
export function buildHttpApp(config: Config, client: MealieClient): Express {
  const app = createMcpExpressApp(buildExpressOptions(config));
  app.use(createBearerAuthMiddleware(requireAuthToken(config)));

  const context: HttpContext = { config, client };
  app.post("/mcp", (req, res) => handleMcpPost(req, res, context));
  app.get("/mcp", respondMethodNotAllowed);
  app.delete("/mcp", respondMethodNotAllowed);
  return app;
}
```

**Step 4: Run — confirm pass.** `npm test -- src/http/app.test.ts` → PASS (4 tests).

**Step 5: Commit.**
```bash
git add src/http/app.ts src/http/app.test.ts
git commit -m "feat(http): testable buildHttpApp wiring host validation + bearer auth"
```

---

### Task 6: Thin the entry point (`src/index.ts`)

**Files:**
- Modify: `src/index.ts`

**Step 1: Rewrite** `src/index.ts` so HTTP startup delegates to `buildHttpApp`, binds `config.HOST`, and warns when binding all-interfaces without an allow-list:

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MealieClient } from "./client/MealieClient.js";
import { loadConfig } from "./config.js";
import { buildHttpApp } from "./http/app.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";

/** Bind addresses that expose the server on all interfaces. */
const ALL_INTERFACES_HOSTS = new Set(["0.0.0.0", "::"]);

const config = loadConfig();
const client = new MealieClient(config.MEALIE_URL, config.MEALIE_API_TOKEN);

if (config.TRANSPORT === "stdio") {
  await startStdio();
} else {
  startHttp();
}

/**
 * Starts the MCP server over stdio — the default transport for desktop and CLI clients.
 *
 * @returns A promise that resolves once the server is connected to stdio
 */
async function startStdio(): Promise<void> {
  const server = createServer(client, {
    readOnly: config.MEALIE_READ_ONLY,
    toolsets: config.MEALIE_TOOLSETS,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("mealie-mcp running on stdio");
}

/**
 * Starts the MCP server over HTTP using a stateless StreamableHTTP transport, bound to
 * the configured host. Bearer auth is enforced by buildHttpApp; warns if binding to all
 * interfaces without a Host allow-list (DNS-rebinding protection then relies on auth alone).
 */
function startHttp(): void {
  const app = buildHttpApp(config, client);
  app.listen(config.PORT, config.HOST, () => {
    logger.info({ port: config.PORT, host: config.HOST }, "mealie-mcp running on HTTP");
  });
  if (ALL_INTERFACES_HOSTS.has(config.HOST) && config.MEALIE_HTTP_ALLOWED_HOSTS === undefined) {
    logger.warn(
      { host: config.HOST },
      "Binding to all interfaces without MEALIE_HTTP_ALLOWED_HOSTS; Host-header DNS-rebinding protection is disabled (bearer auth still enforced)",
    );
  }
}
```

**Step 2: Run full suite + typecheck.** `npm run typecheck && npm test` → PASS. (No `index.test.ts`; behavior covered by `app.test.ts`.)

**Step 3: Commit.**
```bash
git add src/index.ts
git commit -m "refactor(http): thin entry point to bootstrap + bind configured host"
```

---

### Task 7: README — rewrite the security note + config table

**Files:**
- Modify: `README.md`

**Step 1:** Add config-table rows (after the `PORT` row):

```markdown
| `HOST` | No | HTTP bind address (default `127.0.0.1`, loopback-only). Set to `0.0.0.0` to expose on all interfaces. |
| `MEALIE_HTTP_AUTH_TOKEN` | http only | Shared bearer token; **required** when `TRANSPORT=http`. Clients must send `Authorization: Bearer <token>`. |
| `MEALIE_HTTP_ALLOWED_HOSTS` | No | Comma-separated Host-header allow-list for DNS-rebinding protection when binding to a non-loopback host. Localhost is always allowed. |
```

**Step 2:** Update the ChatGPT/HTTP example to pass a token and bind explicitly:

```bash
TRANSPORT=http PORT=3000 HOST=0.0.0.0 \
MEALIE_HTTP_AUTH_TOKEN=your-strong-random-token \
MEALIE_HTTP_ALLOWED_HOSTS=mealie-mcp.example.com \
MEALIE_URL=https://your-mealie-instance.com \
MEALIE_API_TOKEN=your-token-here \
npx mealie-mcp
```

**Step 3:** Replace the `> **⚠️ Security:**` blockquote with the secure-by-default reality:

```markdown
> **🔒 Security (HTTP mode):** HTTP mode is **secure by default**:
> - **Binds to `127.0.0.1`** (loopback only). Set `HOST=0.0.0.0` to expose it deliberately.
> - **Requires bearer auth** — the server refuses to start in HTTP mode unless `MEALIE_HTTP_AUTH_TOKEN` is set. Every request must send `Authorization: Bearer <token>`; tokens are compared in constant time and never logged.
> - **DNS-rebinding protection** — on a loopback bind, only `localhost`/`127.0.0.1`/`[::1]` Host headers are accepted. When binding to `0.0.0.0`, set `MEALIE_HTTP_ALLOWED_HOSTS` to your public hostname(s) to keep Host-header validation on (localhost stays allowed).
>
> Bearer auth is the primary control; Host-header validation is defense-in-depth. **Origin headers are not validated** — front with HTTPS/a reverse proxy for internet-facing deployments. For local single-user setups, prefer the default `stdio` transport.
```

**Step 4: Commit.**
```bash
git add README.md
git commit -m "docs: rewrite HTTP security note for secure-by-default hardening"
```

---

### Task 8: Full quality gate (EXIT-CODE verified) + stdio surface unchanged

**Step 1:** Run the gate and confirm GREEN by exit code (do NOT pipe to `tail` — biome prints errors then a summary):

```bash
npm run build && npm run typecheck && npm run test && npm run lint && echo GREEN
```

Expected: ends with `GREEN`. If biome flags `noUnusedTemplateLiteral` (unsafe fix), run `npx biome check --write --unsafe .` then re-run the gate.

**Step 2:** Confirm the stdio tool surface is unchanged — the all-toolsets count test still passes (the same `npm test` run above includes it). Spot-check:

```bash
grep -rn "121\|66\|259" src --include=*.test.ts | head
```

**Step 3:** Sanity-check the binary still refuses http without a token:

```bash
TRANSPORT=http MEALIE_URL=https://x.example.com MEALIE_API_TOKEN=t node dist/index.js
```

Expected: exits non-zero with `MEALIE_HTTP_AUTH_TOKEN is required when TRANSPORT=http`.

**Step 4: Adversarial review** (Workflow) + `superpowers:code-reviewer`, then address findings (each bug → failing test first).

**Step 5:** Push branch + open **draft** PR into `develop`.

```bash
git push -u origin feature/http-hardening
gh pr create --draft --base develop --title "feat: harden HTTP transport (auth, loopback bind, DNS-rebinding)" --body "<summary>"
```
