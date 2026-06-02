# PR #5 Design — Catalog Primitives: Organizers + Foods/Units

**Date:** 2026-06-02
**Branch:** feature/catalog-primitives → develop (PR #5)
**Status:** Approved (scope confirmed: one PR). Implements two default-enabled domains on the PR #3 write foundation (generic `MealieClient` verbs, `MEALIE_READ_ONLY` switch, `requireConfirmation` confirm gate, shared `jsonResult`/`errorResult`, per-domain read/write register split).

This document applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 and finishes the **organizers** and **foods_units** rows of §3.2. Every endpoint shape below was inventoried and **adversarially verified against the committed `src/types/mealie.ts`** (5 resources × inventory + skeptic verify; all `confirmed: true`, **zero corrections**), then the highest-stakes facts were independently re-checked against source (merge bodies, the create-schema required-with-default sets, the tool/category plurals).

These are the **shared taxonomy** that recipes/meal-plans/shopping-lists *reference* — recipe filters take category/tag/tool, shopping items take `foodId`/`unitId`. So these reads enable the name→id resolution earlier PRs deferred. (Note: `MultiPurposeLabels` are **not** here — they live in the groups domain, PR #8 — even though shopping label-settings uses `labelId`.)

---

## 1. Scope

One PR (explicit scope decision, matching #3/#4). The two domains are code-independent in the tool layer (no cross-imports; each dir compiles alone), so a single PR carries no internal integration risk while matching the roadmap's PR #5 grouping. Together they **complete the default-enabled tool surface**.

**Coverage:** **32 endpoints** (organizers 20 + foods_units 12) → **17 new tools** (6 reads always-on, 11 writes stripped under `MEALIE_READ_ONLY`). Both domains **default-enabled**.

| Domain | Endpoints | Tools | Reads | Writes |
|---|---:|---:|---:|---:|
| organizers (`organizer_*`) | 20 | 5 | 2 | 3 |
| foods_units (`food_*` / `unit_*`) | 12 | 12 | 4 | 8 |
| **Total** | **32** | **17** | **6** | **11** |

---

## 2. organizers — 5 tools (`src/tools/organizers/`)

The headline collapse: **three near-parallel resources** (categories, tags, tools) behind a `type: category | tag | tool` discriminator → **20 endpoints → 5 tools**, the biggest collapse in the roadmap.

> **Path note — irregular plurals.** Base path is `/api/organizers/${PATHS[type]}` with an explicit map `{ category: "categories", tag: "tags", tool: "tools" }` (never naive `type + "s"` — that yields `categorys`).

### 2.1 Reads (always on) — 2

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `organizer_search` | `GET /{type}s` **+** `GET /{type}s/empty` | Paginated (every list returns a `*Pagination` envelope). `empty_only:true` routes to `/{type}s/empty` — **valid only for `category`/`tag`** (`tool` has no `/empty` → `isError`). The empty endpoints are **un-enveloped** (categories→`CategoryBase[]`, tags→`unknown`) so that branch returns a bare `{ items, count }`, not pagination meta. |
| `organizer_get` | `GET /{type}s/{item_id}` **+** `GET /{type}s/slug/{slug}` | `id` (default) or slug via `by_slug:true`. Generic concise projection (`id`/`slug`/`name`) works across all per-type response shapes; `detailed` returns whole. |

### 2.2 Writes (stripped under read-only) — 3

| Tool | Endpoint(s) | Destructive |
|---|---|---|
| `organizer_create` | `POST /{type}s` | — **Per-type typed body**: `category`→`CategoryIn`, `tag`→`TagIn` (both `{ name }`), `tool`→`RecipeToolCreate` (`{ name, householdsWithTool }`, default `[]`). |
| `organizer_update` | `PUT /{type}s/{item_id}` | — `idempotentHint`. **Fetch-merge** (GET → merge `changes` → PUT the full object). Update reuses the create schema (no `Update*` schema; PUT is full-replace), so the merge is **required for `tool`** to avoid silently resetting `householdsWithTool`; harmless for category/tag (`{ name }` only). |
| `organizer_delete` | `DELETE /{type}s/{item_id}` | ✅ `confirm` — `destructiveHint`. Returns synthesized `{ deleted: id }` (tool returns the entity; category/tag return untyped 200). |

### 2.3 Verified contract surprises (organizers)

- **`organizer_get` returns per-type shapes** — by-id: category→`CategorySummary`, tag→`RecipeTagResponse` (with `recipes[]`), tool→`RecipeTool` (no recipes); by-slug: category→`unknown`, tag→`RecipeTagResponse`, tool→`RecipeToolResponse` (adds `recipes[]`). The generic `{id,slug,name}` concise projection is uniform across all of them; `detailed` passes through whatever Mealie sent. **Recipe-association is not the focus of `organizer_get`** — to list recipes for an organizer, use `recipe_search(categories|tags|tools=[...])`. (The by-id doc comments claim "returns a list of recipes…" — the generated types show that is **misleading**; by-id carries no recipe list except tag's `RecipeTagResponse`.)
- **Create/update bodies diverge** — `CategoryIn`/`TagIn` are shape-identical but distinct named schemas; `RecipeToolCreate` genuinely adds `householdsWithTool`. The handler branches on `type` to build the typed body.
- **Untyped (`unknown`) responses** to handle defensively (project generically off the record, don't assume a named schema): category create(201)/delete(200)/get-by-slug(200); tag create(201)/empty(200)/delete(200).
- **`RecipeTool.groupId`** is optional+nullable while `RecipeToolResponse`/`RecipeToolOut.groupId` are required — do **not** reuse `RecipeToolOut` (it's referenced only by an explore endpoint).

---

## 3. foods_units — 12 tools (`src/tools/foods-units/`)

Two resources share one dir (mirroring `meal-plans/` = entries+rules and `shopping-lists/` = lists+items). Kept as **separate `food_*` / `unit_*` namespaces** per roadmap §1.2 — their bodies genuinely differ (units carry `fraction`/`abbreviation`/`useAbbreviation`; foods carry `labelId`/`onHand`), so distinct typed tools serve agents better than an awkward union. Each family is a plain CRUD set + a `merge`.

### 3.1 Reads (always on) — 4

| Tool | Endpoint | Notes |
|---|---|---|
| `food_search` | `GET /api/foods` | paginated `IngredientFoodPagination` (items `IngredientFood-Output`) |
| `food_get` | `GET /api/foods/{item_id}` | `response_format: concise\|detailed` |
| `unit_search` | `GET /api/units` | paginated `IngredientUnitPagination` (items `IngredientUnit-Output`) |
| `unit_get` | `GET /api/units/{item_id}` | `response_format: concise\|detailed` |

### 3.2 Writes (stripped under read-only) — 8

| Tool | Endpoint | Body / Destructive |
|---|---|---|
| `food_create` | `POST /api/foods` | `CreateIngredientFood`; required-with-default supplied: `description:""`, `extras:{}`, `aliases:[]`, `householdsWithIngredientFood:[]` (`name` required). |
| `food_update` | `PUT /api/foods/{item_id}` | `idempotentHint`. **Fetch-merge required** — PUT full-replace reuses `CreateIngredientFood`; a partial PUT would silently reset unsupplied required-with-default fields (same bug class as commit `7ae5ace`). |
| `food_merge` | `PUT /api/foods/merge` | ✅ `confirm`, `destructiveHint`. `MergeFood { fromFood, toFood }` (uuid4, **not** `fromId`/`toId`). Combines `fromFood` into `toFood`; returns `SuccessResponse`. |
| `food_delete` | `DELETE /api/foods/{item_id}` | ✅ `confirm`. Returns the deleted `IngredientFood-Output` → synthesized `{ deleted: id }`. |
| `unit_create` | `POST /api/units` | `CreateIngredientUnit`; required-with-default supplied: `description:""`, `extras:{}`, `fraction:true`, `abbreviation:""`, `pluralAbbreviation:""`, `useAbbreviation:false`, `aliases:[]` (`name` required). |
| `unit_update` | `PUT /api/units/{item_id}` | `idempotentHint`. **Fetch-merge required** (same silent-reset risk; `CreateIngredientUnit` has 7 required-with-default fields). |
| `unit_merge` | `PUT /api/units/merge` | ✅ `confirm`, `destructiveHint`. `MergeUnit { fromUnit, toUnit }`. Returns `SuccessResponse`. |
| `unit_delete` | `DELETE /api/units/{item_id}` | ✅ `confirm`. Returns the deleted `IngredientUnit-Output` → `{ deleted: id }`. |

### 3.3 Verified contract surprises (foods_units)

- **No `Update*` schema** — both PUT updates reuse the create schema (full replace). Hence the **mandatory fetch-merge** on `food_update`/`unit_update`.
- **`merge` is PUT, not POST**, and returns a bare `SuccessResponse` (`{ message, error }`), not the entity. Field names are `from<Entity>`/`to<Entity>`.
- **Hyphenated schema keys** — `IngredientFood-Output` / `IngredientUnit-Output`: the `-Output` suffix is part of the (quoted) key; reference it exactly.
- **Unit aliases** use `CreateIngredientUnitAlias[]` (input, single `name`) vs `IngredientUnitAlias[]` (output) — input aliases are `{ name }`.
- All ids are **uuid4 strings** (path params typed plain `string`; entity `id` carries `Format: uuid4`).

---

## 4. Cross-Cutting (reused from the PR #3/#4 foundation)

- **No new `MealieClient` methods.** Every tool uses the existing generic verbs (`getPaginated`/`get`/`post`/`put`/`delete`). `merge` is an ordinary `put` to a `/merge` path. No multipart. The client stays strictly 1:1/thin; all consolidation lives in the tool layer.
- **Per-domain concise projection helpers** — `organizers/organizer-projection.ts`, `foods-units/food-projection.ts`, `foods-units/unit-projection.ts` — mirroring `recipes/recipe-projection.ts`. `response_format: concise|detailed` on the `*_get` reads (concise ≈ ⅓ tokens).
- **Writes echo the affected resource, concise** (no re-fetch — these creates/updates return the typed object directly). Deletes return synthesized `{ deleted: id }`; merges return the `SuccessResponse` (or a synthesized `{ merged: { from, to } }`).
- **Confirm gate (handler-enforced, BEFORE the try) on the 5 destructive ops** — `organizer_delete`, `food_merge`, `food_delete`, `unit_merge`, `unit_delete` — via shared `requireConfirmation(confirm, action)`.
- **Annotations:** `readOnlyHint` on reads (+`idempotentHint` on `*_search`); `destructiveHint:true` + `confirm` on the 5 destructive ops; `idempotentHint:true` on every PUT-style update (`*_update`); `openWorldHint:true` globally. **Merge is `destructiveHint`, NOT `idempotentHint`.**
- **Bodies typed against `components["schemas"][...]`** when constructed from known args (creates supply required-with-default fields; merges are typed `MergeFood`/`MergeUnit`). Surface Mealie's error body verbatim via `errorResult` (carried by `MealieApiError`).

---

## 5. File Organization

Flat dirs, one tool per file (+ colocated `.test.ts`), one `index.ts` applying the read/write split, per-domain projection helper(s). Both dirs are under the 20-source-file cap.

```
src/tools/organizers/      (7 source)   index.ts, organizer-projection.ts,
                                        organizer-{search,get,create,update,delete}.ts
src/tools/foods-units/     (15 source)  index.ts, food-projection.ts, unit-projection.ts,
                                        food-{search,get,create,update,merge,delete}.ts,
                                        unit-{search,get,create,update,merge,delete}.ts
```

`organizers/index.ts` exports `registerOrganizerTools(server, client, { readOnly })`; `foods-units/index.ts` exports `registerFoodsUnitsTools(server, client, { readOnly })` (registers all 12, writes only when `!readOnly`). `createServer` gains two calls. Imports flow downward only; no sibling cross-imports.

---

## 6. Testing

- **Per-handler unit tests** with hand-written `MealieClient` fakes (generic `async <T>(): Promise<T>` methods, per strict TS). Cover: path/body/query mapping incl. the **irregular plural map**; the `type` discriminator branches (per-type create bodies; `empty_only` valid only for category/tag; `by_slug` routing); the **confirm gate** (missing → `isError`, present → proceeds) on all 5 destructive ops; **fetch-merge preserves untouched required-with-default fields** (the silent-reset regression — explicit test on tool/food/unit update); merge body field names (`fromFood`/`toFood`, `fromUnit`/`toUnit`); concise vs detailed projection; `isError` on client throw.
- **`server.test.ts` (read-only e2e) MUST be extended:** add the 6 reads to `READ_TOOLS` and the 11 writes to `WRITE_TOOLS`, and update the length assertions — **read-only `19 → 25`, full `48 → 65`**. (Reads: `organizer_search/get`, `food_search/get`, `unit_search/get`. Writes: `organizer_create/update/delete`, `food_create/update/merge/delete`, `unit_create/update/merge/delete`.)
- **Real-stdio subprocess check** (carried forward): tools/list full vs read-only counts; `get_about` 200; a 401 path to confirm error surfacing. `demo.mealie.io/api/app/about` is 200 but organizers/foods/units are 401 without a token, so the new **writes can't be live-tested** — covered by unit fakes; **real-instance write testing remains owed** and noted in the PR body.
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` — exit 0 (empty lint output ≠ pass; use `npx biome check --write src/` to auto-fix import-member ordering).

---

## 7. Process

- Branch `feature/catalog-primitives` off `develop`; **draft** PR into `develop`.
- Sequential TDD in the main loop (shared per-domain `index.ts` + per-step quality gate make parallelism unsafe), foundation/archetype-first:
  1. **organizers** first — proves the `type` variant-collapse archetype end-to-end (search incl. empty branch → get incl. by_slug → create per-type bodies → update fetch-merge → delete confirm), wired + tested.
  2. **foods** — plain CRUD + the new `merge` (destructive PUT) + mandatory fetch-merge update.
  3. **units** — same shape (most fields), reusing the food archetype.
  4. Wire both into `createServer`; bump `server.test.ts`; real-stdio check.
- An adversarial multi-lens code-review pass before hand-off for human review.

---

## 8. Sources
- Adversarially-verified endpoint inventory (5 resources × inventory + skeptic verify) against committed `src/types/mealie.ts` — all `confirmed: true`, zero corrections; highest-stakes facts independently re-checked.
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1, §3.2.
- Freshest archetype precedent: [`2026-06-01-cooking-loop-design.md`](./2026-06-01-cooking-loop-design.md) (variant-collapse create, single+bulk collapse, fetch-merge updates, read/write split).
