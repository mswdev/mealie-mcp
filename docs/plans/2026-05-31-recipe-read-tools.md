# Recipe READ Tools (PR #2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the read foundation (query params + pagination on `MealieClient`) and the first two namespaced, consolidated Recipes tools — `recipe_search` and `recipe_get` — establishing every read-side convention from the design doc.

**Architecture:** Extend the 1:1 `MealieClient` with typed query-param support and a normalized paginated-list helper. Add a `src/tools/recipes/` toolset (one tool per file + `index.ts` exporting `registerRecipeTools`), wired into `createServer`. `recipe_get`'s concise/detailed/`include` is a pure projection over the single `Recipe-Output` response (Mealie returns `comments`+`nutrition` inline — no extra calls). Handlers are exported separately and tested with hand-written fakes.

**Tech Stack:** TypeScript ESM (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk` ^1.29.0, zod, vitest, biome, tsup. Node ≥20.

**Authoritative design:** `docs/plans/2026-05-31-tool-design-and-coverage-roadmap.md` §1 (conventions) + §2 (this PR). §3 roadmap is future context, NOT in scope.

**Verified facts (from the live OpenAPI spec + generated `src/types/mealie.ts`):**
- `GET /api/recipes` → `components["schemas"]["PaginationBase_RecipeSummary_"]` with fields `page`, `per_page`, `total`, `total_pages`, `items`, `next`, `previous`. Query params include `search`, `orderBy`, `orderDirection`, `page`, `perPage`, `categories`, `tags`, `tools`, `foods`, `cookbook`, `requireAll*`, `queryFilter`.
- `RecipeSummary` has `id` (UUID), `slug`, `name` (+ summary fields).
- `GET /api/recipes/{slug}` → `components["schemas"]["Recipe-Output"]`, which **includes** `recipeIngredient`, `recipeInstructions`, `nutrition`, `comments`, `assets`, `notes`, `extras`, `settings` inline.

**Starting state:** branch `feature/recipe-read-tools` (off `develop`). Scaffold merged: `MealieClient` (get only) + `MealieApiError`, `config`, `logger`, `createServer`, stdio+http entry, `get_about`. Gate: `npm run build && npm run test && npm run lint`.

---

### Task 1: Add query-param support + pagination types to MealieClient

**Files:**
- Create: `src/client/pagination.ts`
- Create: `src/client/pagination.test.ts`
- Modify: `src/client/MealieClient.ts`

**Step 1: Write the failing test** — `src/client/pagination.ts`

```typescript
// src/client/pagination.test.ts
import { describe, expect, it } from "vitest";
import { buildQueryString, normalizePagination } from "./pagination.js";

describe("buildQueryString", () => {
  it("omits undefined/null and serializes scalars", () => {
    const qs = buildQueryString({ page: 2, search: "soup", missing: undefined, gone: null });

    expect(qs).toBe("page=2&search=soup");
  });

  it("repeats the key for array values", () => {
    const qs = buildQueryString({ tags: ["a", "b"], page: 1 });

    expect(qs).toBe("tags=a&tags=b&page=1");
  });

  it("returns an empty string for no usable params", () => {
    expect(buildQueryString({ a: undefined })).toBe("");
  });
});

describe("normalizePagination", () => {
  it("maps Mealie's snake_case envelope to a normalized result", () => {
    const result = normalizePagination({
      items: [{ id: "x" }],
      total: 5,
      page: 1,
      per_page: 20,
      total_pages: 1,
    });

    expect(result).toEqual({ items: [{ id: "x" }], total: 5, page: 1, perPage: 20, totalPages: 1 });
  });

  it("defaults missing numeric fields to 0", () => {
    const result = normalizePagination({ items: [] });

    expect(result).toEqual({ items: [], total: 0, page: 0, perPage: 0, totalPages: 0 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/pagination.test.ts`
Expected: FAIL — `Cannot find module './pagination.js'`.

**Step 3: Write minimal implementation** — `src/client/pagination.ts`

```typescript
/** A query-string value; `undefined`/`null` are dropped, arrays repeat the key. */
export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

/** Map of query parameters passed to a list/search endpoint. */
export type QueryParams = Record<string, QueryValue>;

/** A normalized, camelCase pagination envelope returned to tools. */
export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

/** Mealie's raw pagination envelope (snake_case, fields may be null). */
type MealiePage<T> = {
  items: T[];
  total?: number | null;
  page?: number | null;
  per_page?: number | null;
  total_pages?: number | null;
};

/**
 * Builds a URL query string from params, dropping `undefined`/`null` and
 * repeating the key once per element for array values.
 *
 * @param params - The query parameters to serialize
 * @returns An encoded query string without the leading "?" (empty if no usable params)
 */
export function buildQueryString(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
      continue;
    }
    search.append(key, String(value));
  }
  return search.toString();
}

/**
 * Normalizes Mealie's snake_case pagination envelope to the camelCase shape tools use.
 *
 * @param page - The raw Mealie pagination envelope
 * @returns The normalized result with numeric fields defaulted to 0
 */
export function normalizePagination<T>(page: MealiePage<T>): PaginatedResult<T> {
  return {
    items: page.items,
    total: page.total ?? 0,
    page: page.page ?? 0,
    perPage: page.per_page ?? 0,
    totalPages: page.total_pages ?? 0,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/pagination.test.ts`
Expected: PASS (5 tests).

**Step 5: Extend `MealieClient.get` with query support + add `getPaginated`** — `src/client/MealieClient.ts`

Add the import at the top (after the existing imports):
```typescript
import { buildQueryString, normalizePagination } from "./pagination.js";
import type { PaginatedResult, QueryParams } from "./pagination.js";
```

Replace the existing `get<T>` method with a query-aware version and add `getPaginated`:
```typescript
  /**
   * Fetches a resource from the Mealie API.
   *
   * @param path - The API path (e.g. "/api/app/about")
   * @param query - Optional query parameters appended to the URL
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async get<T>(path: string, query?: QueryParams): Promise<T> {
    const queryString = query ? buildQueryString(query) : "";
    const suffix = queryString ? `?${queryString}` : "";
    const url = `${this.#baseUrl}${path}${suffix}`;
    logger.debug({ url }, "GET request");

    const response = await fetch(url, { headers: this.#headers });

    if (!response.ok) {
      throw new MealieApiError(response.status, response.statusText, path);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetches a paginated list and normalizes Mealie's envelope.
   *
   * @param path - The list endpoint path (e.g. "/api/recipes")
   * @param query - Optional pagination/filter query parameters
   * @returns A normalized paginated result
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async getPaginated<T>(path: string, query?: QueryParams): Promise<PaginatedResult<T>> {
    const page = await this.get<{ items: T[] }>(path, query);
    return normalizePagination(page as Parameters<typeof normalizePagination<T>>[0]);
  }
```

**Step 6: Run the gate**

Run: `npm run build && npx vitest run && npm run lint`
Expected: build OK, all tests pass (existing + new), lint clean.

> If biome flags the `getPaginated` cast, simplify by typing the intermediate as the `MealiePage`-compatible shape; do NOT use `any`.

**Step 7: Commit**

```bash
git add src/client/pagination.ts src/client/pagination.test.ts src/client/MealieClient.ts
git commit -m "feat(client): add query-param support and normalized pagination"
```

---

### Task 2: `recipe_search` tool (TDD)

**Files:**
- Create: `src/tools/recipes/recipe-search.ts`
- Create: `src/tools/recipes/recipe-search.test.ts`

**Step 1: Write the failing test** — `src/tools/recipes/recipe-search.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../client/pagination.js";
import { recipeSearchHandler } from "./recipe-search.js";

type Captured = { path: string; query: unknown };

function fakeClient(result: PaginatedResult<unknown>, captured: Captured) {
  return {
    getPaginated: async (path: string, query?: unknown): Promise<PaginatedResult<unknown>> => {
      captured.path = path;
      captured.query = query;
      return result;
    },
  };
}

function parse(result: { content: { type: string }[] }): Record<string, unknown> {
  const first = result.content[0];
  expect(first?.type).toBe("text");
  return JSON.parse((first as { type: "text"; text: string }).text) as Record<string, unknown>;
}

describe("recipeSearchHandler", () => {
  it("passes pagination + filters through and returns concise items with meta", async () => {
    const captured: Captured = { path: "", query: undefined };
    const client = fakeClient(
      { items: [{ id: "u1", slug: "soup", name: "Soup", extra: "drop" }], total: 1, page: 1, perPage: 20, totalPages: 1 },
      captured,
    );

    const result = await recipeSearchHandler(client, { search: "soup", tags: ["t1"], perPage: 20 });

    expect(captured.path).toBe("/api/recipes");
    expect(captured.query).toMatchObject({ search: "soup", tags: ["t1"], perPage: 20 });
    const body = parse(result);
    expect(body.total).toBe(1);
    expect(body.items).toEqual([{ id: "u1", slug: "soup", name: "Soup" }]);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      getPaginated: async (): Promise<PaginatedResult<unknown>> => {
        throw new Error("boom");
      },
    };

    const result = await recipeSearchHandler(client, {});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("boom");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/recipes/recipe-search.test.ts`
Expected: FAIL — `Cannot find module './recipe-search.js'`.

**Step 3: Write minimal implementation** — `src/tools/recipes/recipe-search.ts`

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import type { components } from "../../types/mealie.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;

type RecipeSummary = components["schemas"]["RecipeSummary"];
/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  search: z.string().optional().describe("Full-text search across recipe names/descriptions"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z.number().int().positive().max(100).optional().describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. name, created_at, rating)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
  categories: z.array(z.string()).optional().describe("Filter by category slugs/ids"),
  tags: z.array(z.string()).optional().describe("Filter by tag slugs/ids"),
  tools: z.array(z.string()).optional().describe("Filter by tool slugs/ids"),
  foods: z.array(z.string()).optional().describe("Filter by food ids"),
};

type SearchArgs = {
  search?: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  categories?: string[];
  tags?: string[];
  tools?: string[];
  foods?: string[];
};

/**
 * Handles the recipe_search tool: lists recipes with pagination + filters.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments
 * @returns An MCP result with concise items (id, slug, name) + pagination meta
 */
export async function recipeSearchHandler(client: SearchClient, args: SearchArgs): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<RecipeSummary>("/api/recipes", {
      ...args,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
    });
    return { content: [{ type: "text", text: JSON.stringify(toConcise(page), null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Failed to search recipes: ${message}` }], isError: true };
  }
}

/** Projects a recipe page to concise items (uuid + slug + name) plus pagination meta. */
function toConcise(page: PaginatedResult<RecipeSummary>): Record<string, unknown> {
  return {
    items: page.items.map((r) => ({ id: r.id, slug: r.slug, name: r.name })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the recipe_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_search",
    {
      title: "Search Recipes",
      description: "Search and filter recipes with pagination. Returns concise summaries (id, slug, name).",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => recipeSearchHandler(client, args),
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/recipes/recipe-search.test.ts`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/tools/recipes/recipe-search.ts src/tools/recipes/recipe-search.test.ts
git commit -m "feat(recipes): add recipe_search tool"
```

---

### Task 3: `recipe_get` tool with concise/detailed projection (TDD)

**Files:**
- Create: `src/tools/recipes/recipe-get.ts`
- Create: `src/tools/recipes/recipe-get.test.ts`

**Step 1: Write the failing test** — `src/tools/recipes/recipe-get.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { recipeGetHandler } from "./recipe-get.js";

const FULL = {
  id: "uuid-1",
  slug: "soup",
  name: "Soup",
  description: "Tasty",
  recipeIngredient: [{ note: "salt" }],
  recipeInstructions: [{ text: "boil" }],
  nutrition: { calories: "100" },
  comments: [{ text: "yum" }],
  notes: [{ title: "n" }],
};

function fakeClient(recipe: unknown) {
  return { get: async (): Promise<unknown> => recipe };
}

function parse(result: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: "text"; text: string }).text) as Record<string, unknown>;
}

describe("recipeGetHandler", () => {
  it("concise (default) drops heavy fields but keeps id+slug+name", async () => {
    const result = await recipeGetHandler(fakeClient(FULL), { slug: "soup" });

    const body = parse(result);
    expect(body.id).toBe("uuid-1");
    expect(body.slug).toBe("soup");
    expect(body.recipeIngredient).toBeUndefined();
    expect(body.nutrition).toBeUndefined();
    expect(body.comments).toBeUndefined();
  });

  it("include adds back requested heavy fields onto the concise view", async () => {
    const result = await recipeGetHandler(fakeClient(FULL), { slug: "soup", include: ["nutrition", "comments"] });

    const body = parse(result);
    expect(body.nutrition).toEqual({ calories: "100" });
    expect(body.comments).toEqual([{ text: "yum" }]);
    expect(body.recipeIngredient).toBeUndefined();
  });

  it("detailed returns the full object", async () => {
    const result = await recipeGetHandler(fakeClient(FULL), { slug: "soup", response_format: "detailed" });

    const body = parse(result);
    expect(body.recipeIngredient).toEqual([{ note: "salt" }]);
    expect(body.recipeInstructions).toEqual([{ text: "boil" }]);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      get: async (): Promise<unknown> => {
        throw new Error("not found");
      },
    };

    const result = await recipeGetHandler(client, { slug: "missing" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("not found");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/recipes/recipe-get.test.ts`
Expected: FAIL — `Cannot find module './recipe-get.js'`.

**Step 3: Write minimal implementation** — `src/tools/recipes/recipe-get.ts`

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";

/** Indentation for JSON output. */
const JSON_INDENT = 2;

type RecipeDetail = components["schemas"]["Recipe-Output"];
type Includable = "comments" | "nutrition";
/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

/** Lightweight fields kept in the concise projection (design §1.3). */
const CONCISE_FIELDS = [
  "id", "slug", "name", "description", "image", "rating",
  "recipeServings", "recipeYield", "recipeYieldQuantity",
  "totalTime", "prepTime", "cookTime", "performTime",
  "recipeCategory", "tags", "tools", "dateUpdated", "lastMade",
] as const;

const inputSchema = {
  slug: z.string().describe("The recipe slug (from recipe_search results)"),
  response_format: z.enum(["concise", "detailed"]).optional().describe("concise (default) trims heavy fields; detailed returns everything"),
  include: z.array(z.enum(["comments", "nutrition"])).optional().describe("Add specific heavy fields onto the concise view"),
};

type GetArgs = { slug: string; response_format?: "concise" | "detailed"; include?: Includable[] };

/**
 * Handles the recipe_get tool: fetches one recipe and projects it per response_format.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, response_format, include)
 * @returns An MCP result with the projected recipe (always includes id + slug)
 */
export async function recipeGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    const recipe = await client.get<RecipeDetail>(`/api/recipes/${args.slug}`);
    const projected = project(recipe, args.response_format ?? "concise", args.include ?? []);
    return { content: [{ type: "text", text: JSON.stringify(projected, null, JSON_INDENT) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Failed to get recipe: ${message}` }], isError: true };
  }
}

/** Projects a full recipe to concise (+ optional includes) or returns it whole when detailed. */
function project(recipe: RecipeDetail, format: "concise" | "detailed", include: Includable[]): Record<string, unknown> {
  if (format === "detailed") return recipe as unknown as Record<string, unknown>;
  const source = recipe as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  for (const field of include) concise[field] = source[field];
  return concise;
}

/**
 * Registers the recipe_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_get",
    {
      title: "Get Recipe",
      description: "Fetch a recipe by slug. Concise by default; use response_format=detailed or include=[comments,nutrition] for more.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeGetHandler(client, args),
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/recipes/recipe-get.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/tools/recipes/recipe-get.ts src/tools/recipes/recipe-get.test.ts
git commit -m "feat(recipes): add recipe_get tool with concise/detailed projection"
```

---

### Task 4: Recipes toolset index + wire into the server

**Files:**
- Create: `src/tools/recipes/index.ts`
- Modify: `src/server.ts`

**Step 1: Write the toolset registrar** — `src/tools/recipes/index.ts`

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerRecipeGet } from "./recipe-get.js";
import { registerRecipeSearch } from "./recipe-search.js";

/**
 * Registers all recipe tools (the "recipes" toolset).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each tool handler
 */
export function registerRecipeTools(server: McpServer, client: MealieClient): void {
  registerRecipeSearch(server, client);
  registerRecipeGet(server, client);
}
```

**Step 2: Wire into `createServer`** — `src/server.ts`

Add the import:
```typescript
import { registerRecipeTools } from "./tools/recipes/index.js";
```

Add the registration call inside `createServer`, after `registerAboutTools(server, client);`:
```typescript
  registerRecipeTools(server, client);
```

**Step 3: Run the full gate**

Run: `npm run build && npm run test && npm run lint`
Expected: build OK; all tests pass; lint clean.

**Step 4: Commit**

```bash
git add src/tools/recipes/index.ts src/server.ts
git commit -m "feat(recipes): register the recipes toolset in the server"
```

---

### Task 5: End-to-end verification (both transports)

**Files:** Create (temporary): `_verify.mjs` (delete after; it must NOT be committed).

**Step 1: Write the verification script** — `_verify.mjs`

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { MEALIE_URL: "https://demo.mealie.io", MEALIE_API_TOKEN: "dummy", TRANSPORT: "stdio" },
});
const client = new Client({ name: "verify", version: "1.0.0" });
await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log("tools:", tools.join(", "));
const ok = ["get_about", "recipe_get", "recipe_search"].every((t) => tools.includes(t));
// demo /api/recipes is public — exercise a real search
const res = await client.callTool({ name: "recipe_search", arguments: { perPage: 2 } });
const body = JSON.parse(res.content[0].text);
console.log("search returned items:", Array.isArray(body.items), "total:", body.total);
await client.close();
process.exit(ok && Array.isArray(body.items) ? 0 : 1);
```

**Step 2: Build and run**

Run:
```bash
npm run build && node _verify.mjs; echo "exit=$?"; rm -f _verify.mjs
```
Expected: `tools: get_about, recipe_get, recipe_search`, `search returned items: true total: <n>`, `exit=0`. (If `dist` is gitignored the `.mjs` lives at repo root only transiently — confirm `git status` shows it untracked, then deleted.)

**Step 3: Confirm clean tree**

Run: `git status --short`
Expected: empty (no `_verify.mjs`, no `dist/`, no `node_modules/`).

---

### Task 6: Final gate + draft PR

**Step 1: Final quality gate**

Run: `npm run build && npm run test && npm run lint`
Expected: all green. Tests: pagination (5) + recipe_search (2) + recipe_get (4) + about (2) = 13 passing.

**Step 2: Push**

```bash
git push -u origin feature/recipe-read-tools
```

**Step 3: Create the draft PR into develop**

```bash
gh pr create --draft --base develop --head feature/recipe-read-tools \
  --title "feat: recipe read tools (recipe_search, recipe_get) + read foundation" \
  --body "$(cat <<'EOF'
## Summary
PR #2 of the full-coverage roadmap. Adds the read foundation and the first two consolidated, namespaced Recipes tools.

- `MealieClient`: query-param support on `get()` + `getPaginated()` normalizing Mealie's `PaginationBase`.
- `recipe_search` → `GET /api/recipes`: pagination + filters passthrough, concise items (id+slug+name) + meta.
- `recipe_get` → `GET /api/recipes/{slug}`: `response_format: concise|detailed` + `include: [comments,nutrition]` projection (no extra calls — Mealie returns them inline). Returns uuid+slug.
- New `src/tools/recipes/` toolset (one tool per file + `registerRecipeTools`), wired into `createServer`.

Conventions established here (design doc §1): namespacing, response_format, pagination, readOnly/idempotent/openWorld annotations. Writes, confirm-gate, and the read-only switch are deferred to PR #3 per the roadmap.

## Test plan
- [ ] `npm run build && npm run test && npm run lint` green (13 tests)
- [ ] Real SDK client over stdio lists get_about + recipe_search + recipe_get and a live `recipe_search` returns items
EOF
)"
```

---

## Out of scope (→ PR #3+)
Recipe writes (create/update/delete, import 8→1, bulk dispatcher), the `confirm` param + server-side read-only switch, image/assets/comments/timeline tools, and all other domains — per `docs/plans/2026-05-31-tool-design-and-coverage-roadmap.md` §3.
