# Catalog Primitives (Organizers + Foods/Units) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Execution mode (overrides the writing-plans handoff menu):** per the project handoff, build **sequentially in the main loop** — shared per-domain `index.ts` + the per-step quality gate make subagent parallelism unsafe. No worktree; work on branch `feature/catalog-primitives` (already created off `origin/develop`).

**Goal:** Add the organizers (category/tag/tool) and foods/units MCP toolsets — the shared taxonomy recipes/plans/lists reference — completing the default-enabled tool surface (17 new tools, 32 endpoints).

**Architecture:** Two flat tool dirs on the existing PR #3/#4 write foundation. `organizers/` variant-collapses three parallel resources behind a `type` discriminator (5 tools). `foods-units/` keeps `food_*`/`unit_*` as separate CRUD families + a destructive `merge` each (12 tools). No new `MealieClient` methods — generic `getPaginated`/`get`/`post`/`put`/`delete`. Reads always-on; writes stripped under `MEALIE_READ_ONLY`; 5 destructive ops handler-gated by `confirm:true`.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk`, zod, Vitest (hand-written client fakes), Biome, tsup. Types generated in `src/types/mealie.ts`.

**Design:** [`2026-06-02-catalog-primitives-design.md`](./2026-06-02-catalog-primitives-design.md). All endpoint contracts adversarially verified against `src/types/mealie.ts` (zero corrections).

---

## Conventions for every task (do not re-derive)

- **Quality gate before each commit:** `npm run build && npm run typecheck && npm run test && npm run lint` — exit 0. Empty lint output is required (not "no errors" text). Auto-fix import/member order with `npx biome check --write src/`.
- **Per-tool TDD loop:** write failing handler test → `npx vitest run <file>` (FAIL) → implement → `npx vitest run <file>` (PASS) → full gate → commit.
- **Strict-TS gotchas:** optional MCP-arg fields need explicit `| undefined` in the `Args` type; test fakes of client methods must be generic (`async <T>(): Promise<T>`); a captured optional field needs `| undefined`.
- **Biome:** bans `delete obj.key` and unused destructure-discards. For fetch-merge updates, send the FULL merged object (Mealie/Pydantic ignores unknown fields).
- **Pattern source files (read if unsure):** `src/tools/cookbooks/cookbook-{search,get,create,update,delete}.ts`, `src/tools/meal-plans/mealplan-create.ts` (discriminator), `src/tools/result.ts`, `src/tools/confirm.ts`, `src/tools/cookbooks/index.ts`.
- **`.js` import extensions** are required (ESM) — match existing files exactly.

---

## PHASE A — organizers (`src/tools/organizers/`) — the archetype, built + wired first

### Task A0: Shared module (`organizer-projection.ts`)

Holds the type discriminator, the **irregular-plural path map**, and the concise projection — the one shared file for the domain.

**Files:**
- Create: `src/tools/organizers/organizer-projection.ts`
- Test: `src/tools/organizers/organizer-projection.test.ts`

**Step 1 — failing test** (`organizer-projection.test.ts`):
```ts
import { describe, expect, it } from "vitest";
import { organizerBasePath, projectOrganizer } from "./organizer-projection.js";

describe("organizer-projection", () => {
  it("maps each type to its irregular plural path", () => {
    expect(organizerBasePath("category")).toBe("/api/organizers/categories");
    expect(organizerBasePath("tag")).toBe("/api/organizers/tags");
    expect(organizerBasePath("tool")).toBe("/api/organizers/tools");
  });

  it("concise keeps id/slug/name only", () => {
    const full = { id: "u1", slug: "quick", name: "Quick", groupId: "g1", recipes: [{}] };
    expect(projectOrganizer(full, "concise")).toEqual({ id: "u1", slug: "quick", name: "Quick" });
  });

  it("detailed returns the whole object", () => {
    const full = { id: "u1", slug: "quick", name: "Quick", recipes: [{}] };
    expect(projectOrganizer(full, "detailed")).toBe(full);
  });
});
```
Run: `npx vitest run src/tools/organizers/organizer-projection.test.ts` → FAIL (module missing).

**Step 2 — implement** (`organizer-projection.ts`):
```ts
/** The three parallel organizer resources behind one tool family. */
export const ORGANIZER_TYPES = ["category", "tag", "tool"] as const;
/** A single organizer resource type. */
export type OrganizerType = (typeof ORGANIZER_TYPES)[number];

/** Irregular plurals — never `type + "s"` (that yields "categorys"). */
const PLURALS: Record<OrganizerType, string> = {
  category: "categories",
  tag: "tags",
  tool: "tools",
};

/** Concise fields shared by category/tag/tool responses. */
const CONCISE_FIELDS = ["id", "slug", "name"] as const;

/**
 * Builds the collection base path for an organizer type.
 *
 * @param type - The organizer resource type
 * @returns The `/api/organizers/{plural}` base path
 */
export function organizerBasePath(type: OrganizerType): string {
  return `/api/organizers/${PLURALS[type]}`;
}

/**
 * Projects an organizer to a concise view (id/slug/name) or returns it whole.
 *
 * @param organizer - The full organizer object (shape varies by type; may be untyped)
 * @param format - "concise" trims to id/slug/name; "detailed" returns everything
 * @returns The projected organizer as a plain record
 */
export function projectOrganizer(
  organizer: unknown,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return organizer as Record<string, unknown>;
  const source = organizer as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}
```
Run test → PASS. Gate. Commit: `feat(organizers): add organizer projection + type/path map`.

---

### Task A1: `organizer_search` (list + `empty_only` branch)

**Files:** Create `src/tools/organizers/organizer-search.ts` + `.test.ts`.

Key behaviors to test: (1) lists paginated via `getPaginated` at the type's base path; (2) `empty_only:true` for `category` calls `get` on `/api/organizers/categories/empty` and returns a bare `{ items, count }`; (3) `empty_only:true` + `type:"tool"` → `isError` (tools has no `/empty`).

**Implementation** (`organizer-search.ts`):
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import {
  ORGANIZER_TYPES,
  type OrganizerType,
  organizerBasePath,
  projectOrganizer,
} from "./organizer-projection.js";

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource: category, tag, or tool"),
  empty_only: z
    .boolean()
    .optional()
    .describe("Only those with no recipes (category/tag only; invalid for tool)"),
  search: z.string().optional().describe("Full-text search filter"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. name)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

type SearchArgs = {
  type: OrganizerType;
  empty_only?: boolean | undefined;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles organizer_search: paginated list, or the un-enveloped "empty" subset.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments (type + filters)
 * @returns An MCP result with concise items + pagination meta (or a bare empty list)
 */
export async function organizerSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  if (args.empty_only) return searchEmpty(client, args.type);
  try {
    const { type, empty_only, ...query } = args;
    const page = await client.getPaginated<Record<string, unknown>>(organizerBasePath(type), {
      ...query,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
    });
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "organizer_search", "Failed to search organizers");
  }
}

/** Fetch the un-enveloped /empty list (category/tag only). */
async function searchEmpty(client: SearchClient, type: OrganizerType): Promise<CallToolResult> {
  if (type === "tool") {
    return {
      content: [{ type: "text", text: "organizer_search: empty_only is not supported for tools" }],
      isError: true,
    };
  }
  try {
    const items = await client.get<unknown[]>(`${organizerBasePath(type)}/empty`);
    const list = (items ?? []).map((item) => projectOrganizer(item, "concise"));
    return jsonResult({ items: list, count: list.length });
  } catch (error) {
    return errorResult(error, "organizer_search", "Failed to list empty organizers");
  }
}

/** Concise page projection (id/slug/name items + pagination meta). */
function toConcise(page: PaginatedResult<Record<string, unknown>>): Record<string, unknown> {
  return {
    items: page.items.map((item) => projectOrganizer(item, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the organizer_search tool.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerOrganizerSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "organizer_search",
    {
      title: "Search Organizers",
      description:
        "Search recipe categories, tags, or tools (set type). empty_only returns those with no recipes (category/tag only). Returns concise items (id, slug, name) + pagination.",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => organizerSearchHandler(client, args),
  );
}
```
> **Note** the `const { type, empty_only, ...query } = args` destructure intentionally drops `type`/`empty_only` from the query passthrough. Biome's no-unused-discard rule: both are *used* (type in the path, empty_only checked above) so this is fine; if lint flags the rest-discard, build `query` explicitly instead.

Test → gate → commit: `feat(organizers): add organizer_search (list + empty subset)`.

---

### Task A2: `organizer_get` (by-id + `by_slug`)

**Files:** Create `organizer-get.ts` + `.test.ts`.

Test: by-id hits `/{base}/{id}`; `by_slug:true` hits `/{base}/slug/{id}`; concise vs detailed projection; `isError` on throw.

**Implementation** (`organizer-get.ts`) — mirror `cookbook-get.ts` with the type/slug routing:
```ts
const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource: category, tag, or tool"),
  id: z.string().describe("Organizer id (uuid), or slug when by_slug=true"),
  by_slug: z.boolean().optional().describe("Look up by slug instead of id"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) = id/slug/name; detailed = full object"),
};
// handler:
const base = organizerBasePath(args.type);
const path = args.by_slug ? `${base}/slug/${args.id}` : `${base}/${args.id}`;
const organizer = await client.get<unknown>(path);
return jsonResult(projectOrganizer(organizer, args.response_format ?? "concise"));
// annotations: { readOnlyHint: true, openWorldHint: true }
// description: "Get one organizer (category/tag/tool) by id, or by slug with by_slug=true. To list recipes for an organizer, use recipe_search with categories/tags/tools."
```
Test → gate → commit: `feat(organizers): add organizer_get (by id or slug)`.

---

### Task A3: `organizer_create` (per-type typed bodies)

**Files:** Create `organizer-create.ts` + `.test.ts`.

Test: `category`/`tag` POST `{ name }` to the right base path; `tool` POSTs `{ name, householdsWithTool: [] }` (default) and respects a supplied `householdsWithTool`; echoes concise; `isError` on throw.

**Implementation** (`organizer-create.ts`):
```ts
import type { components } from "../../types/mealie.js";
// ...
type CreateClient = Pick<MealieClient, "post">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource to create"),
  name: z.string().min(1).describe("Name of the new organizer"),
  householdsWithTool: z
    .array(z.string())
    .optional()
    .describe("Household ids the tool applies to (tool type only; default empty)"),
};
type CreateArgs = {
  type: OrganizerType;
  name: string;
  householdsWithTool?: string[] | undefined;
};

export async function organizerCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const created = await client.post<unknown>(organizerBasePath(args.type), buildBody(args));
    return jsonResult(projectOrganizer(created, "concise"));
  } catch (error) {
    return errorResult(error, "organizer_create", "Failed to create organizer");
  }
}

/** Per-type create body: category/tag = {name}; tool adds householdsWithTool. */
function buildBody(args: CreateArgs): unknown {
  if (args.type === "tool") {
    const body: components["schemas"]["RecipeToolCreate"] = {
      name: args.name,
      householdsWithTool: args.householdsWithTool ?? [],
    };
    return body;
  }
  const body: components["schemas"]["CategoryIn"] = { name: args.name };
  return body;
}
// annotations: { readOnlyHint: false, openWorldHint: true }
```
Test → gate → commit: `feat(organizers): add organizer_create (per-type bodies)`.

---

### Task A4: `organizer_update` (fetch-merge PUT — prevents silent reset)

**Files:** Create `organizer-update.ts` + `.test.ts`.

Test (critical regression): for `tool`, GET returns `{ id, name, slug, householdsWithTool: ["h1"] }`; update with `changes:{ name:"New" }` must PUT a body that **still contains `householdsWithTool: ["h1"]`** (no silent reset) — assert the captured PUT body. Also: PUT lands at `/{base}/{id}`; echoes concise; `isError` on throw.

**Implementation** — mirror `cookbook-update.ts` single path (no bulk here):
```ts
type UpdateClient = Pick<MealieClient, "get" | "put">;
const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource to update"),
  id: z.string().describe("Organizer id (uuid) to update"),
  changes: z.record(z.unknown()).describe("Fields to change; merged onto the current organizer"),
};
// handler:
const base = organizerBasePath(args.type);
const path = `${base}/${args.id}`;
const current = await client.get<Record<string, unknown>>(path);
const merged = { ...current, ...args.changes };
const updated = await client.put<unknown>(path, merged);
return jsonResult(projectOrganizer(updated, "concise"));
// annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true }
// description: "Update an organizer. Pass type, id, and changes (merged onto the current object; PUT is a full replace so the merge preserves untouched fields)."
```
Test → gate → commit: `feat(organizers): add organizer_update (fetch-merge)`.

---

### Task A5: `organizer_delete` (confirm-gated)

**Files:** Create `organizer-delete.ts` + `.test.ts`. Mirror `cookbook-delete.ts` exactly, with the type/path map.

Test: missing `confirm` → `isError`, no client call; `confirm:true` → DELETE `/{base}/{id}` → `{ deleted: id }`; `isError` on throw.
```ts
const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource to delete"),
  id: z.string().describe("Organizer id (uuid) to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};
// handler: requireConfirmation(args.confirm, `delete ${args.type} "${args.id}"`) BEFORE try;
// then client.delete(`${organizerBasePath(args.type)}/${args.id}`); return { deleted: args.id }.
// annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
```
Test → gate → commit: `feat(organizers): add organizer_delete (confirm-gated)`.

---

### Task A6: `organizers/index.ts` + wire into `createServer` + bump `server.test.ts`

**Files:**
- Create: `src/tools/organizers/index.ts`
- Modify: `src/server.ts` (import + call `registerOrganizerTools`)
- Modify: `src/server.test.ts` (arrays + counts)

**index.ts** — mirror `cookbooks/index.ts`:
```ts
export type RegisterOptions = { readOnly: boolean };
export function registerOrganizerTools(server, client, options): void {
  registerOrganizerSearch(server, client);
  registerOrganizerGet(server, client);
  if (options.readOnly) return;
  registerOrganizerCreate(server, client);
  registerOrganizerUpdate(server, client);
  registerOrganizerDelete(server, client);
}
```

**server.ts** — add `import { registerOrganizerTools } from "./tools/organizers/index.js";` and `registerOrganizerTools(server, client, options);` after the existing registrations.

**server.test.ts** — add to `READ_TOOLS`: `organizer_search`, `organizer_get`. Add to `WRITE_TOOLS`: `organizer_create`, `organizer_update`, `organizer_delete`. Update assertions + comments:
- read-only `toHaveLength(19)` → `21` (get_about + 20 reads).
- full `toHaveLength(48)` → `53` (21 reads + 32 writes).

Run `npx vitest run src/server.test.ts` → PASS. Full gate. Commit: `feat(organizers): wire organizer toolset into the server (e2e 21/53)`.

---

## PHASE B — foods (`src/tools/foods-units/`)

### Task B0: `food-projection.ts`

**Files:** Create `src/tools/foods-units/food-projection.ts` + `.test.ts`.
```ts
import type { components } from "../../types/mealie.js";
export type FoodDetail = components["schemas"]["IngredientFood-Output"];
const CONCISE_FIELDS = ["id", "name", "pluralName", "description", "labelId"] as const;
export function projectFood(food: FoodDetail, format: "concise" | "detailed"): Record<string, unknown> { /* identical shape to projectCookbook */ }
```
Test concise keeps the 5 fields; detailed returns whole. Gate. Commit: `feat(foods): add food projection`.

### Task B1: `food_search` → mirror `cookbook-search.ts`
Path `/api/foods`; `inputSchema` adds `search` (foods support full-text search); items projected via `projectFood`. Same pagination consts. Commit: `feat(foods): add food_search`.

### Task B2: `food_get` → mirror `cookbook-get.ts`
Path `/api/foods/${id}`; `projectFood`; `response_format`. Commit: `feat(foods): add food_get`.

### Task B3: `food_create`
Body `CreateIngredientFood`, supplying required-with-default fields. Test: POST body includes `description:""`, `extras:{}`, `aliases:[]`, `householdsWithIngredientFood:[]` when omitted; `name` passed through; optional `labelId` included only when provided.
```ts
const inputSchema = {
  name: z.string().min(1).describe("Food name"),
  pluralName: z.string().optional().describe("Plural form"),
  description: z.string().optional().describe("Optional description"),
  labelId: z.string().optional().describe("MultiPurposeLabel id (from the groups domain)"),
};
// body:
const body: components["schemas"]["CreateIngredientFood"] = {
  name: args.name,
  description: args.description ?? "",
  extras: {},
  aliases: [],
  householdsWithIngredientFood: [],
  ...(args.pluralName ? { pluralName: args.pluralName } : {}),
  ...(args.labelId ? { labelId: args.labelId } : {}),
};
const created = await client.post<FoodDetail>("/api/foods", body);
return jsonResult(projectFood(created, "concise"));
// annotations: { readOnlyHint: false, openWorldHint: true }
```
Commit: `feat(foods): add food_create`.

### Task B4: `food_update` (fetch-merge — mandatory) → mirror `cookbook-update.ts` single path
Path `/api/foods/${id}`; GET `FoodDetail` → merge `changes` → PUT. **Regression test:** current food has `aliases:[{name:"x"}]`; `changes:{name:"New"}` → PUT body still contains `aliases:[{name:"x"}]`. `idempotentHint`. Commit: `feat(foods): add food_update (fetch-merge)`.

### Task B5: `food_merge` (destructive PUT — NEW pattern)
**Files:** Create `food-merge.ts` + `.test.ts`.
Test: missing `confirm` → `isError`, no call; `confirm:true` → `PUT /api/foods/merge` with body `{ fromFood, toFood }`; returns the `SuccessResponse`; `isError` on throw.
```ts
import { requireConfirmation } from "../confirm.js";
type MergeClient = Pick<MealieClient, "put">;
const inputSchema = {
  fromFood: z.string().describe("Food id to merge FROM (will be absorbed)"),
  toFood: z.string().describe("Food id to merge INTO (kept)"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive merge"),
};
type MergeArgs = { fromFood: string; toFood: string; confirm?: boolean | undefined };
export async function foodMergeHandler(client: MergeClient, args: MergeArgs): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `merge food "${args.fromFood}" into "${args.toFood}"`);
  if (unconfirmed) return unconfirmed;
  try {
    const body: components["schemas"]["MergeFood"] = { fromFood: args.fromFood, toFood: args.toFood };
    const result = await client.put<unknown>("/api/foods/merge", body);
    return jsonResult(result ?? { merged: { from: args.fromFood, to: args.toFood } });
  } catch (error) {
    return errorResult(error, "food_merge", "Failed to merge foods");
  }
}
// annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
// description: "Merge one food into another (combines references, removes the source). Destructive — requires confirm:true."
```
Commit: `feat(foods): add food_merge (destructive)`.

### Task B6: `food_delete` (confirm) → mirror `cookbook-delete.ts`
Path `/api/foods/${id}`; `{ deleted: id }`. Commit: `feat(foods): add food_delete (confirm-gated)`.

---

## PHASE C — units (`src/tools/foods-units/`) — mirror foods

### Task C0: `unit-projection.ts`
`UnitDetail = components["schemas"]["IngredientUnit-Output"]`; concise fields `["id", "name", "pluralName", "abbreviation", "useAbbreviation", "fraction", "description"]`. Commit: `feat(units): add unit projection`.

### Task C1–C2: `unit_search`, `unit_get` → mirror food at `/api/units`, using `projectUnit`. Commits accordingly.

### Task C3: `unit_create`
Body `CreateIngredientUnit`, supplying required-with-default: `description:""`, `extras:{}`, `fraction:true`, `abbreviation:""`, `pluralAbbreviation:""`, `useAbbreviation:false`, `aliases:[]`.
```ts
const inputSchema = {
  name: z.string().min(1).describe("Unit name (e.g. tablespoon)"),
  pluralName: z.string().optional().describe("Plural form"),
  abbreviation: z.string().optional().describe("Short form (e.g. tbsp)"),
  useAbbreviation: z.boolean().optional().describe("Display the abbreviation (default false)"),
  fraction: z.boolean().optional().describe("Allow fractional display (default true)"),
  description: z.string().optional().describe("Optional description"),
};
// body supplies every required-with-default field, overriding with args where provided:
const body: components["schemas"]["CreateIngredientUnit"] = {
  name: args.name,
  description: args.description ?? "",
  extras: {},
  fraction: args.fraction ?? true,
  abbreviation: args.abbreviation ?? "",
  pluralAbbreviation: "",
  useAbbreviation: args.useAbbreviation ?? false,
  aliases: [],
  ...(args.pluralName ? { pluralName: args.pluralName } : {}),
};
```
Commit: `feat(units): add unit_create`.

### Task C4: `unit_update` (fetch-merge) → mirror `food_update` at `/api/units/${id}`. Regression test on `fraction`/`abbreviation` preserved. Commit: `feat(units): add unit_update (fetch-merge)`.

### Task C5: `unit_merge` → mirror `food_merge`; body `MergeUnit { fromUnit, toUnit }`; `PUT /api/units/merge`. Commit: `feat(units): add unit_merge (destructive)`.

### Task C6: `unit_delete` → mirror `food_delete` at `/api/units/${id}`. Commit: `feat(units): add unit_delete (confirm-gated)`.

---

## PHASE D — wire foods-units + final e2e bump

### Task D0: `foods-units/index.ts` + `createServer` + `server.test.ts`

**index.ts** exports `registerFoodsUnitsTools(server, client, { readOnly })`:
```ts
// reads always:
registerFoodSearch; registerFoodGet; registerUnitSearch; registerUnitGet;
if (options.readOnly) return;
// writes:
registerFoodCreate; registerFoodUpdate; registerFoodMerge; registerFoodDelete;
registerUnitCreate; registerUnitUpdate; registerUnitMerge; registerUnitDelete;
```

**server.ts** — add `import { registerFoodsUnitsTools } from "./tools/foods-units/index.js";` + the call.

**server.test.ts** — add to `READ_TOOLS`: `food_search`, `food_get`, `unit_search`, `unit_get`. Add to `WRITE_TOOLS`: `food_create`, `food_update`, `food_merge`, `food_delete`, `unit_create`, `unit_update`, `unit_merge`, `unit_delete`. Update assertions + comments:
- read-only `21` → **`25`** (get_about + 24 reads).
- full `53` → **`65`** (25 reads + 40 writes).

Run `npx vitest run src/server.test.ts` → PASS. Full gate. Commit: `feat(foods-units): wire foods/units toolset into the server (e2e 25/65)`.

### Task D1: Real-stdio subprocess sanity check (carried forward)

Run a throwaway stdio check (not committed): spawn the built server, list tools in full vs `MEALIE_READ_ONLY=1` (expect 65 vs 25 incl. `get_about`), call `get_about` (expect 200 against `https://demo.mealie.io`), and a `food_search` / `organizer_search` (expect 401 surfaced via `errorResult`, confirming error-body passthrough). Document the result; note **real-instance write testing remains owed** (demo is tokenless 401).

---

## PHASE E — review + PR

### Task E0: README update
Add organizers + foods/units to the tool table (mirror the meal-plan/shopping/cookbook docs added in `1ec023e`). Commit: `docs(readme): document organizer + food/unit tools`.

### Task E1: Adversarial multi-lens code review
Run the review workflow (correctness / convention-adherence / strict-TS-and-biome / test-coverage / security lenses) over the diff vs `develop`; verify each finding; fix; re-gate. Commit fixes as `refactor(catalog): address code-review findings`.

### Task E2: Draft PR
`gh pr create --draft --base develop` with body: scope (17 tools / 32 endpoints), the verified-inventory note, the **owed real-instance write testing**, and the e2e count change (19/48 → 25/65). Keep git/push/PR in the main loop (author decides "Ready").

---

## Done when
- 17 tools across `organizers/` (5) + `foods-units/` (12), each unit-tested.
- `server.test.ts` green at **25 read-only / 65 full**.
- Full gate exit 0; real-stdio check documented.
- Draft PR open into `develop`.
