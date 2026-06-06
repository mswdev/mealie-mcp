# PR #11 Design — Opt-in: Explore (final coverage PR)

**Status:** Approved (Matt, 2026-06-06)
**Branch:** `feature/explore` → draft PR into `develop`
**Roadmap:** §3.2 explore row — 15 ops, `explore_*`, ~5 tools, opt-in. After this PR, **259/259 operations are mapped**.

Decisions settled in brainstorm:

- **group_slug discovery story**: full, on every tool (public URL `/g/{slug}` + `group_self_get` + `admin_about.defaultGroupSlug`).
- **Search params**: mirror `recipe_search`'s 9 + add the browse-relevant `cookbook` filter.
- **Tool shape**: 5 tools (approach A) — recipe trio first-class + variant-collapse for the 6 parallel catalog resources.
- **Path segments are `encodeURIComponent`-ed** (deliberate convention deviation, see §4.3).

## 1. Scope

The public, unauthenticated browse surface: `GET /api/explore/groups/{group_slug}/...`. All 15 ops verified against `src/types/mealie.ts` (workflow-inventoried, adversarially re-derived):

- **All 15 are GET-only.** Every other HTTP method on every explore path block is typed `never`. Zero writes anywhere under `/api/explore`.
- **No auth/security params.** The only header is an optional `accept-language` (i18n) — not exposed; the client's Bearer token is harmlessly accepted.
- **One lookup mode per resource, no alternates**: catalog gets (cookbook/category/tag/tool/food) are `item_id`-only; household get is `household_slug`-only; recipe get is `recipe_slug`-only. There are no `/slug/` variant paths on the public surface.
- **Requires a public group**: Mealie returns an identical `404 {"detail": "group not found"}` for a nonexistent group AND an existing-but-private group (live-probe verified). Tool descriptions carry the disambiguation hint.

### 1.1 The 15 ops → 5 tools

| # | Endpoint (`/api/explore/groups/{group_slug}` +) | 200 schema (verbatim) | Shape | Tool |
|---|---|---|---|---|
| 1 | `/recipes` | `PaginationBase_RecipeSummary_` | envelope | `explore_recipe_search` |
| 2 | `/recipes/suggestions` | `RecipeSuggestionResponse` | `{items}` wrapper | `explore_recipe_suggestions` |
| 3 | `/recipes/{recipe_slug}` | `Recipe-Output` | single | `explore_recipe_get` |
| 4 | `/cookbooks` | `PaginationBase_ReadCookBook_` | envelope | `explore_list` |
| 5 | `/cookbooks/{item_id}` | `ReadCookBook` | single | `explore_get` |
| 6 | `/organizers/categories` | `PaginationBase_RecipeCategory_` | envelope | `explore_list` |
| 7 | `/organizers/categories/{item_id}` | `CategoryOut` | single | `explore_get` |
| 8 | `/organizers/tags` | `PaginationBase_RecipeTag_` | envelope | `explore_list` |
| 9 | `/organizers/tags/{item_id}` | `TagOut` | single | `explore_get` |
| 10 | `/organizers/tools` | `PaginationBase_RecipeTool_` | envelope | `explore_list` |
| 11 | `/organizers/tools/{item_id}` | `RecipeToolOut` | single | `explore_get` |
| 12 | `/foods` | `PaginationBase_IngredientFood_` | envelope | `explore_list` |
| 13 | `/foods/{item_id}` | `IngredientFood-Output` | single | `explore_get` |
| 14 | `/households` | `PaginationBase_HouseholdSummary_` | envelope | `explore_list` |
| 15 | `/households/{household_slug}` | `HouseholdSummary` | single | `explore_get` |

Inventory facts the implementation leans on:

- **Query params on every explore op are identical to its authed twin** (plus the required `group_slug` path param). The five catalog lists share the same 8 params (`search`, `orderBy`, `orderByNullPosition`, `orderDirection`, `queryFilter`, `paginationSeed`, `page`, `perPage`); **the households list has NO `search` param** (7 params).
- The explore list envelopes differ from their authed twins **in schema name only** (`PaginationBase_X_` vs `XPagination`) — structurally identical, so `client.getPaginated` normalizes them unchanged.
- The explore get-one organizer schemas genuinely differ from their authed twins (`CategoryOut` has `groupId`; `TagOut` lacks `RecipeTagResponse`'s `recipes[]`; `RecipeToolOut` vs `RecipeTool` optionality) — irrelevant to us beyond projection, since concise fields exist in all.
- **Foods have no `slug` field** (`IngredientFood-Output`); their concise projection is `{id, name, labelId}`, mirroring `food_search`.
- `page`/`perPage` carry NO defaults on the request ops (the `@default 1`/`@default 10` live on the response envelope schemas) — the tool supplies its own `DEFAULT_PER_PAGE = 20`, as everywhere else.

## 2. Reuse the PR #7 toolset switch (no new mechanism — 5th reuse)

- `config.ts`: `KNOWN_TOOLSETS = [..., "explore"]` — one line. Folded into the first feature commit (Biome makes a token-only edit uncommittable standalone anyway).
- `server.ts`: `if (options.toolsets.has("explore")) registerExploreTools(server, client);`
- **The registrar takes NO options**: `registerExploreTools(server, client)` — the `registerAppTools` precedent. All 5 tools are reads; an unused `options` param would be a Biome `noUnusedVariables` error and there are no writes to split. Consequence: **explore is the first opt-in toolset that fully survives `MEALIE_READ_ONLY`**.

## 3. The 5 tools (`src/tools/explore/`, flat)

Common to all: required `group_slug` with the full discovery story —

> "Slug of the public group to browse. Find it in the instance's public URL (`/g/{slug}`), via `group_self_get` (groups toolset), or `admin_about`'s `defaultGroupSlug` (admin toolset)."

— and a description noting the surface needs the group to be **public** (private and nonexistent groups both 404). Annotations: `readOnlyHint: true` + `openWorldHint: true` on all; `idempotentHint: true` on search/list.

### 3.1 `explore_recipe_search` — op 1

Params: `group_slug` + `recipe_search`'s 9 (`search`, `page`, `perPage` [default 20, max 100], `orderBy`, `orderDirection`, `categories[]`, `tags[]`, `tools[]`, `foods[]`) + **`cookbook`** (string; cookbook id or slug — the "browse this public cookbook's recipes" loop with `explore_list type=cookbook`). Upstream accepts all of these verbatim (verified identical to authed `/api/recipes`).
Returns concise `{id, slug, name}` items + pagination meta via `getPaginated`.

### 3.2 `explore_recipe_get` — op 3

Params: `group_slug`, `slug`, `response_format` (`concise` default | `detailed`), `include=[comments, nutrition]`. Mirrors `recipe_get` exactly, with explore's own copy of the concise-field list (see §4.1).

### 3.3 `explore_recipe_suggestions` — op 2

Params: `group_slug` + `recipe_suggestions`' 7 (`foods[]`, `tools[]`, `limit`, `maxMissingFoods`, `maxMissingTools`, `orderBy`, `orderDirection`). Response is the `{items}` wrapper → concise `{recipe: {id, slug, name}, missingFoods: names[], missingTools: names[]}`, mirroring `recipe_suggestions`.

### 3.4 `explore_list` — ops 4, 6, 8, 10, 12, 14 (variant-collapse, `organizer_search` precedent)

Params: `type` (`cookbook | category | tag | tool | food | household`), `group_slug`, `search`, `page`, `perPage` (default 20, max 100), `orderBy`, `orderDirection`.
**Guard:** `type=household` + `search` → explicit error result ("search is not supported for households") — the upstream households list has no `search` param; we do not rely on upstream ignoring it. Mirrors `organizer_search`'s `empty_only`-for-tool guard.
Returns per-type concise items + pagination meta.

### 3.5 `explore_get` — ops 5, 7, 9, 11, 13, 15

Params: `type` (same 6), `group_slug`, `id`, `response_format` (`concise` default | `detailed`).
**Lookup mode is routed by type, no `by_slug` flag**: five catalog types treat `id` as the item id (uuid); `household` treats it as the household slug (the only public lookup Mealie offers). The `id` description states this.
Returns per-type concise projection or the full object.

## 4. Cross-Cutting

### 4.1 `explore-projection.ts` (self-contained — sibling cross-imports forbidden)

- `EXPLORE_TYPES = ["cookbook", "category", "tag", "tool", "food", "household"] as const` + `ExploreType`.
- `exploreBasePath(type, groupSlug)` → `/api/explore/groups/{slug}/` + per-type segment (`cookbooks`, `organizers/categories`, `organizers/tags`, `organizers/tools`, `foods`, `households`). Irregular segments live in a lookup map (no naive pluralization).
- `projectExploreItem(item, type, format)`: concise = `[id, slug, name]` for five types, `[id, name, labelId]` for `food`; `detailed` passes through.
- `EXPLORE_RECIPE_CONCISE_FIELDS` + `projectExploreRecipe(recipe, format, include)`: explore's own copy of `recipe-projection.ts`'s concise list + include add-backs. Duplication is deliberate — imports may not reach into `recipes/`.

### 4.2 Foundation reused (no new `MealieClient` methods)

Generic `get`/`getPaginated` cover all 15 ops. The Bearer token is sent as always — explore endpoints accept-and-ignore auth; same configured instance, no client change. The `accept-language` header is not exposed (YAGNI; nothing else exposes it either).

### 4.3 Path-segment encoding (deliberate deviation, flagged in review)

Explore handlers `encodeURIComponent` every interpolated path segment (`group_slug`, `id`, recipe `slug`). Existing tools interpolate raw; explore's params are explicitly "externally discovered" strings, so the encoding is cheap defense-in-depth and a no-op for valid slugs/uuids.

### 4.4 Error handling

`errorResult` on every catch (logs + `isError: true`, never throws). The 404-ambiguity hint lives in tool descriptions, not in error rewriting.

## 5. File Organization

```
src/tools/explore/            (7 source files — under the 20 cap, flat)
  index.ts                    registerExploreTools(server, client) — NO options
  explore-projection.ts       types, paths, projections (+ test)
  explore-recipe-search.ts    (+ test)
  explore-recipe-get.ts       (+ test)
  explore-recipe-suggestions.ts (+ test)
  explore-list.ts             (+ test)
  explore-get.ts              (+ test)
```

## 6. Testing

- **Unit** (hand-written fakes, generic `async <T>(): Promise<T>`): per-tool happy path + error path; projection tests (path building ×6 incl. encoding, food `labelId`, include add-backs); the household+search guard; pagination passthrough.
- **`server.test.ts` axis** (the new read-only case is the point):
  - `EXPLORE_READS` (5 names); **no `EXPLORE_WRITES` array exists**.
  - default **26/66 unchanged**;
  - explore-on full = **71**;
  - explore + read-only = **31** — explicit assertion that **all 5 explore tools survive read-only** (first toolset where read-only strips nothing);
  - all-SIX composition = **121** (full) — grown from all-five 116.
- **Real-stdio subprocess spot-check** (throwaway): default vs `MEALIE_TOOLSETS=explore` vs explore+read-only tool counts.
- **Live testing: not feasible** — demo.mealie.io probe: instance up (`nightly`, demo mode) but `defaultGroupSlug=null`, ~16 slug guesses all 404, and Mealie's 404 cannot distinguish private from nonexistent. Explore needs an already-public group; mutating the shared demo is unacceptable. **Owed:** live read round-trips against a real public group, noted in the PR description (same owed-note convention as prior PRs).
- Quality gate before every commit: `npm run build && npm run typecheck && npm run test && npm run lint`.

## 7. Process

Sequential TDD in the main loop, archetype-first: projection file → `explore_list` (archetype) → `explore_get` → `explore_recipe_search` → `explore_recipe_get` → `explore_recipe_suggestions` → wiring/e2e (config token folded into first feature commit) → README. Adversarial multi-lens review workflow before the draft PR into `develop`.

## 8. Sources

- `src/types/mealie.ts` — paths 2920–3174, operations 16756–17340 (workflow-inventoried 2026-06-06, adversarially verified; 2 minor inventory claims refuted and corrected, zero schema-fact errors surviving).
- Precedents: `src/tools/organizers/` (variant-collapse), `src/tools/app/index.ts` (no-options registrar), `src/tools/recipes/core/recipe-{search,get,suggestions}.ts` (param mirrors), `docs/plans/2026-06-02-catalog-primitives-design.md`, `docs/plans/2026-06-06-admin-design.md` (doc/process archetype).
- Live probe: demo.mealie.io, 2026-06-06.
