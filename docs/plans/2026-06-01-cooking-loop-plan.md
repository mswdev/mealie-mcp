# Cooking Loop (PR #4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three default-enabled MCP tool domains — meal_plans (8 tools), shopping_lists (11), cookbooks (5) — covering all 35 Mealie household-cooking endpoints, building entirely on the PR #3 write foundation.

**Architecture:** Flat per-domain dirs under `src/tools/` (`cookbooks/`, `meal-plans/`, `shopping-lists/`), one tool per file + colocated `.test.ts` + one `index.ts` (read/write register split) + one concise-projection helper per domain. No new `MealieClient` methods, no multipart. Each domain is wired into `createServer` and the read-only e2e test at the end of its phase, keeping the quality gate green incrementally.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk`, `zod@^3`, Vitest, Biome, tsup. Generated types in `src/types/mealie.ts`.

---

## How To Read This Plan

The recipes domain already contains proven archetypes. To avoid duplicating ~1,400 lines of near-identical code, each task uses one of two forms:

- **Full code** — given verbatim for novel/tricky pieces (projection helpers, dispatchers, variant-collapse handlers, `index.ts`, `createServer` wiring, `server.test.ts` edits).
- **Spec + archetype** — for straightforward tools, the task gives the exact tool name/title/description, `inputSchema` (with field types), endpoint(s), request-body schema, response handling, annotations, and test cases, plus **the archetype file to copy structure from**. The engineer copies the archetype's shape and substitutes the spec.

**Archetype map** (read these once before starting):
- Plain read w/ pagination → `src/tools/recipes/core/recipe-search.ts`
- Plain read by id (concise\|detailed) → `src/tools/recipes/core/recipe-get.ts`
- Plain create (typed object back) → `src/tools/recipes/core/recipe-create.ts` (note: ours return the object directly — **no bare-slug re-fetch**)
- Update fetch-merge → `src/tools/recipes/core/recipe-update.ts`
- Destructive + confirm → `src/tools/recipes/core/recipe-delete.ts`
- Method-dispatcher → `src/tools/recipes/batch/recipe-bulk-actions.ts`
- Read + write-dispatcher pair → `src/tools/recipes/social/recipe-comments.ts` + `recipe-comment-write.ts`
- Projection helper → `src/tools/recipes/recipe-projection.ts`
- Domain register split → `src/tools/recipes/index.ts` + `src/tools/recipes/core/index.ts`

**Shared helpers (already exist, import them):** `../../result.js` (`jsonResult`, `errorResult`), `../../confirm.js` (`requireConfirmation`), `../../../client/MealieClient.js`, `../../../types/mealie.js` (`components`), `../../../client/pagination.js` (`PaginatedResult`).

**Universal conventions (apply to every tool):**
- Export `inputSchema` (raw zod shape object), an `<arg>Args` type with **explicit `| undefined`** on every optional field, an exported `<toolName>Handler(client, args)`, and a `register<Tool>(server, client)`. Handler takes a `Pick<MealieClient, ...>` for easy fakes.
- Tools never throw → `try/catch` returning `errorResult(error, "<tool_name>", "<prefix>")`. Confirm-gated handlers call `requireConfirmation` **before** the try.
- `openWorldHint: true` on every tool. `readOnlyHint: true` on reads; `idempotentHint: true` on PUT-style updates; `destructiveHint: true` + `confirm` on hard-deletes.
- Writes echo the affected resource via the domain projection (concise); deletes return `{ deleted: <id> }`.
- After every task: `npm run build && npm run typecheck && npm run test && npm run lint` must exit 0. Run `npx biome check --write src/` to auto-fix import ordering. Then commit.

**Build order:** cookbooks (simplest, proves plain-CRUD + single/bulk collapse) → meal_plans (variant-collapse create + sub-resource read/write-dispatcher) → shopping_lists (largest).

---

# Phase A — cookbooks (`src/tools/cookbooks/`)

### Task A0: Pre-flight — verify schema field names

**Step 1:** Confirm the exact schema shapes the code below depends on.

Run: `grep -nE '"(CreateCookBook|UpdateCookBook|ReadCookBook|CookBookPagination)":' src/types/mealie.ts`

Then `Read` each definition (use the line numbers). **Verify:** `CreateCookBook` has `name`, `description`, `slug?`, `position`, `public`, `queryFilterString` — **all but `slug` appear in the schema's `required` array (openapi-typescript keys optionality off `required`, not `default`), so the typed body literal in A4 MUST provide `description`, `public`, `position`, and `queryFilterString` or typecheck fails with TS2741**; `UpdateCookBook` adds `id`, `groupId`, `householdId`; `ReadCookBook` is the full output. No code/commit this task — verification only.

---

### Task A1: cookbook-projection.ts

**Files:** Create `src/tools/cookbooks/cookbook-projection.ts`, Test `src/tools/cookbooks/cookbook-projection.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { projectCookbook } from "./cookbook-projection.js";

describe("projectCookbook", () => {
  it("keeps concise fields and drops heavy ones", () => {
    const full = { id: "u1", slug: "weeknight", name: "Weeknight", description: "d", public: true,
      position: 2, queryFilterString: "tags.name = x", groupId: "g", householdId: "h", queryFilter: { huge: true } };

    const concise = projectCookbook(full as never, "concise");

    expect(concise).toEqual({ id: "u1", slug: "weeknight", name: "Weeknight", description: "d",
      public: true, position: 2, queryFilterString: "tags.name = x" });
    expect(concise).not.toHaveProperty("queryFilter");
  });

  it("returns the whole object when detailed", () => {
    const full = { id: "u1", name: "X", queryFilter: { huge: true } };
    expect(projectCookbook(full as never, "detailed")).toBe(full);
  });
});
```

**Step 2: Run to verify it fails** — `npx vitest run src/tools/cookbooks/cookbook-projection.test.ts` → FAIL (module not found).

**Step 3: Implement**

```typescript
import type { components } from "../../types/mealie.js";

/** The full cookbook object returned by Mealie's cookbook endpoints. */
export type CookbookDetail = components["schemas"]["ReadCookBook"];

/** Lightweight fields kept in the concise projection. */
const CONCISE_FIELDS = ["id", "slug", "name", "description", "public", "position", "queryFilterString"] as const;

/**
 * Projects a full cookbook to a concise view, or returns it whole when detailed.
 *
 * @param cookbook - The full ReadCookBook object
 * @param format - "concise" trims heavy fields (queryFilter, household); "detailed" returns everything
 * @returns The projected cookbook as a plain record
 */
export function projectCookbook(
  cookbook: CookbookDetail,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return cookbook as unknown as Record<string, unknown>;
  const source = cookbook as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}
```

**Step 4: Run** → PASS. **Step 5: Commit** `feat(cookbooks): add cookbook concise projection`.

---

### Task A2: cookbook_search

**Files:** Create `src/tools/cookbooks/cookbook-search.ts` + `.test.ts`. **Archetype:** `recipe-search.ts`.

**Spec:**
- Tool `cookbook_search`, title "Search Cookbooks", desc "Search and filter cookbooks with pagination. Returns concise summaries.".
- `inputSchema`: `queryFilter?` (string — Mealie filter expression; the endpoint has **no** full-text `search` param), `page?`, `perPage?` (max 100, default 20 via `DEFAULT_PER_PAGE`/`MAX_PER_PAGE` consts), `orderBy?`, `orderDirection?` (`z.enum(["asc","desc"])`). Mirror recipe-search's pagination block; drop the recipe-specific `categories/tags/tools/foods`. (Verified query params: `orderBy/orderByNullPosition/orderDirection/queryFilter/page/perPage` — no `search`.)
- Handler: `client.getPaginated<components["schemas"]["ReadCookBook"]>("/api/households/cookbooks", { ...args, perPage: args.perPage ?? DEFAULT_PER_PAGE })`. Project each item to `{ id, slug, name }` + pagination meta (copy recipe-search's `toConcise`).
- Annotations: `{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }`.

**Tests:** maps `perPage` default; passes `queryFilter`; returns `{items, total, page, perPage, totalPages}`; `isError` on client throw. Use the same fake-client shape as `recipe-search.test.ts`.

Steps: write failing test → run FAIL → implement → run PASS → `npx biome check --write src/` → commit `feat(cookbooks): add cookbook_search`.

---

### Task A3: cookbook_get

**Files:** Create `src/tools/cookbooks/cookbook-get.ts` + `.test.ts`. **Archetype:** `recipe-get.ts` (minus `include`).

**Spec:**
- Tool `cookbook_get`, title "Get Cookbook".
- `inputSchema`: `id: z.string().describe("Cookbook id or slug")`, `response_format: z.enum(["concise","detailed"]).optional()`.
- Handler: `const cb = await client.get<CookbookDetail>(\`/api/households/cookbooks/${args.id}\`)`; return `jsonResult(projectCookbook(cb, args.response_format ?? "concise"))`.
- Annotations: `{ readOnlyHint: true, openWorldHint: true }`.

**Tests:** concise projection (heavy field dropped); detailed returns all; `isError` on throw.

Commit `feat(cookbooks): add cookbook_get`.

---

### Task A4: cookbook_create

**Files:** Create `src/tools/cookbooks/cookbook-create.ts` + `.test.ts`. **Archetype:** `recipe-create.ts` (but return object directly — no re-fetch).

**Step 3 implementation (full — shows the required-with-default handling):**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js"; // NOTE: flat dir → ../../client (see below)
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type CookbookDetail, projectCookbook } from "./cookbook-projection.js";

type CreateClient = Pick<MealieClient, "post">;

/** Default ordering position Mealie assigns a new cookbook. */
const DEFAULT_COOKBOOK_POSITION = 1;

const inputSchema = {
  name: z.string().min(1).describe("Name of the new cookbook"),
  description: z.string().optional().describe("Optional description"),
  public: z.boolean().optional().describe("Whether the cookbook is publicly visible (default false)"),
  position: z.number().int().optional().describe("Ordering position (default 1)"),
  queryFilterString: z
    .string()
    .optional()
    .describe('Optional Mealie filter expression selecting recipes (e.g. \'tags.name CONTAINS ALL ["quick"]\')'),
};

type CreateArgs = {
  name: string;
  description?: string | undefined;
  public?: boolean | undefined;
  position?: number | undefined;
  queryFilterString?: string | undefined;
};

/**
 * Handles cookbook_create: creates a cookbook. Mealie's CreateCookBook marks
 * description/public/position/queryFilterString required-with-default (they are
 * in the schema's `required` array despite having defaults), so the handler
 * supplies safe defaults for any the caller omits.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name + optional fields)
 * @returns An MCP result with the concise created cookbook, or an error result
 */
export async function cookbookCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["CreateCookBook"] = {
      name: args.name,
      description: args.description ?? "",
      public: args.public ?? false,
      position: args.position ?? DEFAULT_COOKBOOK_POSITION,
      queryFilterString: args.queryFilterString ?? "",
    };
    const created = await client.post<CookbookDetail>("/api/households/cookbooks", body);
    return jsonResult(projectCookbook(created, "concise"));
  } catch (error) {
    return errorResult(error, "cookbook_create", "Failed to create cookbook");
  }
}

export function registerCookbookCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "cookbook_create",
    {
      title: "Create Cookbook",
      description:
        "Create a new cookbook. A cookbook is a saved filter over recipes (queryFilterString); name is required, other fields default.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => cookbookCreateHandler(client, args),
  );
}
```

> **Import-depth note:** files live at `src/tools/cookbooks/*.ts` (one level shallower than `recipes/core/*`). So shared imports are `../result.js`, `../confirm.js`, `../../client/MealieClient.js`, `../../types/mealie.js`. Fix the example's `MealieClient` path to `../../client/MealieClient.js`. **Verify every relative import compiles via `npm run typecheck`.**

**Tests:** posts `CreateCookBook` with defaults filled; returns concise; `isError` on throw. Commit `feat(cookbooks): add cookbook_create`.

---

### Task A5: cookbook_update (single + bulk collapse)

**Files:** Create `src/tools/cookbooks/cookbook-update.ts` + `.test.ts`.

**Step 1: Write failing tests** (cover both branches + the merge):

```typescript
import { describe, expect, it } from "vitest";
import { cookbookUpdateHandler } from "./cookbook-update.js";

function fakeClient(current: unknown) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> { calls.push({ method: "GET", path, body: undefined }); return current as T; },
    async put<T>(path: string, body: unknown): Promise<T> { calls.push({ method: "PUT", path, body }); return (Array.isArray(body) ? body : { ...(current as object), ...(body as object) }) as T; },
  };
}

describe("cookbookUpdateHandler", () => {
  it("single: fetch-merges changes and PUTs to the item path", async () => {
    const client = fakeClient({ id: "u1", slug: "s", name: "Old", description: "d", public: false, position: 1, queryFilterString: "" });

    const result = await cookbookUpdateHandler(client, { id: "u1", changes: { name: "New" } });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/households/cookbooks/u1" });
    expect(client.calls[1]).toMatchObject({ method: "PUT", path: "/api/households/cookbooks/u1" });
    expect((client.calls[1]?.body as { name: string }).name).toBe("New");
    expect(result.isError).toBeUndefined();
  });

  it("bulk: PUTs the items array to the collection path", async () => {
    const client = fakeClient(undefined);
    const items = [{ id: "u1", name: "A" }, { id: "u2", name: "B" }];

    await cookbookUpdateHandler(client, { items });

    expect(client.calls[0]).toMatchObject({ method: "PUT", path: "/api/households/cookbooks" });
    expect(client.calls[0]?.body).toEqual(items);
  });

  it("errors when neither id nor items is provided", async () => {
    const result = await cookbookUpdateHandler(fakeClient(undefined), {});
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type CookbookDetail, projectCookbook } from "./cookbook-projection.js";

type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  id: z.string().optional().describe("Cookbook id to update (single update; omit when using `items`)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change for the single update; merged onto the current cookbook"),
  items: z
    .array(z.record(z.unknown()))
    .optional()
    .describe("Full UpdateCookBook objects for a bulk update (each must include id, groupId, householdId)"),
};

type UpdateArgs = {
  id?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  items?: Record<string, unknown>[] | undefined;
};

/**
 * Handles cookbook_update: single (fetch-merge → PUT /{id}) or bulk
 * (PUT the items array to the collection). Single update sends CreateCookBook;
 * bulk sends UpdateCookBook[] (id/groupId/householdId per item).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id+changes for single, or items for bulk)
 * @returns An MCP result echoing the updated cookbook(s), or an error result
 */
export async function cookbookUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  if (args.items) return bulkUpdate(client, args.items);
  if (!args.id) {
    return { content: [{ type: "text", text: "cookbook_update: provide `id` (single) or `items` (bulk)" }], isError: true };
  }
  return singleUpdate(client, args.id, args.changes ?? {});
}

/** Fetch-merge a single cookbook then PUT to its item path. */
async function singleUpdate(
  client: UpdateClient,
  id: string,
  changes: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const path = `/api/households/cookbooks/${id}`;
    const current = await client.get<CookbookDetail>(path);
    const merged = { ...(current as Record<string, unknown>), ...changes };
    const updated = await client.put<CookbookDetail>(path, merged);
    return jsonResult(projectCookbook(updated, "concise"));
  } catch (error) {
    return errorResult(error, "cookbook_update", "Failed to update cookbook");
  }
}

/** Bulk-update via PUT to the collection (array of UpdateCookBook). */
async function bulkUpdate(
  client: UpdateClient,
  items: Record<string, unknown>[],
): Promise<CallToolResult> {
  try {
    await client.put("/api/households/cookbooks", items);
    return jsonResult({ updated: items.length });
  } catch (error) {
    return errorResult(error, "cookbook_update", "Failed to bulk-update cookbooks");
  }
}

export function registerCookbookUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "cookbook_update",
    {
      title: "Update Cookbook",
      description:
        "Update a cookbook. Single: pass `id` + `changes` (merged onto the current cookbook). Bulk: pass `items` (full UpdateCookBook objects with id/groupId/householdId).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => cookbookUpdateHandler(client, args),
  );
}
```

**Step 4: Run** → PASS. **Step 5: Commit** `feat(cookbooks): add cookbook_update (single + bulk)`.

---

### Task A6: cookbook_delete

**Files:** Create `src/tools/cookbooks/cookbook-delete.ts` + `.test.ts`. **Archetype:** `recipe-delete.ts`.

**Spec:** Tool `cookbook_delete`, title "Delete Cookbook". `inputSchema`: `id: z.string()`, `confirm: z.boolean().optional()`. Handler: `requireConfirmation(args.confirm, \`delete cookbook "${args.id}"\`)` before try; then `await client.delete(\`/api/households/cookbooks/${args.id}\`)`; `return jsonResult({ deleted: args.id })`. Annotations `{ readOnlyHint: false, destructiveHint: true, openWorldHint: true }`.

**Tests:** missing confirm → `isError`; confirm true → deletes + returns `{deleted}`; `isError` on throw. Commit `feat(cookbooks): add cookbook_delete`.

---

### Task A7: cookbooks/index.ts + wire into createServer

**Files:** Create `src/tools/cookbooks/index.ts`; Modify `src/server.ts`.

**Step 1: Implement `index.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerCookbookCreate } from "./cookbook-create.js";
import { registerCookbookDelete } from "./cookbook-delete.js";
import { registerCookbookGet } from "./cookbook-get.js";
import { registerCookbookSearch } from "./cookbook-search.js";
import { registerCookbookUpdate } from "./cookbook-update.js";

/** Options controlling which cookbook tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the cookbooks toolset. Reads always; writes only when not read-only.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerCookbookTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerCookbookSearch(server, client);
  registerCookbookGet(server, client);

  if (options.readOnly) return;
  registerCookbookCreate(server, client);
  registerCookbookUpdate(server, client);
  registerCookbookDelete(server, client);
}
```

**Step 2: Wire `createServer`** — in `src/server.ts`, add the import and a call after `registerRecipeTools(server, client, options);`:

```typescript
import { registerCookbookTools } from "./tools/cookbooks/index.js";
// ...inside createServer, after registerRecipeTools:
  registerCookbookTools(server, client, options);
```

**Step 3:** `npm run build && npm run typecheck` → PASS. Commit `feat(cookbooks): wire cookbooks toolset into createServer`.

---

### Task A8: bump read-only e2e + full gate (cookbooks)

**Files:** Modify `src/server.test.ts`.

**Step 1:** Add cookbook reads to `READ_TOOLS` (`"cookbook_search"`, `"cookbook_get"`) and cookbook writes to `WRITE_TOOLS` (`"cookbook_create"`, `"cookbook_update"`, `"cookbook_delete"`). Update both length assertions and their comments: read-only `toHaveLength(10)` → **`12`**; full `toHaveLength(24)` → **`29`**.

**Step 2: Run** `npx vitest run src/server.test.ts` → PASS (asserts no write leaks under read-only).

**Step 3: Full gate** `npm run build && npm run typecheck && npm run test && npm run lint` → exit 0. Commit `test(server): cover cookbook tools in read-only e2e (12 RO / 29 full)`.

---

# Phase B — meal_plans (`src/tools/meal-plans/`)

### Task B0: Pre-flight — verify enums + entry schemas

Run: `grep -nE '"(CreatePlanEntry|UpdatePlanEntry|ReadPlanEntry|CreateRandomEntry|PlanRulesCreate|PlanRulesOut|PlanEntryType|PlanRulesType|PlanRulesDay)":' src/types/mealie.ts`

`Read` each. **Record the exact enum members** for `PlanEntryType` (e.g. `breakfast|lunch|dinner|side`), `PlanRulesType` (same set **plus `unset`**), `PlanRulesDay` (`monday`…`sunday` plus `unset`) — the zod `z.enum([...])` in B6/B9 **must match these exactly** or the typed body assignment fails typecheck. Confirm `ReadPlanEntry.id` is a **number** and `PlanRulesOut.id` is a **string (uuid)**. No commit.

---

### Task B1: mealplan-projection.ts

**Files:** Create `src/tools/meal-plans/mealplan-projection.ts` + `.test.ts`.

**Implementation:**

```typescript
import type { components } from "../../types/mealie.js";

/** A meal-plan entry as returned by Mealie. */
export type PlanEntry = components["schemas"]["ReadPlanEntry"];
/** A meal-plan rule as returned by Mealie. */
export type PlanRule = components["schemas"]["PlanRulesOut"];

const ENTRY_CONCISE = ["id", "date", "entryType", "title", "text", "recipeId"] as const;

/**
 * Projects a meal-plan entry to a concise view (adds a recipe {id,slug,name}
 * stub when present), or returns it whole when detailed.
 *
 * @param entry - The full ReadPlanEntry
 * @param format - "concise" trims to scheduling fields; "detailed" returns everything
 * @returns The projected entry as a plain record
 */
export function projectPlanEntry(
  entry: PlanEntry,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return entry as unknown as Record<string, unknown>;
  const source = entry as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of ENTRY_CONCISE) concise[field] = source[field];
  const recipe = source.recipe as { id?: string; slug?: string; name?: string } | null | undefined;
  if (recipe) concise.recipe = { id: recipe.id, slug: recipe.slug, name: recipe.name };
  return concise;
}
```

**Tests:** concise keeps scheduling fields + recipe stub (when present), drops nothing-extra; detailed returns whole. Commit `feat(meal-plans): add meal-plan entry projection`.

---

### Task B2: mealplan_search

**Files:** Create `mealplan-search.ts` + `.test.ts`. **Archetype:** `recipe-search.ts`.

**Spec:** Tool `mealplan_search`, title "Search Meal Plans". `inputSchema`: `startDate?` (string `YYYY-MM-DD`, maps to query `start_date`), `endDate?` (→ `end_date`), `page?`, `perPage?`, `orderBy?`, `orderDirection?`. Handler: `client.getPaginated<PlanEntry>("/api/households/mealplans", { start_date: args.startDate, end_date: args.endDate, page: args.page, perPage: args.perPage ?? DEFAULT_PER_PAGE, orderBy: args.orderBy, orderDirection: args.orderDirection })`. Return concise items `{ id, date, entryType, title, recipeId }` + pagination meta. Annotations `{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }`.

**Tests:** maps `startDate`→`start_date`; default perPage; pagination meta; `isError`. Commit `feat(meal-plans): add mealplan_search`.

---

### Task B3: mealplan_get

**Files:** Create `mealplan-get.ts` + `.test.ts`. **Archetype:** `recipe-get.ts`.

**Spec:** Tool `mealplan_get`. `inputSchema`: `planId: z.number().int().positive().describe("Meal plan entry id (integer)")`, `response_format?`. Handler: `client.get<PlanEntry>(\`/api/households/mealplans/${args.planId}\`)` → `projectPlanEntry(entry, args.response_format ?? "concise")`. Annotations `{ readOnlyHint: true, openWorldHint: true }`.

**Tests:** numeric id in path; concise vs detailed; `isError`. Commit `feat(meal-plans): add mealplan_get`.

---

### Task B4: mealplan_today

**Files:** Create `mealplan-today.ts` + `.test.ts`.

**Spec:** Tool `mealplan_today`, title "Today's Meals", desc "List meals planned for today.". `inputSchema`: `{}` (no args). Handler: `return jsonResult(await client.get("/api/households/mealplans/today"))` inside try/catch (the endpoint body is typed `unknown` upstream → return verbatim). Annotations `{ readOnlyHint: true, openWorldHint: true }`.

**Tests:** GETs the today path and returns the body as-is; `isError` on throw. Commit `feat(meal-plans): add mealplan_today`.

---

### Task B5: mealplan_rules (read dispatcher)

**Files:** Create `mealplan-rules.ts` + `.test.ts`. **Archetype:** `recipe-comments.ts`.

**Spec:** Tool `mealplan_rules`, title "Read Meal Plan Rules". `inputSchema`: `action: z.enum(["list","get"]).optional()`, `ruleId?` (string uuid, for `get`), `page?`, `perPage?`. Handler routes: `get` (require `ruleId`, else `missing("ruleId")`) → `client.get(\`/api/households/mealplans/rules/${args.ruleId}\`)`; default `list` → `client.getPaginated("/api/households/mealplans/rules", { page, perPage: perPage ?? DEFAULT_PER_PAGE })`. Copy the `missing(field)` helper from recipe-comments. Annotations `{ readOnlyHint: true, openWorldHint: true }`. Mention `mealplan_rule_write` in the description.

**Tests:** list paginated; get by id; missing ruleId → `isError`; `isError` on throw. Commit `feat(meal-plans): add mealplan_rules (read)`.

---

### Task B6: mealplan_create (entry + random collapse)

**Files:** Create `mealplan-create.ts` + `.test.ts`.

**Step 1: Failing tests** (both modes):

```typescript
import { describe, expect, it } from "vitest";
import { mealplanCreateHandler } from "./mealplan-create.js";

function fakeClient() {
  const calls: { path: string; body: unknown }[] = [];
  return { calls, async post<T>(path: string, body: unknown): Promise<T> { calls.push({ path, body }); return { id: 1, date: "2026-06-02", entryType: "dinner", title: "", text: "" } as T; } };
}

describe("mealplanCreateHandler", () => {
  it("entry mode posts CreatePlanEntry to /mealplans", async () => {
    const client = fakeClient();
    await mealplanCreateHandler(client, { mode: "entry", date: "2026-06-02", entryType: "dinner", recipeId: "r1" });
    expect(client.calls[0]?.path).toBe("/api/households/mealplans");
    expect(client.calls[0]?.body).toMatchObject({ date: "2026-06-02", entryType: "dinner", recipeId: "r1" });
  });

  it("random mode posts CreateRandomEntry to /mealplans/random", async () => {
    const client = fakeClient();
    await mealplanCreateHandler(client, { mode: "random", date: "2026-06-02", entryType: "dinner" });
    expect(client.calls[0]?.path).toBe("/api/households/mealplans/random");
    expect(client.calls[0]?.body).toEqual({ date: "2026-06-02", entryType: "dinner" });
  });
});
```

**Step 3: Implement** (use the exact `PlanEntryType` enum members confirmed in B0):

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type PlanEntry, projectPlanEntry } from "./mealplan-projection.js";

type CreateClient = Pick<MealieClient, "post">;

// Must match components["schemas"]["PlanEntryType"] exactly (verified in B0).
const ENTRY_TYPES = ["breakfast", "lunch", "dinner", "side"] as const;

const inputSchema = {
  mode: z.enum(["entry", "random"]).optional().describe("entry (explicit, default) or random (Mealie picks a recipe per household rules)"),
  date: z.string().describe("Date for the meal (YYYY-MM-DD)"),
  entryType: z.enum(ENTRY_TYPES).describe("Meal slot"),
  title: z.string().optional().describe("Entry title (entry mode; defaults from recipe)"),
  text: z.string().optional().describe("Free-text note (entry mode)"),
  recipeId: z.string().optional().describe("Recipe UUID to schedule (entry mode)"),
};

type CreateArgs = {
  mode?: "entry" | "random" | undefined;
  date: string;
  entryType: (typeof ENTRY_TYPES)[number];
  title?: string | undefined;
  text?: string | undefined;
  recipeId?: string | undefined;
};

/**
 * Handles mealplan_create: schedules an explicit entry, or a random recipe that
 * respects the household's meal-plan rules. Both return a ReadPlanEntry.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (mode + scheduling fields)
 * @returns An MCP result with the concise created entry, or an error result
 */
export async function mealplanCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const created = args.mode === "random" ? await createRandom(client, args) : await createEntry(client, args);
    return jsonResult(projectPlanEntry(created, "concise"));
  } catch (error) {
    return errorResult(error, "mealplan_create", "Failed to create meal plan entry");
  }
}

/** POST an explicit CreatePlanEntry. */
async function createEntry(client: CreateClient, args: CreateArgs): Promise<PlanEntry> {
  const body: components["schemas"]["CreatePlanEntry"] = {
    date: args.date,
    entryType: args.entryType,
    title: args.title ?? "",
    text: args.text ?? "",
    ...(args.recipeId ? { recipeId: args.recipeId } : {}),
  };
  return client.post<PlanEntry>("/api/households/mealplans", body);
}

/** POST a CreateRandomEntry (date + entryType only). */
async function createRandom(client: CreateClient, args: CreateArgs): Promise<PlanEntry> {
  const body: components["schemas"]["CreateRandomEntry"] = { date: args.date, entryType: args.entryType };
  return client.post<PlanEntry>("/api/households/mealplans/random", body);
}

export function registerMealplanCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_create",
    {
      title: "Create Meal Plan Entry",
      description:
        "Add a meal to the plan. mode=entry schedules a specific recipe/title; mode=random lets Mealie pick a recipe matching the household's meal-plan rules for that day/slot.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => mealplanCreateHandler(client, args),
  );
}
```

> Note `recipeId` is conditionally spread (not set to `undefined`) to satisfy `exactOptionalPropertyTypes`. Apply this idiom wherever an optional body field may be absent.

**Step 4: Run** → PASS. **Step 5: Commit** `feat(meal-plans): add mealplan_create (entry + random)`.

---

### Task B7: mealplan_update (fetch-merge)

**Files:** Create `mealplan-update.ts` + `.test.ts`. **Archetype:** `recipe-update.ts`.

**Spec:** Tool `mealplan_update`. `inputSchema`: `planId: z.number().int().positive()`, `changes: z.record(z.unknown())`. Handler (fetch-merge, drop read-only-only fields): GET `ReadPlanEntry` at `/api/households/mealplans/{planId}`, build merged then **strip `householdId` and `recipe`** before PUT (UpdatePlanEntry omits them; use `delete` rather than a destructuring discard, which would leave unused bindings that can trip Biome's `noUnusedVariables`):

```typescript
const path = `/api/households/mealplans/${args.planId}`;
const current = await client.get<PlanEntry>(path);
const merged = { ...(current as Record<string, unknown>), ...args.changes };
delete merged.householdId;
delete merged.recipe;
await client.put(path, merged);
const updated = await client.get<PlanEntry>(path);
return jsonResult(projectPlanEntry(updated, "concise"));
```

Annotations `{ readOnlyHint: false, idempotentHint: true, openWorldHint: true }`.

**Tests:** merges changes; strips `householdId`/`recipe` from the PUT body; re-fetches; `isError`. Commit `feat(meal-plans): add mealplan_update`.

---

### Task B8: mealplan_delete

**Files:** Create `mealplan-delete.ts` + `.test.ts`. **Archetype:** `recipe-delete.ts`.

**Spec:** Tool `mealplan_delete`. `inputSchema`: `planId: z.number().int().positive()`, `confirm?`. `requireConfirmation(args.confirm, \`delete meal plan entry ${args.planId}\`)`; `client.delete(\`/api/households/mealplans/${args.planId}\`)`; `jsonResult({ deleted: args.planId })`. Destructive annotations.

**Tests:** missing confirm → `isError`; confirmed deletes; `isError`. Commit `feat(meal-plans): add mealplan_delete`.

---

### Task B9: mealplan_rule_write (write-dispatcher)

**Files:** Create `mealplan-rule-write.ts` + `.test.ts`. **Archetype:** `recipe-comment-write.ts`.

**Spec:** Tool `mealplan_rule_write`, title "Write Meal Plan Rule". `inputSchema`: `action: z.enum(["create","update","delete"])`, `ruleId?` (uuid, update/delete), `day?` (`z.enum(PLAN_RULES_DAY)` — exact members from B0), `entryType?` (`z.enum(PLAN_RULES_TYPE)` — includes `unset`), `queryFilterString?`, `confirm?` (delete). Routing mirrors recipe-comment-write:
- `create` → `client.post("/api/households/mealplans/rules", body)` where `body: components["schemas"]["PlanRulesCreate"] = { day, entryType, queryFilterString: queryFilterString ?? "" }` (require `day` + `entryType`, else `missing`).
- `update` → require `ruleId`; `client.put(\`.../rules/${ruleId}\`, body)` (same PlanRulesCreate shape).
- `delete` → `requireConfirmation` then `client.delete(\`.../rules/${ruleId}\`)` → `{ deleted: ruleId }`.

Echo created/updated rule via `jsonResult` (PlanRulesOut returned directly). Destructive annotations.

**Tests:** create posts PlanRulesCreate; update puts to `/rules/{id}`; delete unconfirmed → `isError`, confirmed deletes; missing-field guards. Commit `feat(meal-plans): add mealplan_rule_write`.

---

### Task B10: meal-plans/index.ts + wire + e2e bump

**Files:** Create `src/tools/meal-plans/index.ts`; Modify `src/server.ts`, `src/server.test.ts`.

**index.ts** (mirror cookbooks/index.ts): `registerMealPlanTools(server, client, options)` — reads always (`registerMealplanSearch`, `registerMealplanGet`, `registerMealplanToday`, `registerMealplanRules`), then if `!readOnly` the writes (`registerMealplanCreate`, `registerMealplanUpdate`, `registerMealplanDelete`, `registerMealplanRuleWrite`).

**server.ts:** import + call `registerMealPlanTools(server, client, options);`.

**server.test.ts:** add 4 reads (`mealplan_search`, `mealplan_get`, `mealplan_today`, `mealplan_rules`) to `READ_TOOLS`; 4 writes (`mealplan_create`, `mealplan_update`, `mealplan_delete`, `mealplan_rule_write`) to `WRITE_TOOLS`; bump read-only `12 → 16`, full `29 → 37`.

**Gate:** full `build && typecheck && test && lint` → 0. Commits: `feat(meal-plans): wire meal-plans toolset into createServer` + `test(server): cover meal-plan tools in read-only e2e (16 RO / 37 full)`.

---

# Phase C — shopping_lists (`src/tools/shopping-lists/`)

### Task C0: Pre-flight — verify shopping schemas

Run: `grep -nE '"(ShoppingListCreate|ShoppingListUpdate|ShoppingListOut|ShoppingListSummary|ShoppingListItemCreate|ShoppingListItemUpdate|ShoppingListItemUpdateBulk|ShoppingListItemsCollectionOut|ShoppingListAddRecipeParamsBulk|ShoppingListAddRecipeParams|ShoppingListRemoveRecipeParams|ShoppingListMultiPurposeLabelUpdate|SuccessResponse)":' src/types/mealie.ts`

`Read` the tricky ones. **Confirm:** `ShoppingListItemCreate` requires `shoppingListId` + `display` (no default) — handler must supply both; bulk/single item writes all return `ShoppingListItemsCollectionOut` (`createdItems`/`updatedItems`/`deletedItems`); `ShoppingListItemOut-Output` is the read item type (note the hyphen — use bracket notation). No commit.

---

### Task C1: shopping-projection.ts

**Files:** Create `src/tools/shopping-lists/shopping-projection.ts` + `.test.ts`.

**Implementation:**

```typescript
import type { components } from "../../types/mealie.js";

/** Full shopping list (with items, recipe refs, label settings). */
export type ShoppingList = components["schemas"]["ShoppingListOut"];
/** A single shopping list item. */
export type ShoppingItem = components["schemas"]["ShoppingListItemOut-Output"];
/** The container returned by bulk/single item writes. */
export type ItemsCollection = components["schemas"]["ShoppingListItemsCollectionOut"];

const ITEM_CONCISE = ["id", "display", "quantity", "checked", "note", "foodId", "unitId", "labelId"] as const;

/** Projects one shopping item to a concise view. */
function projectItem(item: Record<string, unknown>): Record<string, unknown> {
  const concise: Record<string, unknown> = {};
  for (const field of ITEM_CONCISE) concise[field] = item[field];
  return concise;
}

/**
 * Projects a full shopping list to a concise view (id, name, counts, concise
 * items + recipe refs), or returns it whole when detailed.
 *
 * @param list - The full ShoppingListOut
 * @param format - "concise" trims items; "detailed" returns everything
 * @returns The projected list as a plain record
 */
export function projectShoppingList(
  list: ShoppingList,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return list as unknown as Record<string, unknown>;
  const source = list as unknown as Record<string, unknown>;
  const items = (source.listItems as Record<string, unknown>[] | undefined) ?? [];
  const refs = (source.recipeReferences as { recipeId?: string }[] | undefined) ?? [];
  return {
    id: source.id,
    name: source.name,
    itemCount: items.length,
    items: items.map(projectItem),
    recipeReferences: refs.map((r) => ({ recipeId: r.recipeId })),
  };
}

/** Summarizes an item-write collection into concise counts + affected ids. */
export function projectItemsCollection(collection: ItemsCollection): Record<string, unknown> {
  const source = collection as unknown as Record<string, Record<string, unknown>[]>;
  const ids = (group: string) => (source[group] ?? []).map((i) => i.id);
  return {
    created: ids("createdItems"),
    updated: ids("updatedItems"),
    deleted: ids("deletedItems"),
  };
}
```

**Tests:** list concise → id/name/itemCount/items(concise)/refs; detailed → whole; collection → created/updated/deleted id arrays. Commit `feat(shopping-lists): add shopping projections`.

---

### Task C2: shopping_list_search

**Files:** Create `shopping-list-search.ts` + `.test.ts`. **Archetype:** `recipe-search.ts`.

**Spec:** Tool `shopping_list_search`. `inputSchema`: `page?`, `perPage?`, `orderBy?`, `orderDirection?` (no full-text `search` — Mealie list endpoint uses `queryFilter`; expose `queryFilter?: z.string()` passthrough). Handler `getPaginated<components["schemas"]["ShoppingListSummary"]>("/api/households/shopping/lists", {...})`; concise items `{ id, name }` + meta. Read annotations.

**Tests:** default perPage; pagination meta; `isError`. Commit `feat(shopping-lists): add shopping_list_search`.

---

### Task C3: shopping_list_get (aggregated)

**Files:** Create `shopping-list-get.ts` + `.test.ts`. **Archetype:** `recipe-get.ts`.

**Spec:** Tool `shopping_list_get`, desc note it bundles items + recipe refs + label settings. `inputSchema`: `listId: z.string()`, `response_format?`. Handler `client.get<ShoppingList>(\`/api/households/shopping/lists/${args.listId}\`)` → `projectShoppingList(list, fmt)`. Read annotations.

**Tests:** concise (itemCount + concise items) vs detailed; `isError`. Commit `feat(shopping-lists): add shopping_list_get`.

---

### Task C4: shopping_item_get (read dispatcher)

**Files:** Create `shopping-item-get.ts` + `.test.ts`. **Archetype:** `recipe-comments.ts`.

**Spec:** Tool `shopping_item_get`, title "Read Shopping Items". `inputSchema`: `action: z.enum(["list","get"]).optional()`, `itemId?`, `page?`, `perPage?`, `queryFilter?`. `get` (require itemId) → `client.get(\`/api/households/shopping/items/${itemId}\`)`; default `list` → `getPaginated("/api/households/shopping/items", {...})`. Read annotations.

**Tests:** list; get by id; missing itemId → `isError`. Commit `feat(shopping-lists): add shopping_item_get`.

---

### Task C5: shopping_list_create

**Files:** Create `shopping-list-create.ts` + `.test.ts`. **Archetype:** `recipe-create.ts` (object back).

**Spec:** Tool `shopping_list_create`. `inputSchema`: `name: z.string().min(1)`. Handler `body: components["schemas"]["ShoppingListCreate"] = { name: args.name }`; `client.post<ShoppingList>("/api/households/shopping/lists", body)` → `projectShoppingList(created, "concise")`. Write annotations (non-destructive).

**Tests:** posts name; concise back; `isError`. Commit `feat(shopping-lists): add shopping_list_create`.

---

### Task C6: shopping_list_update (fetch-merge)

**Files:** Create `shopping-list-update.ts` + `.test.ts`. **Archetype:** `recipe-update.ts`.

**Spec:** Tool `shopping_list_update`. `inputSchema`: `listId: z.string()`, `changes: z.record(z.unknown())`. Fetch-merge: GET `ShoppingListOut` → `merged = { ...current, ...changes }` → `client.put(path, merged)` (ShoppingListUpdate requires `id`/`groupId`/`userId`/`listItems`, all present in the fetched object, so sending the full merged object preserves items) → re-GET → `projectShoppingList(updated, "concise")`. `idempotentHint`.

**Tests:** merges changes; sends full object (listItems preserved); re-fetches; `isError`. Commit `feat(shopping-lists): add shopping_list_update`.

---

### Task C7: shopping_list_delete

**Files:** Create `shopping-list-delete.ts` + `.test.ts`. **Archetype:** `recipe-delete.ts`.

**Spec:** Tool `shopping_list_delete`. `inputSchema`: `listId`, `confirm?`. `requireConfirmation` → `client.delete(\`/api/households/shopping/lists/${listId}\`)` → `{ deleted: listId }`. Destructive.

**Tests:** unconfirmed → `isError`; confirmed deletes; `isError`. Commit `feat(shopping-lists): add shopping_list_delete`.

---

### Task C8: shopping_list_label_settings

**Files:** Create `shopping-list-label-settings.ts` + `.test.ts`.

**Spec:** Tool `shopping_list_label_settings`, title "Update Shopping List Labels", desc "Reorder/assign the label settings of a shopping list (submit the full label list).". `inputSchema`: `listId: z.string()`, `labels: z.array(z.record(z.unknown())).describe("Full ShoppingListMultiPurposeLabelUpdate objects (id, shoppingListId, labelId, position)")`. Handler: `const updated = await client.put<ShoppingList>(\`/api/households/shopping/lists/${args.listId}/label-settings\`, args.labels)` → `projectShoppingList(updated, "concise")`. Write annotations (`idempotentHint: true`, non-destructive).

**Tests:** PUTs the labels array to the label-settings path; returns concise; `isError`. Commit `feat(shopping-lists): add shopping_list_label_settings`.

---

### Task C9: shopping_list_recipe_references (dispatcher)

**Files:** Create `shopping-list-recipe-references.ts` + `.test.ts`.

**Step 1: Failing tests** (the three asymmetric paths):

```typescript
import { describe, expect, it } from "vitest";
import { recipeReferencesHandler } from "./shopping-list-recipe-references.js";

function fakeClient() {
  const calls: { path: string; body: unknown }[] = [];
  return { calls, async post<T>(path: string, body: unknown): Promise<T> { calls.push({ path, body }); return { id: "L", name: "n", listItems: [], recipeReferences: [] } as T; } };
}

describe("recipeReferencesHandler", () => {
  it("add → POST /recipe with a bulk params array", async () => {
    const client = fakeClient();
    await recipeReferencesHandler(client, { action: "add", listId: "L", recipeId: "r1", quantity: 2 });
    expect(client.calls[0]?.path).toBe("/api/households/shopping/lists/L/recipe");
    expect(client.calls[0]?.body).toEqual([{ recipeId: "r1", recipeIncrementQuantity: 2 }]);
  });

  it("add_by_recipe → POST /recipe/{recipeId} (deprecated path form)", async () => {
    const client = fakeClient();
    await recipeReferencesHandler(client, { action: "add_by_recipe", listId: "L", recipeId: "r1" });
    expect(client.calls[0]?.path).toBe("/api/households/shopping/lists/L/recipe/r1");
  });

  it("remove → POST /recipe/{recipeId}/delete (NOT a DELETE verb)", async () => {
    const client = fakeClient();
    await recipeReferencesHandler(client, { action: "remove", listId: "L", recipeId: "r1" });
    expect(client.calls[0]?.path).toBe("/api/households/shopping/lists/L/recipe/r1/delete");
    expect(client.calls[0]?.body).toEqual({ recipeDecrementQuantity: 1 });
  });

  it("errors when recipeId is missing", async () => {
    const result = await recipeReferencesHandler(fakeClient(), { action: "add", listId: "L" });
    expect(result.isError).toBe(true);
  });
});
```

**Step 3: Implement**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type ShoppingList, projectShoppingList } from "./shopping-projection.js";

type RefClient = Pick<MealieClient, "post">;

/** Default quantity step for add/remove when the caller omits it. */
const DEFAULT_QUANTITY = 1;

const inputSchema = {
  action: z.enum(["add", "add_by_recipe", "remove"]).describe("add (bulk endpoint), add_by_recipe (deprecated path form), or remove"),
  listId: z.string().describe("Shopping list id"),
  recipeId: z.string().optional().describe("Recipe UUID to add/remove"),
  quantity: z.number().positive().optional().describe("Quantity to add or remove (default 1)"),
};

type RefArgs = {
  action: "add" | "add_by_recipe" | "remove";
  listId: string;
  recipeId?: string | undefined;
  quantity?: number | undefined;
};

/**
 * Handles shopping_list_recipe_references: add a recipe's ingredients to a list
 * (bulk or deprecated single endpoint), or remove them. Remove is a POST to a
 * `/delete` path, not a DELETE verb. All variants return the updated list.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action, listId, recipeId, quantity)
 * @returns An MCP result with the concise updated list, or an error result
 */
export async function recipeReferencesHandler(
  client: RefClient,
  args: RefArgs,
): Promise<CallToolResult> {
  if (!args.recipeId) {
    return { content: [{ type: "text", text: 'shopping_list_recipe_references: action requires "recipeId"' }], isError: true };
  }
  try {
    const updated = await dispatch(client, args, args.recipeId);
    return jsonResult(projectShoppingList(updated, "concise"));
  } catch (error) {
    return errorResult(error, "shopping_list_recipe_references", "Failed to update recipe references");
  }
}

/** Routes to the add (bulk), add_by_recipe (deprecated), or remove endpoint. */
async function dispatch(client: RefClient, args: RefArgs, recipeId: string): Promise<ShoppingList> {
  const base = `/api/households/shopping/lists/${args.listId}/recipe`;
  if (args.action === "remove") {
    const body: components["schemas"]["ShoppingListRemoveRecipeParams"] = {
      recipeDecrementQuantity: args.quantity ?? DEFAULT_QUANTITY,
    };
    return client.post<ShoppingList>(`${base}/${recipeId}/delete`, body);
  }
  if (args.action === "add_by_recipe") {
    const body: components["schemas"]["ShoppingListAddRecipeParams"] = {
      recipeIncrementQuantity: args.quantity ?? DEFAULT_QUANTITY,
    };
    return client.post<ShoppingList>(`${base}/${recipeId}`, body);
  }
  const body: components["schemas"]["ShoppingListAddRecipeParamsBulk"][] = [
    { recipeId, recipeIncrementQuantity: args.quantity ?? DEFAULT_QUANTITY },
  ];
  return client.post<ShoppingList>(base, body);
}

export function registerRecipeReferences(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_recipe_references",
    {
      title: "Shopping List Recipe References",
      description:
        "Add a recipe's ingredients to a shopping list (action=add) or remove them (action=remove). add_by_recipe is the deprecated single-path form. Returns the updated list.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => recipeReferencesHandler(client, args),
  );
}
```

**Step 4: Run** → PASS. **Step 5: Commit** `feat(shopping-lists): add shopping_list_recipe_references`.

---

### Task C10: shopping_item_create (single + bulk)

**Files:** Create `shopping-item-create.ts` + `.test.ts`.

**Spec:** Tool `shopping_item_create`. `inputSchema`: `item?: z.record(z.unknown())` (single) **or** `items?: z.array(z.record(z.unknown()))` (bulk); both objects must carry `shoppingListId` + `display` (+ optional food/unit/quantity/note/checked/position). Since `z.record` is freeform (no fetch-merge to lean on for a create), the **tool description must explicitly name the required fields** (`shoppingListId`, `display`) and the common optional ones, so the calling agent knows the shape — e.g. "Each item requires `shoppingListId` and `display` (the rendered text); optionally `quantity`, `note`, `foodId`, `unitId`, `labelId`, `checked`, `position`." Handler:
- if `items` → `client.post<ItemsCollection>("/api/households/shopping/items/create-bulk", items)`.
- else if `item` → `client.post<ItemsCollection>("/api/households/shopping/items", item)`.
- else → `isError` "provide `item` or `items`".
- Return `jsonResult(projectItemsCollection(collection))`.

Type the bodies as `components["schemas"]["ShoppingListItemCreate"]` / `[...][]`. Non-destructive write annotations.

**Tests:** single → POST `/items`; bulk → POST `/items/create-bulk`; neither → `isError`; collection summary returned. Commit `feat(shopping-lists): add shopping_item_create`.

---

### Task C11: shopping_item_update (single fetch-merge + bulk)

**Files:** Create `shopping-item-update.ts` + `.test.ts`.

**Spec:** Tool `shopping_item_update`. `inputSchema`: `itemId?` + `changes?` (single) **or** `items?` (bulk `ShoppingListItemUpdateBulk[]`, each with `id`). Handler:
- if `items` → `client.put<ItemsCollection>("/api/households/shopping/items", items)`.
- else if `itemId` → fetch-merge: GET `ShoppingItem` at `/items/{itemId}` → `merged = {...current, ...changes}` → `client.put<ItemsCollection>(\`/items/${itemId}\`, merged)`.
- else → `isError`.
- Return `projectItemsCollection`. `idempotentHint: true`.

**Tests:** single fetch-merge → PUT `/items/{id}`; bulk → PUT `/items`; neither → `isError`. Commit `feat(shopping-lists): add shopping_item_update`.

---

### Task C12: shopping_item_delete (single + bulk)

**Files:** Create `shopping-item-delete.ts` + `.test.ts`.

**Spec:** Tool `shopping_item_delete`. `inputSchema`: `itemId?` (single) **or** `itemIds?: z.array(z.string())` (bulk), `confirm?`. Destructive → `requireConfirmation(args.confirm, "delete shopping item(s)")` before try. Handler:
- if `itemIds` → `client.delete("/api/households/shopping/items", { ids: itemIds })` (query-array; `buildQueryString` repeats the key) → `{ deleted: itemIds }`.
- else if `itemId` → `client.delete(\`/api/households/shopping/items/${itemId}\`)` → `{ deleted: [itemId] }`.
- else → `isError`.

Destructive annotations.

**Tests:** unconfirmed → `isError`; single path delete; bulk passes `ids` query; neither → `isError`. Commit `feat(shopping-lists): add shopping_item_delete`.

---

### Task C13: shopping-lists/index.ts + wire + final e2e bump

**Files:** Create `src/tools/shopping-lists/index.ts`; Modify `src/server.ts`, `src/server.test.ts`.

**index.ts:** `registerShoppingTools(server, client, options)` — reads always (`registerShoppingListSearch`, `registerShoppingListGet`, `registerShoppingItemGet`), then if `!readOnly` the 8 writes (`registerShoppingListCreate`, `registerShoppingListUpdate`, `registerShoppingListDelete`, `registerShoppingListLabelSettings`, `registerRecipeReferences`, `registerShoppingItemCreate`, `registerShoppingItemUpdate`, `registerShoppingItemDelete`).

**server.ts:** import + call `registerShoppingTools(server, client, options);`.

**server.test.ts:** add the 3 reads + 8 writes to the arrays; bump read-only `16 → 19`, full `37 → 48`. Update the comments to reflect final counts.

**Gate:** full `build && typecheck && test && lint` → 0. Commits: `feat(shopping-lists): wire shopping toolset into createServer` + `test(server): cover shopping tools in read-only e2e (19 RO / 48 full)`.

---

# Phase D — Finish

### Task D1: README documentation

**Files:** Modify `README.md`.

Document the three new default-enabled domains: a tool table per domain (name → one-liner), the `/api/households/` nesting note (grouped by semantic domain), and that meal-plan entry ids are integers. Mention writes are stripped under `MEALIE_READ_ONLY`. Mirror the existing recipes section's structure. Commit `docs(readme): document meal-plan, shopping-list, and cookbook tools`.

### Task D2: Full gate + real-stdio verification

Run the full gate one final time. Then verify over real stdio (carried-forward check): start the built server as a subprocess and `tools/list`, asserting the new tool names appear (full) / writes vanish (`MEALIE_READ_ONLY=true`), plus a real `get_about` call. Capture output. **Do not claim pass without the command output.** No new commit unless a fix is needed.

### Task D3: Adversarial multi-lens review

Run a dynamic review **workflow** (separate tool call) over the branch diff: lenses = correctness/contract (body shapes vs `components` schemas), conventions (annotations, confirm gate, projection, naming, file-org caps), security (confirm gate enforced on all 5 deletes; read-only strips all 15 writes), and adversarial verification of each finding. Apply confirmed fixes via TDD, re-run the gate, commit fixes.

### Task D4: Push + draft PR

Push `feature/cooking-loop`; open a **draft** PR into `develop` (`gh pr create --draft --base develop`). PR body: what changed, the 24-tool table, affected files, the verified shape surprises, and the **owed real-instance write testing** caveat (writes covered by unit fakes; demo endpoints 401 without a token). Do not mark ready — the author decides.

---

## Definition of Done

- [ ] 24 tools across 3 flat domain dirs; each dir under the 20-source-file cap.
- [ ] All wired into `createServer`; read-only e2e asserts **19 read-only / 48 full** with zero write leaks.
- [ ] `npm run build && npm run typecheck && npm run test && npm run lint` exits 0 (lint output empty *and* exit 0).
- [ ] Every destructive tool (`*_delete`, `mealplan_rule_write` delete) handler-enforces `confirm: true`.
- [ ] No new `MealieClient` methods; no multipart; client stays 1:1/thin.
- [ ] Adversarial review pass complete, confirmed findings fixed.
- [ ] Draft PR open into `develop`; real-instance write testing noted as owed.
