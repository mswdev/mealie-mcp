# PR #11 — Opt-in Explore Toolset Implementation Plan

> **For Claude:** Executed sequentially in the main loop (project convention — TDD, archetype-first). Design: `docs/plans/2026-06-06-explore-design.md` (approved 2026-06-06).

**Goal:** 5 read-only tools over the 15 public `GET /api/explore/groups/{group_slug}/...` ops behind `MEALIE_TOOLSETS=explore` — the final coverage PR (259/259).

**Architecture:** Variant-collapse the 6 parallel catalog resources behind `explore_list`/`explore_get` (the `organizer_*` precedent); keep the recipe trio first-class (`explore_recipe_search/get/suggestions`, mirroring `recipes/core`). Registrar takes NO options (all reads — `registerAppTools` precedent); explore is the first toolset that fully survives `MEALIE_READ_ONLY`. No `MealieClient` changes.

**Tech stack:** TypeScript (strict, `exactOptionalPropertyTypes`), zod, vitest (hand-written fakes), Biome.

**Quality gate before EVERY commit:** `npm run build && npm run typecheck && npm run test && npm run lint` (auto-fix: `npx biome check --write src/`).

**Inventory facts this plan relies on** (workflow-verified against `src/types/mealie.ts`, see design §1):
- All 15 ops GET-only; zero writes; only an optional `accept-language` header (not exposed).
- The 5 catalog lists share 8 query params incl. `search`; **households list has NO `search`** → explicit guard.
- Catalog gets are `item_id`-only; household get is `household_slug`-only; recipe get is `recipe_slug`-only → lookup mode routed by type, no `by_slug` flag.
- **Foods have no `slug`** → food concise projection is `{id, name, labelId}` (mirrors `food_search`).
- List envelopes are standard pagination envelopes (schema *names* differ from authed twins; structures identical) → `client.getPaginated` works unchanged.
- Explore handlers `encodeURIComponent` interpolated path segments (deliberate deviation, design §4.3).

---

## Task 1: `explore-projection.ts` + toolset token

**Files:**
- Modify: `src/config.ts:28` (KNOWN_TOOLSETS — one token)
- Modify: `src/config.test.ts` (after the admin case, ~line 67)
- Create: `src/tools/explore/explore-projection.ts`
- Test: `src/tools/explore/explore-projection.test.ts`

**Step 1: Write the failing tests**

`src/tools/explore/explore-projection.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  exploreBasePath,
  exploreRecipesPath,
  projectExploreItem,
  projectExploreRecipe,
} from "./explore-projection.js";

describe("exploreBasePath", () => {
  it("builds each of the six group-scoped collection paths", () => {
    expect(exploreBasePath("cookbook", "home")).toBe("/api/explore/groups/home/cookbooks");
    expect(exploreBasePath("category", "home")).toBe(
      "/api/explore/groups/home/organizers/categories",
    );
    expect(exploreBasePath("tag", "home")).toBe("/api/explore/groups/home/organizers/tags");
    expect(exploreBasePath("tool", "home")).toBe("/api/explore/groups/home/organizers/tools");
    expect(exploreBasePath("food", "home")).toBe("/api/explore/groups/home/foods");
    expect(exploreBasePath("household", "home")).toBe("/api/explore/groups/home/households");
  });

  it("URI-encodes the group slug (externally discovered string)", () => {
    expect(exploreBasePath("food", "my group/x")).toBe(
      "/api/explore/groups/my%20group%2Fx/foods",
    );
  });
});

describe("exploreRecipesPath", () => {
  it("builds the group-scoped public recipes path, encoded", () => {
    expect(exploreRecipesPath("home")).toBe("/api/explore/groups/home/recipes");
    expect(exploreRecipesPath("a b")).toBe("/api/explore/groups/a%20b/recipes");
  });
});

describe("projectExploreItem", () => {
  it("trims to id/slug/name for catalog types", () => {
    const item = { id: "u1", slug: "dinner", name: "Dinner", position: 3, public: true };

    expect(projectExploreItem(item, "cookbook", "concise")).toEqual({
      id: "u1",
      slug: "dinner",
      name: "Dinner",
    });
  });

  it("trims foods to id/name/labelId (foods have no slug)", () => {
    const food = { id: "f1", name: "Flour", labelId: "l1", aliases: [] };

    expect(projectExploreItem(food, "food", "concise")).toEqual({
      id: "f1",
      name: "Flour",
      labelId: "l1",
    });
  });

  it("passes the full object through when detailed", () => {
    const item = { id: "h1", slug: "home", name: "Home", preferences: { privateGroup: false } };

    expect(projectExploreItem(item, "household", "detailed")).toEqual(item);
  });
});

describe("projectExploreRecipe", () => {
  it("keeps concise fields and drops heavy ones", () => {
    const recipe = {
      id: "r1",
      slug: "soup",
      name: "Soup",
      rating: 5,
      recipeIngredient: [{ note: "1 cup water" }],
      recipeInstructions: [{ text: "Boil" }],
      comments: [{ text: "yum" }],
      nutrition: { calories: "100" },
    };

    const concise = projectExploreRecipe(recipe, "concise", []);

    expect(concise).toMatchObject({ id: "r1", slug: "soup", name: "Soup", rating: 5 });
    expect(concise).not.toHaveProperty("recipeIngredient");
    expect(concise).not.toHaveProperty("comments");
    expect(concise).not.toHaveProperty("nutrition");
  });

  it("adds heavy fields back via include", () => {
    const recipe = { id: "r1", comments: [{ text: "yum" }], nutrition: { calories: "100" } };

    const concise = projectExploreRecipe(recipe, "concise", ["nutrition"]);

    expect(concise).toHaveProperty("nutrition");
    expect(concise).not.toHaveProperty("comments");
  });

  it("passes the full object through when detailed", () => {
    const recipe = { id: "r1", recipeIngredient: [{}] };

    expect(projectExploreRecipe(recipe, "detailed", [])).toEqual(recipe);
  });
});
```

`src/config.test.ts` — add after the admin toolset case:

```typescript
  it("enables the explore toolset, alone and alongside the others", () => {
    expect(parseToolsets("explore")).toEqual(new Set(["explore"]));
    expect(parseToolsets("households,automation,groups,users,admin,explore")).toEqual(
      new Set(["households", "automation", "groups", "users", "admin", "explore"]),
    );
  });
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/tools/explore/explore-projection.test.ts src/config.test.ts`
Expected: FAIL — cannot resolve `./explore-projection.js`; `parseToolsets("explore")` yields empty set.

**Step 3: Implement**

`src/config.ts:28` — one line:

```typescript
export const KNOWN_TOOLSETS = [
  "households",
  "automation",
  "groups",
  "users",
  "admin",
  "explore",
] as const;
```

(If Biome reflows it to one line under the width limit, accept whatever `biome check --write` produces.)

`src/tools/explore/explore-projection.ts`:

```typescript
/** The six parallel public catalog resources behind explore_list/explore_get. */
export const EXPLORE_TYPES = [
  "cookbook",
  "category",
  "tag",
  "tool",
  "food",
  "household",
] as const;

/** A single public explore resource type. */
export type ExploreType = (typeof EXPLORE_TYPES)[number];

/** Heavy recipe fields addable back onto the concise view via `include`. */
export type ExploreIncludable = "comments" | "nutrition";

/** Shared group_slug param description — the discovery story (design §3). */
export const GROUP_SLUG_DESCRIPTION =
  "Slug of the public group to browse. Find it in the instance's public URL (/g/{slug}), " +
  "via group_self_get (groups toolset), or admin_about's defaultGroupSlug (admin toolset).";

/** Shared description suffix: the public-group requirement and 404 ambiguity. */
export const PUBLIC_GROUP_HINT =
  "Requires the group to be public — private and nonexistent groups both return 404.";

/** Per-type URL segment under the group root — irregular, never naive pluralization. */
const SEGMENTS: Record<ExploreType, string> = {
  cookbook: "cookbooks",
  category: "organizers/categories",
  tag: "organizers/tags",
  tool: "organizers/tools",
  food: "foods",
  household: "households",
};

/** Concise fields for five of the six types (foods differ — they have no slug). */
const CONCISE_FIELDS = ["id", "slug", "name"] as const;

/** Food concise fields — no slug exists; labelId mirrors food_search's projection. */
const FOOD_CONCISE_FIELDS = ["id", "name", "labelId"] as const;

/** Lightweight fields kept in the concise public-recipe projection (mirrors recipe_get). */
const RECIPE_CONCISE_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "image",
  "rating",
  "recipeServings",
  "recipeYield",
  "recipeYieldQuantity",
  "totalTime",
  "prepTime",
  "cookTime",
  "performTime",
  "recipeCategory",
  "tags",
  "tools",
  "dateUpdated",
  "lastMade",
] as const;

/** Group-scoped explore root with the externally discovered slug URI-encoded. */
function exploreGroupRoot(groupSlug: string): string {
  return `/api/explore/groups/${encodeURIComponent(groupSlug)}`;
}

/**
 * Builds the public collection path for an explore catalog type.
 *
 * @param type - The explore resource type
 * @param groupSlug - Slug of the public group (URI-encoded into the path)
 * @returns The `/api/explore/groups/{slug}/{segment}` collection path
 */
export function exploreBasePath(type: ExploreType, groupSlug: string): string {
  return `${exploreGroupRoot(groupSlug)}/${SEGMENTS[type]}`;
}

/**
 * Builds the public recipes path for a group (search root; append a recipe slug
 * or `/suggestions` for the sibling endpoints).
 *
 * @param groupSlug - Slug of the public group (URI-encoded into the path)
 * @returns The `/api/explore/groups/{slug}/recipes` path
 */
export function exploreRecipesPath(groupSlug: string): string {
  return `${exploreGroupRoot(groupSlug)}/recipes`;
}

/**
 * Projects a public catalog item to its concise view or returns it whole.
 * Foods project to id/name/labelId (no slug exists); all other types to id/slug/name.
 *
 * @param item - The item object (shape varies by type; may be untyped)
 * @param type - The explore resource type (selects the concise field set)
 * @param format - "concise" trims to key fields; "detailed" returns everything
 * @returns The projected item as a plain record
 */
export function projectExploreItem(
  item: unknown,
  type: ExploreType,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return item as Record<string, unknown>;
  const source = item as Record<string, unknown>;
  const fields = type === "food" ? FOOD_CONCISE_FIELDS : CONCISE_FIELDS;
  const concise: Record<string, unknown> = {};
  for (const field of fields) concise[field] = source[field];
  return concise;
}

/**
 * Projects a public recipe to the concise view (plus optional heavy includes),
 * or returns it whole when detailed. Explore's own copy of the recipe_get
 * projection — sibling cross-imports are forbidden (file-organization rules).
 *
 * @param recipe - The full public recipe object (Recipe-Output shaped; untyped)
 * @param format - "concise" trims heavy fields; "detailed" returns everything
 * @param include - Heavy fields to add back onto the concise view (ignored when detailed)
 * @returns The projected recipe as a plain record
 */
export function projectExploreRecipe(
  recipe: unknown,
  format: "concise" | "detailed",
  include: ExploreIncludable[],
): Record<string, unknown> {
  if (format === "detailed") return recipe as Record<string, unknown>;
  const source = recipe as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of RECIPE_CONCISE_FIELDS) concise[field] = source[field];
  for (const field of include) concise[field] = source[field];
  return concise;
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/tools/explore/explore-projection.test.ts src/config.test.ts`
Expected: PASS.

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/config.ts src/config.test.ts src/tools/explore/
git commit -m "feat(explore): toolset token + explore-projection (public path builders, per-type concise projections)"
```

---

## Task 2: `explore_list` (archetype)

**Files:**
- Create: `src/tools/explore/explore-list.ts`
- Test: `src/tools/explore/explore-list.test.ts`

**Step 1: Write the failing test**

`src/tools/explore/explore-list.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { exploreListHandler } from "./explore-list.js";

type Captured = { path: string; query: unknown };

function fakePaginatedClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "u1", slug: "dinner", name: "Dinner", position: 2, public: true }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

describe("exploreListHandler", () => {
  it("lists the typed public collection paginated with concise items", async () => {
    const captured: Captured[] = [];

    const result = await exploreListHandler(fakePaginatedClient(captured), {
      type: "cookbook",
      group_slug: "home",
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/cookbooks");
    expect(captured[0]?.query).toMatchObject({ perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "u1", slug: "dinner", name: "Dinner" }]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("routes organizer types under organizers/ and passes filters through", async () => {
    const captured: Captured[] = [];

    await exploreListHandler(fakePaginatedClient(captured), {
      type: "tag",
      group_slug: "home",
      search: "quick",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "asc",
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/organizers/tags");
    expect(captured[0]?.query).toMatchObject({
      search: "quick",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "asc",
    });
  });

  it("projects foods to id/name/labelId", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        return {
          items: [{ id: "f1", name: "Flour", labelId: "l1", aliases: [{}] }],
          total: 1,
          page: 1,
          perPage: 20,
          totalPages: 1,
        } as T;
      },
    };

    const result = await exploreListHandler(client, { type: "food", group_slug: "home" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "f1", name: "Flour", labelId: "l1" }]);
  });

  it("rejects search for households (no upstream search param)", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("must not call");
      },
    };

    const result = await exploreListHandler(client, {
      type: "household",
      group_slug: "home",
      search: "x",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("not supported");
  });

  it("returns an error result when the client throws (e.g. 404 private group)", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreListHandler(client, { type: "category", group_slug: "nope" });

    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/tools/explore/explore-list.test.ts`
Expected: FAIL — cannot resolve `./explore-list.js`.

**Step 3: Implement**

`src/tools/explore/explore-list.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import {
  EXPLORE_TYPES,
  type ExploreType,
  exploreBasePath,
  GROUP_SLUG_DESCRIPTION,
  projectExploreItem,
  PUBLIC_GROUP_HINT,
} from "./explore-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type ListClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  type: z
    .enum(EXPLORE_TYPES)
    .describe("Which public resource: cookbook, category, tag, tool, food, or household"),
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  search: z.string().optional().describe("Full-text search filter (not supported for household)"),
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

type ListArgs = {
  type: ExploreType;
  group_slug: string;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles explore_list: a paginated public catalog list for one of the six
 * resource types, scoped to a public group. Search is rejected for households
 * (the upstream households list has no search param — design §3.4).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated list arguments (type + group_slug + filters)
 * @returns An MCP result with concise items + pagination meta, or an error result
 */
export async function exploreListHandler(
  client: ListClient,
  args: ListArgs,
): Promise<CallToolResult> {
  if (args.type === "household" && args.search !== undefined) {
    return {
      content: [{ type: "text", text: "explore_list: search is not supported for households" }],
      isError: true,
    };
  }
  try {
    const page = await client.getPaginated<Record<string, unknown>>(
      exploreBasePath(args.type, args.group_slug),
      {
        search: args.search,
        page: args.page,
        perPage: args.perPage ?? DEFAULT_PER_PAGE,
        orderBy: args.orderBy,
        orderDirection: args.orderDirection,
      },
    );
    return jsonResult(toConcise(page, args.type));
  } catch (error) {
    return errorResult(error, "explore_list", "Failed to list public resources");
  }
}

/** Projects a page to per-type concise items plus pagination meta. */
function toConcise(
  page: PaginatedResult<Record<string, unknown>>,
  type: ExploreType,
): Record<string, unknown> {
  return {
    items: page.items.map((item) => projectExploreItem(item, type, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the explore_list tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreList(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_list",
    {
      title: "List Public Resources",
      description:
        "Browse a public group's cookbooks, categories, tags, tools, foods, or households " +
        `(set type) without authentication concerns. ${PUBLIC_GROUP_HINT} ` +
        "Returns concise items + pagination.",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => exploreListHandler(client, args),
  );
}
```

**Step 4: Run to verify pass** — `npx vitest run src/tools/explore/explore-list.test.ts` → PASS.

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/tools/explore/explore-list.ts src/tools/explore/explore-list.test.ts
git commit -m "feat(explore): explore_list — public catalog lists across 6 resource types (household search guard)"
```

---

## Task 3: `explore_get`

**Files:**
- Create: `src/tools/explore/explore-get.ts`
- Test: `src/tools/explore/explore-get.test.ts`

**Step 1: Write the failing test**

`src/tools/explore/explore-get.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { exploreGetHandler } from "./explore-get.js";

function fakeGetClient(calls: string[], response: unknown) {
  return {
    async get<T>(path: string): Promise<T> {
      calls.push(path);
      return response as T;
    },
  };
}

describe("exploreGetHandler", () => {
  it("fetches a catalog item by id with a concise projection", async () => {
    const calls: string[] = [];
    const client = fakeGetClient(calls, {
      id: "c1",
      slug: "dinner",
      name: "Dinner",
      groupId: "g1",
    });

    const result = await exploreGetHandler(client, {
      type: "category",
      group_slug: "home",
      id: "c1",
    });

    expect(calls).toEqual(["/api/explore/groups/home/organizers/categories/c1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ id: "c1", slug: "dinner", name: "Dinner" });
  });

  it("treats id as the household slug for type=household", async () => {
    const calls: string[] = [];
    const client = fakeGetClient(calls, { id: "h1", slug: "main-house", name: "Main" });

    await exploreGetHandler(client, { type: "household", group_slug: "home", id: "main-house" });

    expect(calls).toEqual(["/api/explore/groups/home/households/main-house"]);
  });

  it("URI-encodes the id segment", async () => {
    const calls: string[] = [];
    const client = fakeGetClient(calls, { id: "x" });

    await exploreGetHandler(client, { type: "food", group_slug: "home", id: "a/b" });

    expect(calls).toEqual(["/api/explore/groups/home/foods/a%2Fb"]);
  });

  it("returns the full object when detailed", async () => {
    const full = { id: "k1", slug: "b", name: "B", position: 9, queryFilterString: "tags.id=1" };
    const client = fakeGetClient([], full);

    const result = await exploreGetHandler(client, {
      type: "cookbook",
      group_slug: "home",
      id: "k1",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual(full);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreGetHandler(client, { type: "tool", group_slug: "x", id: "t1" });

    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run to verify failure** — `npx vitest run src/tools/explore/explore-get.test.ts` → FAIL (unresolved import).

**Step 3: Implement**

`src/tools/explore/explore-get.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import {
  EXPLORE_TYPES,
  type ExploreType,
  exploreBasePath,
  GROUP_SLUG_DESCRIPTION,
  projectExploreItem,
  PUBLIC_GROUP_HINT,
} from "./explore-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  type: z
    .enum(EXPLORE_TYPES)
    .describe("Which public resource: cookbook, category, tag, tool, food, or household"),
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  id: z
    .string()
    .describe(
      "Item id (uuid) for cookbook/category/tag/tool/food; the household slug for household " +
        "(the public surface offers exactly one lookup per type)",
    ),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) = key fields; detailed = the full object"),
};

type GetArgs = {
  type: ExploreType;
  group_slug: string;
  id: string;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles explore_get: fetches one public catalog item. The lookup mode is
 * routed by type — five catalog types use the item id, household uses its slug
 * (design §3.5); the URL shape is uniform either way.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (type, group_slug, id, response_format)
 * @returns An MCP result with the projected item, or an error result
 */
export async function exploreGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const path = `${exploreBasePath(args.type, args.group_slug)}/${encodeURIComponent(args.id)}`;
    const item = await client.get<unknown>(path);
    return jsonResult(projectExploreItem(item, args.type, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "explore_get", "Failed to get public resource");
  }
}

/**
 * Registers the explore_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_get",
    {
      title: "Get Public Resource",
      description:
        "Get one public cookbook/category/tag/tool/food by id, or a household by slug " +
        `(set type). ${PUBLIC_GROUP_HINT}`,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => exploreGetHandler(client, args),
  );
}
```

**Step 4: Run to verify pass** — `npx vitest run src/tools/explore/explore-get.test.ts` → PASS.

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/tools/explore/explore-get.ts src/tools/explore/explore-get.test.ts
git commit -m "feat(explore): explore_get — public catalog item by id (household routed by slug)"
```

---

## Task 4: `explore_recipe_search`

**Files:**
- Create: `src/tools/explore/explore-recipe-search.ts`
- Test: `src/tools/explore/explore-recipe-search.test.ts`

**Step 1: Write the failing test**

`src/tools/explore/explore-recipe-search.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { exploreRecipeSearchHandler } from "./explore-recipe-search.js";

type Captured = { path: string; query: unknown };

function fakePaginatedClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "r1", slug: "soup", name: "Soup", rating: 5 }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

describe("exploreRecipeSearchHandler", () => {
  it("searches the group's public recipes with concise items", async () => {
    const captured: Captured[] = [];

    const result = await exploreRecipeSearchHandler(fakePaginatedClient(captured), {
      group_slug: "home",
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/recipes");
    expect(captured[0]?.query).toMatchObject({ perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "r1", slug: "soup", name: "Soup" }]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("passes filters through — including the cookbook filter", async () => {
    const captured: Captured[] = [];

    await exploreRecipeSearchHandler(fakePaginatedClient(captured), {
      group_slug: "home",
      search: "soup",
      categories: ["dinner"],
      tags: ["quick"],
      tools: ["pot"],
      foods: ["f1"],
      cookbook: "favorites",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "desc",
    });

    expect(captured[0]?.query).toMatchObject({
      search: "soup",
      categories: ["dinner"],
      tags: ["quick"],
      tools: ["pot"],
      foods: ["f1"],
      cookbook: "favorites",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "desc",
    });
  });

  it("does not leak group_slug into the query string", async () => {
    const captured: Captured[] = [];

    await exploreRecipeSearchHandler(fakePaginatedClient(captured), { group_slug: "home" });

    expect(captured[0]?.query).not.toHaveProperty("group_slug");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreRecipeSearchHandler(client, { group_slug: "nope" });

    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run to verify failure** — `npx vitest run src/tools/explore/explore-recipe-search.test.ts` → FAIL.

**Step 3: Implement**

`src/tools/explore/explore-recipe-search.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import {
  exploreRecipesPath,
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
} from "./explore-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

type RecipeSummary = components["schemas"]["RecipeSummary"];
/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  search: z.string().optional().describe("Full-text search across recipe names/descriptions"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. name, created_at, rating)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
  categories: z.array(z.string()).optional().describe("Filter by category slugs/ids"),
  tags: z.array(z.string()).optional().describe("Filter by tag slugs/ids"),
  tools: z.array(z.string()).optional().describe("Filter by tool slugs/ids"),
  foods: z.array(z.string()).optional().describe("Filter by food ids"),
  cookbook: z
    .string()
    .optional()
    .describe("Filter to one public cookbook (id or slug — from explore_list type=cookbook)"),
};

type SearchArgs = {
  group_slug: string;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  categories?: string[] | undefined;
  tags?: string[] | undefined;
  tools?: string[] | undefined;
  foods?: string[] | undefined;
  cookbook?: string | undefined;
};

/**
 * Handles explore_recipe_search: lists a public group's recipes with the same
 * pagination + filters as recipe_search, plus the browse-relevant cookbook filter.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments (group_slug + filters)
 * @returns An MCP result with concise items (id, slug, name) + pagination meta
 */
export async function exploreRecipeSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<RecipeSummary>(
      exploreRecipesPath(args.group_slug),
      toQuery(args),
    );
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "explore_recipe_search", "Failed to search public recipes");
  }
}

/** Builds the query params — group_slug stays in the path, never the query. */
function toQuery(args: SearchArgs): Record<string, unknown> {
  return {
    search: args.search,
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    categories: args.categories,
    tags: args.tags,
    tools: args.tools,
    foods: args.foods,
    cookbook: args.cookbook,
  };
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
 * Registers the explore_recipe_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreRecipeSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_recipe_search",
    {
      title: "Search Public Recipes",
      description:
        "Search and filter a public group's recipes with pagination (no account needed on " +
        `the target group). ${PUBLIC_GROUP_HINT} Returns concise summaries (id, slug, name).`,
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => exploreRecipeSearchHandler(client, args),
  );
}
```

Note: `toQuery` passes `cookbook` etc. with value `undefined` when unset — `buildQueryString` drops undefined params (existing behavior relied on by every other tool; spot-check `src/client/pagination.ts` if in doubt).

**Step 4: Run to verify pass** — `npx vitest run src/tools/explore/explore-recipe-search.test.ts` → PASS.

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/tools/explore/explore-recipe-search.ts src/tools/explore/explore-recipe-search.test.ts
git commit -m "feat(explore): explore_recipe_search — public recipe search (recipe_search mirror + cookbook filter)"
```

---

## Task 5: `explore_recipe_get`

**Files:**
- Create: `src/tools/explore/explore-recipe-get.ts`
- Test: `src/tools/explore/explore-recipe-get.test.ts`

**Step 1: Write the failing test**

`src/tools/explore/explore-recipe-get.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { exploreRecipeGetHandler } from "./explore-recipe-get.js";

const FULL_RECIPE = {
  id: "r1",
  slug: "soup",
  name: "Soup",
  rating: 4,
  recipeIngredient: [{ note: "1 cup water" }],
  recipeInstructions: [{ text: "Boil" }],
  comments: [{ text: "yum" }],
  nutrition: { calories: "100" },
};

function fakeGetClient(calls: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      calls.push(path);
      return FULL_RECIPE as T;
    },
  };
}

describe("exploreRecipeGetHandler", () => {
  it("fetches a public recipe by slug with the concise projection", async () => {
    const calls: string[] = [];

    const result = await exploreRecipeGetHandler(fakeGetClient(calls), {
      group_slug: "home",
      slug: "soup",
    });

    expect(calls).toEqual(["/api/explore/groups/home/recipes/soup"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "r1", slug: "soup", name: "Soup", rating: 4 });
    expect(body).not.toHaveProperty("recipeIngredient");
    expect(body).not.toHaveProperty("comments");
  });

  it("adds heavy fields back via include", async () => {
    const result = await exploreRecipeGetHandler(fakeGetClient([]), {
      group_slug: "home",
      slug: "soup",
      include: ["comments"],
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toHaveProperty("comments");
    expect(body).not.toHaveProperty("nutrition");
  });

  it("returns everything when detailed", async () => {
    const result = await exploreRecipeGetHandler(fakeGetClient([]), {
      group_slug: "home",
      slug: "soup",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toHaveProperty("recipeIngredient");
    expect(body).toHaveProperty("nutrition");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreRecipeGetHandler(client, { group_slug: "x", slug: "soup" });

    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run to verify failure** — `npx vitest run src/tools/explore/explore-recipe-get.test.ts` → FAIL.

**Step 3: Implement**

`src/tools/explore/explore-recipe-get.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import {
  type ExploreIncludable,
  exploreRecipesPath,
  GROUP_SLUG_DESCRIPTION,
  projectExploreRecipe,
  PUBLIC_GROUP_HINT,
} from "./explore-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  slug: z.string().describe("The recipe slug (from explore_recipe_search results)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims heavy fields; detailed returns everything"),
  include: z
    .array(z.enum(["comments", "nutrition"]))
    .optional()
    .describe("Add specific heavy fields onto the concise view"),
};

type GetArgs = {
  group_slug: string;
  slug: string;
  response_format?: "concise" | "detailed" | undefined;
  include?: ExploreIncludable[] | undefined;
};

/**
 * Handles explore_recipe_get: fetches one public recipe by slug and projects it
 * per response_format (mirrors recipe_get).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (group_slug, slug, response_format, include)
 * @returns An MCP result with the projected recipe (always includes id + slug)
 */
export async function exploreRecipeGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const path = `${exploreRecipesPath(args.group_slug)}/${encodeURIComponent(args.slug)}`;
    const recipe = await client.get<unknown>(path);
    const projected = projectExploreRecipe(
      recipe,
      args.response_format ?? "concise",
      args.include ?? [],
    );
    return jsonResult(projected);
  } catch (error) {
    return errorResult(error, "explore_recipe_get", "Failed to get public recipe");
  }
}

/**
 * Registers the explore_recipe_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreRecipeGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_recipe_get",
    {
      title: "Get Public Recipe",
      description:
        "Fetch a public recipe by slug. Concise by default; use response_format=detailed or " +
        `include=[comments,nutrition] for more. ${PUBLIC_GROUP_HINT}`,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => exploreRecipeGetHandler(client, args),
  );
}
```

**Step 4: Run to verify pass** — `npx vitest run src/tools/explore/explore-recipe-get.test.ts` → PASS.

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/tools/explore/explore-recipe-get.ts src/tools/explore/explore-recipe-get.test.ts
git commit -m "feat(explore): explore_recipe_get — public recipe by slug (concise/detailed + include)"
```

---

## Task 6: `explore_recipe_suggestions`

**Files:**
- Create: `src/tools/explore/explore-recipe-suggestions.ts`
- Test: `src/tools/explore/explore-recipe-suggestions.test.ts`

**Step 1: Write the failing test**

`src/tools/explore/explore-recipe-suggestions.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { exploreRecipeSuggestionsHandler } from "./explore-recipe-suggestions.js";

type Captured = { path: string; query: unknown };

function fakeGetClient(captured: Captured[]) {
  return {
    async get<T>(path: string, query?: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [
          {
            recipe: { id: "r1", slug: "soup", name: "Soup", rating: 5 },
            missingFoods: [{ id: "f1", name: "Leek" }],
            missingTools: [{ id: "t1", name: "Pot" }],
          },
        ],
      } as T;
    },
  };
}

describe("exploreRecipeSuggestionsHandler", () => {
  it("suggests public recipes with concise items and missing names", async () => {
    const captured: Captured[] = [];

    const result = await exploreRecipeSuggestionsHandler(fakeGetClient(captured), {
      group_slug: "home",
      foods: ["f2"],
      limit: 5,
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/recipes/suggestions");
    expect(captured[0]?.query).toMatchObject({ foods: ["f2"], limit: 5 });
    expect(captured[0]?.query).not.toHaveProperty("group_slug");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([
      {
        recipe: { id: "r1", slug: "soup", name: "Soup" },
        missingFoods: ["Leek"],
        missingTools: ["Pot"],
      },
    ]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreRecipeSuggestionsHandler(client, { group_slug: "nope" });

    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run to verify failure** — `npx vitest run src/tools/explore/explore-recipe-suggestions.test.ts` → FAIL.

**Step 3: Implement**

`src/tools/explore/explore-recipe-suggestions.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import {
  exploreRecipesPath,
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
} from "./explore-projection.js";

type SuggestionResponse = components["schemas"]["RecipeSuggestionResponse"];
/** Minimal client surface the handler needs (eases test fakes). */
type SuggestionsClient = Pick<MealieClient, "get">;

const inputSchema = {
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  foods: z.array(z.string()).optional().describe("Food ids you have on hand"),
  tools: z.array(z.string()).optional().describe("Tool ids you have on hand"),
  limit: z.number().int().positive().optional().describe("Max number of suggestions"),
  maxMissingFoods: z.number().int().min(0).optional().describe("Allow up to N missing foods"),
  maxMissingTools: z.number().int().min(0).optional().describe("Allow up to N missing tools"),
  orderBy: z.string().optional().describe("Field to sort by"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

type SuggestionsArgs = {
  group_slug: string;
  foods?: string[] | undefined;
  tools?: string[] | undefined;
  limit?: number | undefined;
  maxMissingFoods?: number | undefined;
  maxMissingTools?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles explore_recipe_suggestions: recommends a public group's recipes given
 * foods/tools on hand (mirrors recipe_suggestions).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated query arguments (group_slug + suggestion filters)
 * @returns An MCP result with concise suggestions, or an error result
 */
export async function exploreRecipeSuggestionsHandler(
  client: SuggestionsClient,
  args: SuggestionsArgs,
): Promise<CallToolResult> {
  try {
    const response = await client.get<SuggestionResponse>(
      `${exploreRecipesPath(args.group_slug)}/suggestions`,
      toQuery(args),
    );
    return jsonResult({ items: response.items.map(toConcise) });
  } catch (error) {
    return errorResult(error, "explore_recipe_suggestions", "Failed to suggest public recipes");
  }
}

/** Builds the query params — group_slug stays in the path, never the query. */
function toQuery(args: SuggestionsArgs): Record<string, unknown> {
  return {
    foods: args.foods,
    tools: args.tools,
    limit: args.limit,
    maxMissingFoods: args.maxMissingFoods,
    maxMissingTools: args.maxMissingTools,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
  };
}

/** Projects a suggestion item to a concise recipe ref + missing-food/tool names. */
function toConcise(item: SuggestionResponse["items"][number]): Record<string, unknown> {
  const recipe = item.recipe as { id?: unknown; slug?: unknown; name?: unknown };
  return {
    recipe: { id: recipe.id, slug: recipe.slug, name: recipe.name },
    missingFoods: item.missingFoods.map((food) => food.name),
    missingTools: item.missingTools.map((tool) => tool.name),
  };
}

/**
 * Registers the explore_recipe_suggestions tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreRecipeSuggestions(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_recipe_suggestions",
    {
      title: "Suggest Public Recipes",
      description:
        "Suggest recipes from a public group given foods/tools you have on hand. Returns " +
        `concise items plus any missing foods/tools. ${PUBLIC_GROUP_HINT}`,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => exploreRecipeSuggestionsHandler(client, args),
  );
}
```

**Step 4: Run to verify pass** — `npx vitest run src/tools/explore/explore-recipe-suggestions.test.ts` → PASS.

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/tools/explore/explore-recipe-suggestions.ts src/tools/explore/explore-recipe-suggestions.test.ts
git commit -m "feat(explore): explore_recipe_suggestions — public suggestions by foods/tools on hand"
```

---

## Task 7: Wiring — registrar, server conditional, server.test axis

**Files:**
- Create: `src/tools/explore/index.ts`
- Modify: `src/server.ts` (import + conditional after admin)
- Modify: `src/server.test.ts` (EXPLORE_READS, ALL_OPTIN, EXPLORE set, ALL set → six, 3 new tests, composition test → 121)

**Step 1: Extend `src/server.test.ts` (failing first)**

After `ADMIN_WRITES` (~line 194):

```typescript
/** Explore is all reads — there is deliberately NO EXPLORE_WRITES array (design §6). */
const EXPLORE_READS = [
  "explore_recipe_search",
  "explore_recipe_get",
  "explore_recipe_suggestions",
  "explore_list",
  "explore_get",
];
```

In `ALL_OPTIN`, append `...EXPLORE_READS`. In the describe block add `const EXPLORE: ReadonlySet<ToolsetName> = new Set(["explore"]);` and grow `ALL` to all six (`"explore"` added). Update the composition test:

```typescript
  it("composes orthogonally — all six toolsets enabled (121 full)", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: ALL });

    for (const tool of ALL_OPTIN) expect(names).toContain(tool);
    // 66 default + 13 households/automation + 12 groups + 8 users + 17 admin + 5 explore = 121
    expect(names).toHaveLength(121);
  });
```

New tests (after the admin trio):

```typescript
  it("exposes only the explore tools when explore is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: EXPLORE });

    for (const tool of EXPLORE_READS) expect(names).toContain(tool);
    for (const tool of [
      ...HOUSEHOLDS_READS,
      ...HOUSEHOLDS_WRITES,
      ...AUTOMATION_READS,
      ...AUTOMATION_WRITES,
      ...GROUPS_READS,
      ...GROUPS_WRITES,
      ...USERS_READS,
      ...USERS_WRITES,
      ...ADMIN_READS,
      ...ADMIN_WRITES,
    ]) {
      expect(names).not.toContain(tool);
    }
  });

  it("adds exactly 5 opt-in tools (71 full) when explore is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: EXPLORE });

    // 66 default + 5 explore reads + 0 explore writes = 71
    expect(names).toHaveLength(71);
  });

  it("keeps every explore tool under read-only (31 reads) — explore has no writes to strip", async () => {
    const names = await listToolNames({ readOnly: true, toolsets: EXPLORE });

    // The first toolset that fully survives read-only: all 5 explore tools remain.
    for (const tool of EXPLORE_READS) expect(names).toContain(tool);
    // 26 default reads + 5 explore reads; nothing stripped from explore itself
    expect(names).toHaveLength(31);
  });
```

**Step 2: Run to verify failure** — `npx vitest run src/server.test.ts` → FAIL (explore tools absent; counts off).

**Step 3: Implement**

`src/tools/explore/index.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerExploreGet } from "./explore-get.js";
import { registerExploreList } from "./explore-list.js";
import { registerExploreRecipeGet } from "./explore-recipe-get.js";
import { registerExploreRecipeSearch } from "./explore-recipe-search.js";
import { registerExploreRecipeSuggestions } from "./explore-recipe-suggestions.js";

/**
 * Registers the explore toolset — the public, unauthenticated browse surface
 * (/api/explore/groups/{group_slug}/...). All five tools are reads, so there is
 * no read-only split and the registrar takes no options (registerAppTools
 * precedent); the toolset fully survives MEALIE_READ_ONLY.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerExploreTools(server: McpServer, client: MealieClient): void {
  registerExploreRecipeSearch(server, client);
  registerExploreRecipeGet(server, client);
  registerExploreRecipeSuggestions(server, client);
  registerExploreList(server, client);
  registerExploreGet(server, client);
}
```

`src/server.ts` — add import (alphabetical: after `registerCookbookTools`, before `registerFoodsUnitsTools`):

```typescript
import { registerExploreTools } from "./tools/explore/index.js";
```

and the conditional after the admin block:

```typescript
  if (options.toolsets.has("explore")) {
    registerExploreTools(server, client);
  }
```

**Step 4: Run to verify pass** — `npx vitest run src/server.test.ts src/config.test.ts` → PASS (all counts: 26/66 unchanged, 71, 31, 121).

**Step 5: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add src/tools/explore/index.ts src/server.ts src/server.test.ts
git commit -m "feat(explore): wire registrar (no options — all reads) + server.test axis (71 full / 31 read-only / 121 all-six)"
```

---

## Task 8: Real-stdio subprocess spot-check (throwaway, not committed)

**Step 1:** Build, then run a throwaway MCP-over-stdio tool count for the three env combos:

```bash
npm run build
cat > /tmp/explore-stdio-check.mjs <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function countTools(extraEnv) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, MEALIE_URL: "https://m.test", MEALIE_API_TOKEN: "tok", ...extraEnv },
  });
  const client = new Client({ name: "check", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name);
}

const dflt = await countTools({});
const explore = await countTools({ MEALIE_TOOLSETS: "explore" });
const exploreRo = await countTools({ MEALIE_TOOLSETS: "explore", MEALIE_READ_ONLY: "true" });
console.log("default:", dflt.length, "| explore:", explore.length, "| explore+ro:", exploreRo.length);
console.log("explore tools survive read-only:",
  ["explore_recipe_search", "explore_recipe_get", "explore_recipe_suggestions", "explore_list", "explore_get"]
    .every((n) => exploreRo.includes(n)));
EOF
node /tmp/explore-stdio-check.mjs
```

**Expected output:** `default: 66 | explore: 71 | explore+ro: 31` and `explore tools survive read-only: true`.

**Step 2:** `rm /tmp/explore-stdio-check.mjs`. Nothing to commit.

---

## Task 9: README

**Files:**
- Modify: `README.md:26` (env table — add `explore` token) and after the `admin` section (~line 145) add the `explore` section.

**Step 1: Edit**

Env table row (`MEALIE_TOOLSETS`): extend the example and recognized tokens to `households,automation,groups,users,admin,explore` / add `explore`.

New section after `admin`:

```markdown
### `explore` — Public Recipe Browsing (5 tools)

The **public browse surface** (`/api/explore/groups/{group_slug}/...`) — a read-only window onto a **public** group's recipes, cookbooks, organizers, foods, and households. All five tools are reads, so this is the only toolset that survives `MEALIE_READ_ONLY` intact:

- **Read:** `explore_recipe_search` (recipe_search's filters + a `cookbook` filter), `explore_recipe_get`, `explore_recipe_suggestions`, `explore_list` / `explore_get` (`type: cookbook | category | tag | tool | food | household`)

> Every tool requires `group_slug` — find it in the instance's public URL (`/g/{slug}`), via `group_self_get` (groups toolset), or `admin_about`'s `defaultGroupSlug` (admin toolset). The target group must have public access enabled: **private and nonexistent groups both return the same 404**. Lookups are id-based except households (by household slug) and recipes (by recipe slug) — the public API offers exactly one lookup per type. Foods have no slug, so their concise items are `{id, name, labelId}`.
```

Also grep for stale toolset enumerations: `grep -n "users,admin\|admin\`" README.md` — update any list that enumerates the opt-in tokens.

**Step 2: Gate + commit**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
git add README.md
git commit -m "docs(readme): document MEALIE_TOOLSETS=explore (5 read-only tools, survives read-only)"
```

---

## Task 10: Adversarial review workflow + draft PR

1. Run the multi-lens adversarial review workflow over the full branch diff (lenses: hard-limit compliance [25-line/2-nest/3-param/magic numbers/JSDoc], inventory-vs-implementation fidelity [paths, params, projections vs design §1.1], test quality [AAA, decision-point coverage], security [no secrets, encoding, no writes], docs accuracy [README counts, descriptions]). Fix Majors; fix-or-log Minors as commits.
2. Push and open the **draft PR into `develop`**: title `feat: opt-in explore toolset — public browse surface (PR #11, 259/259)`. Body: what/why, the 15→5 mapping table, test axis (default 26/66 unchanged; explore 71/31; all-six 121), the **owed live-verification note** (demo.mealie.io has no public group — design §6), affected files.
3. Matt reviews + runs `/requesting-code-review`.
```
