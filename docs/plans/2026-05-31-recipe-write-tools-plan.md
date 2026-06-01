# Recipe Write Tools (PR #3) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the Mealie recipes domain — add 21 tools (all writes + remaining reads) plus the reusable write foundation (MealieClient write verbs + multipart, a `confirm: true` gate, and a server-side read-only switch).

**Architecture:** Generic HTTP-verb primitives on `MealieClient` (1:1 with endpoints; no consolidation logic). Tools live one-per-file under feature subdirectories of `src/tools/recipes/`, with handlers exported separately for testing against hand-written fakes. Reads register unconditionally; writes register only when `MEALIE_READ_ONLY` is unset. Destructive actions require a handler-enforced `confirm: true`. Binary uploads take a server-readable file path (stdio/local only).

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk`, `zod`, Vitest, Biome, tsup. Node ≥20 globals (`fetch`/`FormData`/`Blob`).

**Design reference:** `docs/plans/2026-05-31-recipe-write-tools-design.md`. Read it before starting.

---

## Conventions every task follows

- **TDD:** write the failing test, run it red, implement minimally, run it green, commit.
- **Quality gate before EVERY commit:** `npm run build && npm run typecheck && npm run test && npm run lint`. Empty lint output is **not** proof of success — confirm exit code 0. Never commit on a red gate.
- **No tool throws.** Handlers catch and return `{ isError: true }` (use the `errorResult` helper from Task 4).
- **Strict TS gotchas:** optional MCP arg fields need explicit `| undefined` in the args type. Test fakes of generic client methods must themselves be generic: `async <T>(): Promise<T> => value as T`.
- **Logs go to stderr only** (`logger.*`), never `console.log`/stdout.
- **Commit style:** conventional commits (`feat(recipes): …`, `test(recipes): …`, `refactor(tools): …`). One logical change per commit.
- **Annotations:** set explicitly on every tool — silence implies destructive (design §4.4).

Branch is already `feature/recipe-write-tools` off `develop`. The design doc is already committed.

---

# Phase 1 — Write Foundation

### Task 1: `MealieClient` JSON write verbs (`post`/`put`/`patch`/`delete`)

**Files:**
- Modify: `src/client/MealieClient.ts`
- Create: `src/client/MealieClient.test.ts`

**Step 1: Write the failing test.** Create `src/client/MealieClient.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { MealieApiError } from "./MealieApiError.js";
import { MealieClient } from "./MealieClient.js";

type FetchArgs = { url: string; init: RequestInit };

/** Stubs global fetch, capturing the call and returning a 200 JSON body. */
function stubFetchOk(body: unknown, captured: FetchArgs[]): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("MealieClient write verbs", () => {
  it("post sends a JSON body and Bearer auth, returns parsed JSON", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({ ok: true }, captured);
    const client = new MealieClient("https://m.test/", "tok");

    const result = await client.post<{ ok: boolean }>("/api/recipes", { name: "Soup" });

    const call = captured[0];
    expect(call?.url).toBe("https://m.test/api/recipes");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.body).toBe(JSON.stringify({ name: "Soup" }));
    expect((call?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect((call?.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(result).toEqual({ ok: true });
  });

  it("delete issues a DELETE with no body", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({}, captured);
    const client = new MealieClient("https://m.test", "tok");

    await client.delete("/api/recipes/soup");

    expect(captured[0]?.init.method).toBe("DELETE");
    expect(captured[0]?.init.body).toBeUndefined();
  });

  it("throws MealieApiError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 409, statusText: "Conflict" }));
    const client = new MealieClient("https://m.test", "tok");

    await expect(client.put("/api/recipes/soup", {})).rejects.toBeInstanceOf(MealieApiError);
  });

  it("tolerates an empty 200 body (returns undefined, does not throw)", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 200 }));
    const client = new MealieClient("https://m.test", "tok");

    await expect(client.delete("/api/recipes/soup")).resolves.toBeUndefined();
  });
});
```

**Step 2: Run red.** `npx vitest run src/client/MealieClient.test.ts` → FAIL (`post` not a function).

**Step 3: Implement.** Refactor `MealieClient.ts` to split header construction so multipart (Task 2) can reuse the auth header without `Content-Type`. Replace the constructor + add verbs:

```typescript
export class MealieClient {
  readonly #baseUrl: string;
  readonly #authHeader: string;

  constructor(baseUrl: string, apiToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#authHeader = `Bearer ${apiToken}`;
  }

  /** Headers for JSON requests: auth + JSON content negotiation. */
  #jsonHeaders(): Record<string, string> {
    return {
      Authorization: this.#authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  // get<T> / getPaginated<T> / getAbout stay as-is, but get<T> now calls this.#jsonHeaders()
  // (it must no longer reference the removed #headers field).

  /**
   * Sends a JSON request body with the given method and returns the parsed response.
   *
   * @param method - HTTP method ("POST" | "PUT" | "PATCH")
   * @param path - API path (e.g. "/api/recipes")
   * @param body - JSON-serializable request body
   * @param query - Optional query parameters appended to the URL
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async #send<T>(method: string, path: string, body: unknown, query?: QueryParams): Promise<T> {
    const suffix = query ? this.#querySuffix(query) : "";
    const url = `${this.#baseUrl}${path}${suffix}`;
    logger.debug({ url, method }, "write request");
    const response = await fetch(url, {
      method,
      headers: this.#jsonHeaders(),
      body: JSON.stringify(body),
    });
    return this.#readJson<T>(response, path);
  }

  /** Builds the "?..." URL suffix from query params (empty when none usable). */
  #querySuffix(query: QueryParams): string {
    const queryString = buildQueryString(query);
    return queryString ? `?${queryString}` : "";
  }

  /**
   * Validates the response and parses its JSON body, tolerating an empty body.
   * Mealie's DELETE and several write endpoints return 200/204 with no content;
   * response.json() would throw SyntaxError on the empty string, so read text
   * first and only parse when non-empty.
   *
   * @param response - The fetch Response
   * @param path - API path (for error context)
   * @returns The parsed body, or undefined when the body is empty
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async #readJson<T>(response: Response, path: string): Promise<T> {
    if (!response.ok) throw new MealieApiError(response.status, response.statusText, path);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async post<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    return this.#send<T>("POST", path, body, query);
  }
  async put<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    return this.#send<T>("PUT", path, body, query);
  }
  async patch<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    return this.#send<T>("PATCH", path, body, query);
  }

  /**
   * Sends a DELETE request (no body) and returns the parsed response.
   *
   * @param path - API path of the resource to delete
   * @param query - Optional query parameters
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async delete<T>(path: string, query?: QueryParams): Promise<T> {
    const url = `${this.#baseUrl}${path}${query ? this.#querySuffix(query) : ""}`;
    logger.debug({ url, method: "DELETE" }, "write request");
    const response = await fetch(url, { method: "DELETE", headers: this.#jsonHeaders() });
    return this.#readJson<T>(response, path);
  }
}
```

Refactor `get<T>` to use `this.#jsonHeaders()`, `this.#querySuffix(query)`, and `return this.#readJson<T>(response, path)` (remove the old `#headers` field and the inline `response.ok`/`response.json()` so there is one parse + one query-suffix code path). Re-run the **existing** `about`/`pagination`/recipe tests to confirm the refactor kept reads green.

**Step 4: Run green.** `npx vitest run src/client/` → PASS.

**Step 5: Gate + commit.**
```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/client/MealieClient.ts src/client/MealieClient.test.ts
git commit -m "feat(client): add post/put/patch/delete JSON write verbs"
```

---

### Task 2: `MealieClient.postMultipart`

**Files:** Modify `src/client/MealieClient.ts`, `src/client/MealieClient.test.ts`.

**Step 1: Failing test** (the critical pitfall — no manual `Content-Type`):

```typescript
describe("MealieClient.postMultipart", () => {
  it("sends FormData with auth but NO manual Content-Type (fetch sets the boundary)", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({ image: "abc.webp" }, captured);
    const client = new MealieClient("https://m.test", "tok");
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1, 2, 3])]), "x.jpg");
    form.append("extension", "jpg");

    const result = await client.postMultipart<{ image: string }>("/api/recipes/soup/image", form);

    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(captured[0]?.init.body).toBe(form);
    expect(result).toEqual({ image: "abc.webp" });
  });

  it("supports a method override for multipart PUT", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({}, captured);
    const client = new MealieClient("https://m.test", "tok");
    await client.postMultipart("/api/recipes/soup/image", new FormData(), undefined, "PUT");
    expect(captured[0]?.init.method).toBe("PUT");
  });
});
```

**Step 2: Run red.**

**Step 3: Implement:**

```typescript
  /**
   * Sends a multipart/form-data upload. The Content-Type header is deliberately
   * omitted so fetch derives "multipart/form-data; boundary=..." from the FormData.
   *
   * @param path - API path of the upload endpoint
   * @param formData - The pre-assembled multipart body
   * @param query - Optional query parameters (e.g. translateLanguage)
   * @param method - HTTP method, defaulting to "POST" (some uploads use "PUT")
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async postMultipart<T>(
    path: string,
    formData: FormData,
    query?: QueryParams,
    method = "POST",
  ): Promise<T> {
    const url = `${this.#baseUrl}${path}${query ? this.#querySuffix(query) : ""}`;
    logger.debug({ url, method }, "multipart upload");
    const response = await fetch(url, {
      method,
      headers: { Authorization: this.#authHeader, Accept: "application/json" },
      body: formData,
    });
    return this.#readJson<T>(response, path);
  }
```

**Step 4: Green.** **Step 5: Gate + commit** `feat(client): add postMultipart for file uploads`.

---

### Task 3: `MEALIE_READ_ONLY` config + safe env-boolean

**Files:** Modify `src/config.ts`, Create `src/config.test.ts`.

**Step 1: Failing test** (the `z.coerce.boolean()` trap — `"false"` must stay false):

```typescript
import { describe, expect, it } from "vitest";
import { parseReadOnly } from "./config.js";

describe("parseReadOnly", () => {
  it.each([
    ["true", true], ["1", true], ["yes", true], ["on", true], ["TRUE", true],
    ["false", false], ["0", false], ["", false], [undefined, false],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseReadOnly(input)).toBe(expected);
  });
});
```

**Step 2: Run red.**

**Step 3: Implement** in `src/config.ts`:

```typescript
/** Environment-string values that enable a boolean flag (everything else is false). */
const TRUTHY_ENV_VALUES = ["true", "1", "yes", "on"] as const;

/**
 * Parses an environment-variable string into a boolean. Unlike z.coerce.boolean(),
 * the string "false" maps to false (coerce treats any non-empty string as true).
 *
 * @param value - Raw env value (or undefined when unset)
 * @returns true only when the value is a recognized truthy token (case-insensitive)
 */
export function parseReadOnly(value: string | undefined): boolean {
  if (value === undefined) return false;
  return TRUTHY_ENV_VALUES.includes(value.trim().toLowerCase() as (typeof TRUTHY_ENV_VALUES)[number]);
}
```

Add to `configSchema`: `MEALIE_READ_ONLY: z.preprocess((v) => parseReadOnly(typeof v === "string" ? v : undefined), z.boolean()).default(false),`

**Step 4: Green.** **Step 5: Gate + commit** `feat(config): add MEALIE_READ_ONLY read-only switch`.

---

### Task 4: Shared tool-result + confirmation helpers

**Files:** Create `src/tools/result.ts`, `src/tools/result.test.ts`, `src/tools/confirm.ts`, `src/tools/confirm.test.ts`.

**Step 1: Failing tests.** `result.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { errorResult, jsonResult } from "./result.js";

describe("jsonResult", () => {
  it("wraps data as pretty-printed JSON text content", () => {
    const r = jsonResult({ a: 1 });
    expect(r.isError).toBeUndefined();
    expect((r.content[0] as { text: string }).text).toBe('{\n  "a": 1\n}');
  });
});

describe("errorResult", () => {
  it("returns an isError result carrying the error message", () => {
    const r = errorResult(new Error("boom"), "recipe_create", "Failed to create recipe");
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe("Failed to create recipe: boom");
  });
});
```

`confirm.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { requireConfirmation } from "./confirm.js";

describe("requireConfirmation", () => {
  it("returns an isError result when confirm is not true", () => {
    const r = requireConfirmation(undefined, "delete recipe \"soup\"");
    expect(r?.isError).toBe(true);
    expect((r?.content[0] as { text: string }).text).toContain("confirm: true");
  });

  it("returns null when confirm is true", () => {
    expect(requireConfirmation(true, "delete recipe \"soup\"")).toBeNull();
  });
});
```

**Step 2: Run red.**

**Step 3: Implement.** `src/tools/result.ts`:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logger.js";
import { JSON_INDENT } from "./format.js";

/**
 * Wraps data as a successful MCP tool result with pretty-printed JSON text.
 *
 * @param data - The value to serialize into the tool result
 * @returns An MCP CallToolResult with a single JSON text block
 */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, JSON_INDENT) }] };
}

/**
 * Logs an error and returns a uniform MCP error result (tools never throw).
 *
 * @param error - The caught error (any thrown value)
 * @param logLabel - Stable label for the structured log line (e.g. the tool name)
 * @param messagePrefix - Human-readable prefix shown before the error message
 * @returns An MCP CallToolResult with isError set
 */
export function errorResult(error: unknown, logLabel: string, messagePrefix: string): CallToolResult {
  logger.error({ err: error }, `${logLabel} failed`);
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `${messagePrefix}: ${message}` }], isError: true };
}
```

`src/tools/confirm.ts`:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Guards a destructive action behind an explicit confirm flag. This is real
 * server-side enforcement (defense-in-depth atop the read-only switch), not a
 * trusted annotation.
 *
 * @param confirm - The tool's confirm argument
 * @param action - Human-readable description of what would happen (e.g. 'delete recipe "soup"')
 * @returns An isError result to return immediately, or null when confirmed
 */
export function requireConfirmation(confirm: boolean | undefined, action: string): CallToolResult | null {
  if (confirm === true) return null;
  return {
    content: [{ type: "text", text: `Refusing to ${action} without confirmation. Pass confirm: true to proceed.` }],
    isError: true,
  };
}
```

**Step 4: Green.** **Step 5: Gate + commit** `feat(tools): add shared jsonResult/errorResult/requireConfirmation helpers`.

> **Retrofit (same commit or a follow-up):** update `about.ts`, `recipes/recipe-search.ts`, `recipes/recipe-get.ts` to use `jsonResult`/`errorResult`, keeping their existing tests green. Keep this mechanical — no behavior change.

---

### Task 5: Extract the shared recipe projection

**Files:** Create `src/tools/recipes/recipe-projection.ts`, `src/tools/recipes/recipe-projection.test.ts`. Modify `recipe-get.ts` to import it.

**Step 1: Failing test** — move the projection assertions from `recipe-get.test.ts` intent into a focused unit test:

```typescript
import { describe, expect, it } from "vitest";
import { projectRecipe } from "./recipe-projection.js";

const FULL = { id: "u1", slug: "soup", name: "Soup", description: "d", recipeIngredient: [{ note: "salt" }], nutrition: { calories: "100" } };

describe("projectRecipe", () => {
  it("concise keeps light fields, drops heavy ones", () => {
    const r = projectRecipe(FULL as never, "concise", []);
    expect(r.id).toBe("u1");
    expect(r.recipeIngredient).toBeUndefined();
  });
  it("include adds back requested heavy fields", () => {
    const r = projectRecipe(FULL as never, "concise", ["nutrition"]);
    expect(r.nutrition).toEqual({ calories: "100" });
  });
  it("detailed returns the whole object", () => {
    const r = projectRecipe(FULL as never, "detailed", []);
    expect(r.recipeIngredient).toEqual([{ note: "salt" }]);
  });
});
```

**Step 2: Run red.**

**Step 3: Implement** — move `CONCISE_FIELDS` + `project()` from `recipe-get.ts` into `recipe-projection.ts`, exported as `projectRecipe` with a `RecipeDetail = components["schemas"]["Recipe-Output"]` type and an `Includable = "comments" | "nutrition"` type. Update `recipe-get.ts` to `import { projectRecipe } from "./recipe-projection.js"` and delete its local copies. Confirm `recipe-get.test.ts` still passes unchanged.

**Step 4: Green.** **Step 5: Gate + commit** `refactor(recipes): extract shared projectRecipe helper`.

---

### Task 6: Restructure `recipes/` into feature subdirs + read-only registration plumbing

This enables the 20-source-file cap to hold and wires the read-only switch. Do it as one structural change with green tests at the end.

**Files:**
- `git mv` `recipe-search.ts`(+test), `recipe-get.ts`(+test), `recipe-projection.ts`(+test) → `src/tools/recipes/core/`
- Create `src/tools/recipes/core/index.ts`
- Modify `src/tools/recipes/index.ts`
- Modify `src/server.ts`, `src/index.ts`

**Step 1:** Move files and fix relative imports (the `../../` depth increases by one: `../../client` → `../../../client`, `../format.js` → `../../format.js`, etc.). Run `npx vitest run src/tools/recipes` — expect failures only from import paths; fix until green.

**Step 2:** `src/tools/recipes/core/index.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeGet } from "./recipe-get.js";
import { registerRecipeSearch } from "./recipe-search.js";

/** Registers always-on recipe reads in the core group. */
export function registerCoreReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeSearch(server, client);
  registerRecipeGet(server, client);
  // registerRecipeSuggestions added in Task 7g
}

/** Registers core recipe writes (stripped under read-only). */
export function registerCoreWriteTools(_server: McpServer, _client: MealieClient): void {
  // create/update/delete/update_many/duplicate/mark_made added in Phase 2
}
```

**Step 3:** `src/tools/recipes/index.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerCoreReadTools, registerCoreWriteTools } from "./core/index.js";

/** Options controlling which recipe tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the recipes toolset. Reads are always registered; writes are
 * registered only when not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerRecipeTools(server: McpServer, client: MealieClient, options: RegisterOptions): void {
  registerCoreReadTools(server, client);
  // other read groups added as their phases land
  if (options.readOnly) return;
  registerCoreWriteTools(server, client);
  // other write groups added as their phases land
}
```

**Step 4:** `src/server.ts` — thread the flag:

```typescript
/** Options that influence which tools the server exposes. */
export type ServerOptions = { readOnly: boolean };

export function createServer(client: MealieClient, options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAboutTools(server, client);
  registerRecipeTools(server, client, options);
  return server;
}
```

`src/index.ts` — pass it at both call sites (lines 37, 71): `createServer(client, { readOnly: config.MEALIE_READ_ONLY })`.

**Step 5: Gate + commit** `refactor(recipes): group tools into subdirs and thread read-only switch`.

> As each later group lands, add its `register<Group>ReadTools`/`register<Group>WriteTools` to `recipes/index.ts` (read call unconditional, write call after the `if (options.readOnly) return;` guard).

---

# Phase 2 — Core write tools (`recipes/core/`)

> **ARCHETYPE — full code. Tasks 7b–7g reuse this shape.**

### Task 7a: `recipe_create` (bare-slug → re-fetch → concise)

**Files:** Create `src/tools/recipes/core/recipe-create.ts`, `recipe-create.test.ts`. Register in `core/index.ts` `registerCoreWriteTools`.

**Step 1: Failing test:**

```typescript
import { describe, expect, it } from "vitest";
import { recipeCreateHandler } from "./recipe-create.js";

function fakeClient(slug: string, recipe: unknown, captured: { path?: string; body?: unknown }) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return slug as T;
    },
    get: async <T>(): Promise<T> => recipe as T,
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { text: string }).text);
}

describe("recipeCreateHandler", () => {
  it("posts the name, then re-fetches and returns the concise recipe", async () => {
    const captured = {};
    const client = fakeClient("soup", { id: "u1", slug: "soup", name: "Soup", recipeIngredient: [] }, captured);

    const result = await recipeCreateHandler(client, { name: "Soup" });

    expect(captured.path).toBe("/api/recipes");
    expect(captured.body).toEqual({ name: "Soup" });
    const body = parse(result);
    expect(body.slug).toBe("soup");
    expect(body.recipeIngredient).toBeUndefined(); // concise
  });

  it("returns isError when the client throws", async () => {
    const client = { post: async () => { throw new Error("dup slug"); }, get: async <T>(): Promise<T> => ({}) as T };
    const result = await recipeCreateHandler(client, { name: "x" });
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run red.**

**Step 3: Implement:**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";
import { projectRecipe, type RecipeDetail } from "./recipe-projection.js";

type CreateClient = Pick<MealieClient, "post" | "get">;

const inputSchema = {
  name: z.string().min(1).describe("Name of the new recipe"),
};
type CreateArgs = { name: string };

/**
 * Handles recipe_create: creates a stub recipe, then re-fetches it (the API
 * returns only a slug) and returns the concise projection.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name)
 * @returns An MCP result with the concise created recipe, or an error result
 */
export async function recipeCreateHandler(client: CreateClient, args: CreateArgs): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["CreateRecipe"] = { name: args.name };
    const slug = await client.post<string>("/api/recipes", body);
    const recipe = await client.get<RecipeDetail>(`/api/recipes/${slug}`);
    return jsonResult(projectRecipe(recipe, "concise", []));
  } catch (error) {
    return errorResult(error, "recipe_create", "Failed to create recipe");
  }
}

/**
 * Registers the recipe_create tool.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_create",
    {
      title: "Create Recipe",
      description: "Create a new recipe by name. Returns the created recipe (concise). Use recipe_update to fill in details.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => recipeCreateHandler(client, args),
  );
}
```

`projectRecipe` (Task 5) must also export `type RecipeDetail`. Add `registerRecipeCreate(server, client)` to `registerCoreWriteTools`.

**Step 4: Green.** **Step 5: Gate + commit** `feat(recipes): add recipe_create`.

---

### Tasks 7b–7g: remaining core tools

Each follows the archetype (one file + test, handler with `Pick<MealieClient, …>`, `jsonResult`/`errorResult`, register fn added to the right group function). Specifics:

**7b `recipe_update`** — `Pick<…,"get"|"put"|"patch">`. Args: `slug: string`, `changes: z.record(z.unknown())` (the fields to change), `method: z.enum(["put","patch"]).optional()` default `"patch"`. **Fetch-merge (data-loss guard):** Mealie's PUT *and* PATCH both take the **full** `Recipe-Input` and do full-object replacement — sending only the changed fields silently wipes ingredients/instructions/etc. So the handler MUST: `const current = await client.get<RecipeDetail>("/api/recipes/{slug}")` → `const merged = { ...current, ...changes }` → `client[method]("/api/recipes/{slug}", merged)` → re-fetch → concise. Description tells the agent it only needs to pass changed fields (the tool merges against the current recipe). Annotations `{ readOnlyHint:false, idempotentHint:true, openWorldHint:true }`. Tests: shallow-merges changes onto the fetched recipe before sending (assert the sent body retains untouched fields); routes put vs patch; re-fetches; isError. Commit `feat(recipes): add recipe_update (fetch-merge)`.

**7c `recipe_delete`** — `Pick<…,"delete">`. Args: `slug: string`, `confirm: z.boolean().optional()`. Handler: `requireConfirmation(args.confirm, \`delete recipe "${args.slug}"\`)` guard → `client.delete("/api/recipes/{slug}")` → `jsonResult({ deleted: args.slug })`. Annotations `{ readOnlyHint:false, destructiveHint:true, openWorldHint:true }`. Tests: missing confirm → isError + no delete call; confirm true → deletes + returns `{deleted}`; client throw → isError. Commit `feat(recipes): add recipe_delete with confirm gate`.

**7d `recipe_update_many`** — `Pick<…,"put"|"patch">`. Args: `recipes: z.array(z.record(z.unknown())).min(1)`, `method: z.enum(["put","patch"]).optional()` default `"put"`. **Data-loss guard:** same full-replacement semantics as 7b, but bulk has no per-item merge (that would be N fetches). So each array element MUST be a **complete** recipe object — the description must state clearly: "Each item must be a full recipe (e.g. from recipe_get with response_format=detailed); partial objects will overwrite and wipe omitted fields." Handler: `client[method]("/api/recipes", recipes)` → `jsonResult({ updated: recipes.length })`. Annotations `{ readOnlyHint:false, idempotentHint:true, openWorldHint:true }`. Tests: routes put/patch; summary count; isError. Commit `feat(recipes): add recipe_update_many`.

**7e `recipe_duplicate`** — `Pick<…,"post">`. Args: `slug: string`, `name: z.string().optional()`. Body `RecipeDuplicate = { name? }`. Handler: `client.post<RecipeDetail>("/api/recipes/{slug}/duplicate", body)` returns `Recipe-Output` directly → `jsonResult(projectRecipe(result,"concise",[]))`. Annotations `{ readOnlyHint:false, openWorldHint:true }`. Tests: posts name; concise; isError. Commit `feat(recipes): add recipe_duplicate`.

**7f `recipe_mark_made`** — `Pick<…,"patch">`. Args: `slug: string`, `timestamp: z.string().optional()` (ISO date-time; default to omit → Mealie uses now? — pass through only when provided; body `RecipeLastMade = { timestamp }`, so require it: `timestamp: z.string().describe("ISO 8601 datetime the recipe was last made")`). Handler: `client.patch("/api/recipes/{slug}/last-made", { timestamp })` → `jsonResult({ slug, lastMade: timestamp })`. Annotations `{ readOnlyHint:false, idempotentHint:true, openWorldHint:true }`. Tests: patches body; isError. Commit `feat(recipes): add recipe_mark_made`.

**7g `recipe_suggestions`** (READ — add to `registerCoreReadTools`) — `Pick<…,"get">`. Args: pagination passthrough + `foods: z.array(z.string()).optional()`, `tools: z.array(z.string()).optional()`, `orderBy`/`limit` as Mealie supports. Endpoint `GET /api/recipes/suggestions` → `RecipeSuggestionResponse`. Handler returns the response (concise: map suggestions to id+slug+name+score if present, else pass through). Annotations `{ readOnlyHint:true, openWorldHint:true }`. Tests: query passthrough; isError. Commit `feat(recipes): add recipe_suggestions`.

---

# Phase 3 — Import (`recipes/import/`)

Create `src/tools/recipes/import/index.ts` exporting `registerImportReadTools` (parse_ingredients) and `registerImportWriteTools` (import). Wire both into `recipes/index.ts`.

### Task 8a: `recipe_parse_ingredients` (READ-ish; always on)

`Pick<…,"post">`. Args: `ingredients: z.array(z.string()).min(1)`, `parser: z.enum(["nlp","brute","openai"]).optional()` (matches `RegisteredParser`; default omit → Mealie default nlp). Handler: if one ingredient → `POST /api/parser/ingredient` with `{ parser?, ingredient }` → wrap as array; else `POST /api/parser/ingredients` with `{ parser?, ingredients }`. Return parsed results via `jsonResult`. Annotations `{ readOnlyHint:true, openWorldHint:true }`. Tests: single vs bulk endpoint routing; isError. Commit `feat(recipes): add recipe_parse_ingredients`.

### Task 8b: `recipe_import` (write dispatcher, openWorld) — ARCHETYPE for dispatchers + multipart import

`Pick<…,"post"|"postMultipart"|"get">`. Top-level `inputSchema`:
- `source: z.enum(["url","bulk_url","html_or_json","zip","image","preview"])`
- `url: z.string().url().optional()` — lexical validation ONLY (design §7: never resolve/fetch in-process)
- `urls: z.array(z.string().url()).optional()` (bulk)
- `data: z.string().optional()` (html_or_json raw HTML/JSON)
- `filePath: z.string().optional()` (zip/image — server-readable path)
- `extension: z.string().optional()` (zip default "zip"; image e.g. "jpg")
- `includeTags: z.boolean().optional()`, `includeCategories: z.boolean().optional()`

Handler switches on `source`, validating the required field for that source (missing → `errorResult`-style `isError` "source=url requires url"):
- `url` → `POST /api/recipes/create/url` body `ScrapeRecipe { url, includeTags, includeCategories }` → bare slug → re-fetch → concise.
- `bulk_url` → `POST /api/recipes/create/url/bulk` body `CreateRecipeByUrlBulk { imports: urls.map(u => ({ url: u })) }` → `jsonResult({ accepted: urls.length })` (202 job).
- `html_or_json` → `POST /api/recipes/create/html-or-json` body `ScrapeRecipeData { data, url?, includeTags, includeCategories }` → bare slug → re-fetch → concise.
- `preview` → `POST /api/recipes/test-scrape-url` body `ScrapeRecipeTest { url, useOpenAI:false }` → `jsonResult(result)` (no persistence).
- `zip` → read `filePath` → Blob; FormData `archive`; `postMultipart("/api/recipes/create/zip", form)` → re-fetch by returned slug if present else `jsonResult(result)`.
- `image` → read `filePath` → Blob; FormData append `images`; `postMultipart("/api/recipes/create/image", form, { translateLanguage } if provided)` → `jsonResult(result)`.

**File reading lives in the register callback, not the handler** (so the handler stays fs-free and testable). Pattern: the register callback resolves `filePath`→`Blob` via a small `readUploadFile(path)` util (Task 9 introduces it) and passes the `Blob` to the handler. For dispatchers, pass an optional `file?: Blob` alongside args.

Annotations `{ readOnlyHint:false, openWorldHint:true, destructiveHint:false }`. Description must state: "Imports a recipe. The url/bulk_url/preview sources cause YOUR Mealie server to fetch the URL (open-world). zip/image read a file on the MCP server's filesystem (stdio/local only)."

Tests (handler, with fakes + Blobs, no fs/network): each `source` hits the right endpoint with the right body; `url` re-fetches to concise; missing required field → isError; preview does not re-fetch. Commit `feat(recipes): add recipe_import (8->1 dispatcher)`.

---

# Phase 4 — Images (`recipes/images/`)

Create `images/index.ts` → `registerImagesReadTools` (media) + `registerImagesWriteTools` (image, assets). Introduce the upload-file util here.

### Task 9: `readUploadFile` util + `recipe_image` (multipart + dispatcher) — ARCHETYPE for uploads

**9a util** — Create `src/tools/upload.ts` + test:

```typescript
import { readFile } from "node:fs/promises";

/**
 * Reads a server-local file into a Blob for multipart upload. Only usable when the
 * MCP server shares a filesystem with the caller (stdio/local transport).
 *
 * @param path - Absolute or cwd-relative path to the file on the server
 * @returns A Blob of the file's bytes
 * @throws when the file cannot be read
 */
export async function readUploadFile(path: string): Promise<Blob> {
  const bytes = await readFile(path);
  return new Blob([bytes]);
}
```

Test with a real temp file (write via `node:fs`, read back, assert `.size`). Commit `feat(tools): add readUploadFile upload helper`.

**9b `recipe_image`** — `Pick<…,"postMultipart"|"post"|"delete">`. `inputSchema`: `slug: string`, `action: z.enum(["upload","set_url","delete"])`, `filePath: z.string().optional()`, `extension: z.string().optional()`, `url: z.string().url().optional()`, `confirm: z.boolean().optional()`. Register callback reads `filePath` for `upload` and passes a `Blob`. Handler:
- `upload` → require file+extension; FormData `{ image: blob, extension }`; `postMultipart("/api/recipes/{slug}/image", form, undefined, "PUT")` → `jsonResult(result)` (`UpdateImageResponse`).
- `set_url` → require url; `POST /api/recipes/{slug}/image` body `ScrapeRecipe { url, includeTags:false, includeCategories:false }` → `jsonResult({ slug, imageSource: url })`.
- `delete` → `requireConfirmation(confirm, \`delete the image for "${slug}"\`)` → `client.delete("/api/recipes/{slug}/image")` → `jsonResult({ slug, imageDeleted: true })`.

Annotations `{ readOnlyHint:false, destructiveHint:true, openWorldHint:true }` (destructive because the delete action is). Tests: action routing; upload sends PUT multipart; set_url JSON; delete needs confirm; isError. Commit `feat(recipes): add recipe_image dispatcher`.

### Task 10: `recipe_assets`
`Pick<…,"postMultipart">`. Args: `slug`, `filePath`, `name`, `icon: z.string().optional()` (default `"mdi-file"`), `extension`. Register callback reads file → Blob. Handler: FormData `{ file: blob, name, icon, extension }` → `postMultipart<RecipeAsset>("/api/recipes/{slug}/assets", form)` → `jsonResult(result)`. Annotations `{ readOnlyHint:false, openWorldHint:true }`. Tests: form fields; isError. Commit `feat(recipes): add recipe_assets upload`.

### Task 11: `recipe_media` (READ)
`Pick<…,never>` — pure URL construction, **no network**, returns reference URLs (design §1.3: media is never bytes). Args: `recipeId: string`, `kind: z.enum(["image","asset"]).optional()` default `"image"`, `fileName: z.string().optional()` (default `"original.webp"` for image), `assetFileName: z.string().optional()`. Handler builds `${MEALIE_URL}/api/media/recipes/{recipeId}/images/{fileName}` (or `/assets/{assetFileName}`) and returns `jsonResult({ url })`. Needs the base URL — pass `config.MEALIE_URL` into the register fn, OR add a `MealieClient.mediaUrl(path)` accessor (preferred: add a public `baseUrl` getter to MealieClient; one line, keeps config out of tools). Implement the getter, test it. Annotations `{ readOnlyHint:true, openWorldHint:true }`. Tests: builds image vs asset URL. Commit `feat(recipes): add recipe_media reference URLs`.

---

# Phase 5 — Batch (`recipes/batch/`)

Create `batch/index.ts` → `registerBatchReadTools` (export read) + `registerBatchWriteTools` (bulk_actions, export_run).

### Task 12: `recipe_bulk_actions` (destructive dispatcher) — ARCHETYPE for action+confirm dispatchers
`Pick<…,"post">`. `inputSchema`: `action: z.enum(["tag","categorize","settings","delete"])`, `recipes: z.array(z.string()).min(1)` (recipe slugs/ids), `tags: z.array(z.string()).optional()`, `categories: z.array(z.string()).optional()`, `settings: z.record(z.unknown()).optional()`, `confirm: z.boolean().optional()`. Handler switch:
- `tag` → `POST /api/recipes/bulk-actions/tag` body `AssignTags { recipes, tags: tags.map(name => ({ name })) }`.
- `categorize` → `.../categorize` body `AssignCategories { recipes, categories: categories.map(name => ({ name })) }`.
- `settings` → `.../settings` body `AssignSettings { recipes, settings }`.
- `delete` → `requireConfirmation(confirm, \`bulk-delete ${recipes.length} recipes\`)` → `.../delete` body `DeleteRecipes { recipes }`.
Each returns `jsonResult({ action, count: recipes.length })`. Validate the per-action required field (e.g. `tag` requires `tags`) → isError if missing. Annotations `{ readOnlyHint:false, destructiveHint:true, openWorldHint:true }`. Tests: each action → endpoint+body; delete needs confirm; missing field → isError. Commit `feat(recipes): add recipe_bulk_actions dispatcher`.

### Task 13: `recipe_export` (READ) + `recipe_export_run` (WRITE)
**13a `recipe_export`** (read) — `Pick<…,"get">`. Args: `action: z.enum(["formats","render_one","list_jobs","download_token"])`, `slug: z.string().optional()`, `templateName: z.string().optional()`, `exportId: z.string().optional()`. Routes: `formats`→`GET /api/recipes/exports`; `render_one`→`GET /api/recipes/{slug}/exports?template_name=…` (returns file; return a note + the URL, not bytes); `list_jobs`→`GET /api/recipes/bulk-actions/export`; `download_token`→`GET /api/recipes/bulk-actions/export/{exportId}/download`. Annotations `{ readOnlyHint:true, openWorldHint:true }`. Commit `feat(recipes): add recipe_export reads`.

**13b `recipe_export_run`** (write) — `Pick<…,"post"|"delete">`. Args: `action: z.enum(["start","purge"])`, `recipes: z.array(z.string()).optional()`, `confirm: z.boolean().optional()`. Routes: `start`→`POST /api/recipes/bulk-actions/export` body `ExportRecipes { recipes, exportType:"json" }` → `jsonResult({ accepted: recipes.length })`; `purge`→`requireConfirmation(confirm, "purge all recipe export data")` → `DELETE /api/recipes/bulk-actions/export/purge` → `jsonResult(result)`. Annotations `{ readOnlyHint:false, destructiveHint:true, openWorldHint:true }`. Tests: start body; purge needs confirm. Commit `feat(recipes): add recipe_export_run`.

---

# Phase 6 — Social (`recipes/social/`)

Create `social/index.ts` → `registerSocialReadTools` (comments, timeline, share) + `registerSocialWriteTools` (comment_write, timeline_write, share_write).

### Task 14: `recipe_comments` (READ) + `recipe_comment_write` (WRITE) — ARCHETYPE for split sub-resources
**14a `recipe_comments`** (read) — `Pick<…,"get"|"getPaginated">`. Args: `action: z.enum(["by_recipe","list","get"]).optional()` default `"list"`, `slug: z.string().optional()`, `commentId: z.string().optional()`, pagination passthrough. Routes: `by_recipe`→`GET /api/recipes/{slug}/comments` (array); `list`→`getPaginated("/api/comments")`; `get`→`GET /api/comments/{commentId}`. Concise map comments to `{ id, recipeId, text, createdAt }`. Annotations `{ readOnlyHint:true, openWorldHint:true }`. Commit `feat(recipes): add recipe_comments reads`.

**14b `recipe_comment_write`** (write dispatcher) — `Pick<…,"post"|"put"|"delete">`. Args: `action: z.enum(["create","update","delete"])`, `recipeId: z.string().optional()`, `text: z.string().optional()`, `commentId: z.string().optional()`, `confirm: z.boolean().optional()`. Routes: `create`→`POST /api/comments` body `RecipeCommentCreate { recipeId, text }`; `update`→`PUT /api/comments/{commentId}` body `RecipeCommentUpdate { id: commentId, text }`; `delete`→`requireConfirmation(confirm, \`delete comment ${commentId}\`)` → `DELETE /api/comments/{commentId}`. Validate per-action required fields. Annotations `{ readOnlyHint:false, destructiveHint:true, openWorldHint:true }`. Tests: routing; create/update bodies; delete confirm; missing field isError. Commit `feat(recipes): add recipe_comment_write`.

### Task 15: `recipe_timeline` (READ) + `recipe_timeline_write` (WRITE)
**15a `recipe_timeline`** (read) — `Pick<…,"get"|"getPaginated">`. Args: `action: z.enum(["list","get"]).optional()` default `"list"`, `recipeId: z.string().optional()` (query filter), `eventId: z.string().optional()`, pagination. Routes: `list`→`getPaginated("/api/recipes/timeline/events", { queryFilter: recipe_id... })` (pass Mealie's `queryFilter`/`recipe_id` param — verify exact name in mealie.ts); `get`→`GET /api/recipes/timeline/events/{eventId}`. Concise map. Annotations read. Commit `feat(recipes): add recipe_timeline reads`.

**15b `recipe_timeline_write`** — `Pick<…,"post"|"put"|"delete"|"postMultipart">`. Args: `action: z.enum(["create","update","delete","set_image"])`, `recipeId?`, `subject?`, `eventType: z.enum(["comment","info","system"]).optional()`, `eventMessage?`, `timestamp?`, `eventId?`, `filePath?`, `extension?`, `confirm?`. Routes: `create`→`POST /api/recipes/timeline/events` body `RecipeTimelineEventIn { recipeId, subject, eventType, eventMessage?, timestamp? }`; `update`→`PUT /api/recipes/timeline/events/{eventId}` body `RecipeTimelineEventUpdate { subject, eventMessage? }`; `delete`→confirm → `DELETE …/{eventId}`; `set_image`→ register callback reads file → Blob → FormData `{ image, extension }` → `postMultipart("…/{eventId}/image", form, undefined, "PUT")`. Annotations destructive. Tests as archetype. Commit `feat(recipes): add recipe_timeline_write`.

### Task 16: `recipe_share` (READ) + `recipe_share_write` (WRITE)
**16a `recipe_share`** (read) — `Pick<…,"get">`. Args: `action: z.enum(["list","get","view","view_zip"]).optional()` default `"list"`, `recipeId?` (filter for list), `tokenId?` (for get), `token?` (public view). Routes: `list`→`GET /api/shared/recipes` (optional `?recipe_id=`); `get`→`GET /api/shared/recipes/{tokenId}`; `view`→`GET /api/recipes/shared/{token}` (returns `Recipe-Output` → concise); `view_zip`→ return the reference URL (no bytes). Annotations read. Commit `feat(recipes): add recipe_share reads`.

**16b `recipe_share_write`** — `Pick<…,"post"|"delete">`. Args: `action: z.enum(["create","revoke"])`, `recipeId?`, `expiresAt?`, `tokenId?`, `confirm?`. Routes: `create`→`POST /api/shared/recipes` body `RecipeShareTokenCreate { recipeId, expiresAt? }` → `jsonResult(token)`; `revoke`→`requireConfirmation(confirm, \`revoke share token ${tokenId}\`)` → `DELETE /api/shared/recipes/{tokenId}` → `jsonResult({ revoked: tokenId })`. Annotations destructive. Tests as archetype. Commit `feat(recipes): add recipe_share_write`.

---

# Phase 7 — End-to-end verification + PR

### Task 17: Read-only switch e2e over real stdio
**Files:** Create `src/server.test.ts` (or `test/readonly.e2e.test.ts`).

Use the real MCP SDK client + an in-memory linked transport (`InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk`) so no child process or live Mealie is needed. Build a server with a dummy `MealieClient` and assert the **tools/list**:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MealieClient } from "./client/MealieClient.js";
import { createServer } from "./server.js";

async function listToolNames(readOnly: boolean): Promise<string[]> {
  const server = createServer(new MealieClient("https://m.test", "tok"), { readOnly });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

describe("read-only switch", () => {
  it("hides all write tools when MEALIE_READ_ONLY is on", async () => {
    const names = await listToolNames(true);
    expect(names).toContain("recipe_search");
    expect(names).toContain("recipe_comments");
    for (const write of ["recipe_create", "recipe_update", "recipe_delete", "recipe_import",
      "recipe_bulk_actions", "recipe_image", "recipe_comment_write", "recipe_share_write",
      "recipe_export_run", "recipe_timeline_write", "recipe_assets", "recipe_mark_made", "recipe_duplicate"]) {
      expect(names).not.toContain(write);
    }
  });

  it("exposes write tools when not read-only", async () => {
    const names = await listToolNames(false);
    expect(names).toContain("recipe_create");
    expect(names).toContain("recipe_delete");
  });
});
```

Verify the linked-transport + client API names against the installed SDK version before finalizing. Commit `test(server): verify read-only switch hides write tools e2e`.

### Task 18: README + final sweep
- README: document `MEALIE_READ_ONLY`, the **Mealie ≥1.4.0** expectation for `recipe_import` URL safety (design §7), and the **stdio-only** file-upload limitation. Note the deferred `MEALIE_MCP_IMPORT_HOST_ALLOWLIST` as a possible future knob.
- Confirm every `recipes/*/index.ts` group is wired into `recipes/index.ts` (reads unconditional, writes after the read-only guard).
- Run the full gate one final time; confirm tool count via the e2e test.
- Commit `docs(readme): document read-only switch, import safety, upload limitation`.

### Task 19: Adversarial review + draft PR
- Run the multi-lens code-review workflow (correctness / security / convention-adherence / test-coverage) over the branch diff; fix confirmed findings.
- `git push -u origin feature/recipe-write-tools`
- `gh pr create --draft --base develop --title "feat(recipes): complete recipes domain — writes + remaining reads (PR #3)" --body "<summary + affected files + link to design doc>"`

---

## Open verification points (confirm against `src/types/mealie.ts` during implementation)
- `RecipeSuggestionResponse` exact shape (Task 7g concise mapping).
- Timeline list query-param name for filtering by recipe (Task 15a) — `recipe_id` vs `queryFilter`.
- `TimelineEventType` enum values (Task 15b) — confirm `"comment" | "info" | "system"`.
- `RegisteredParser` enum values (Task 8a) — confirm `"nlp" | "brute" | "openai"`.
- Export `render_one`/`download_token` response handling — both are file/token responses, not recipe JSON; return references, never bytes.
