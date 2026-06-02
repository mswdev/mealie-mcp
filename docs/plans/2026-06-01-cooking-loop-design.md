# PR #4 Design — The Cooking Loop: Meal Plans + Shopping Lists + Cookbooks

**Date:** 2026-06-01
**Branch:** feature/cooking-loop → develop (PR #4)
**Status:** Approved. Implements three default-enabled domains in one PR, building entirely on the PR #3 write foundation (generic `MealieClient` verbs, `MEALIE_READ_ONLY` switch, `requireConfirmation` confirm gate, shared `jsonResult`/`errorResult`, per-group read/write register split).

This document applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 and finishes the meal_plans / shopping_lists / cookbooks rows of §3.2. Endpoint shapes below were inventoried and **adversarially verified against the committed `src/types/mealie.ts`** (all three domains returned `confirmed: true`, zero corrections).

---

## 1. Scope

One PR (explicit scope decision) covering the daily cooking workflow on top of recipes. The three domains are code-independent in the tool layer (no cross-imports; each domain dir compiles alone), so a single PR carries no internal integration risk while matching the roadmap's grouping.

**Coverage:** **35 endpoints** (meal_plans 12 + shopping_lists 17 + cookbooks 6) → **24 new tools** (9 reads always-on, 15 writes stripped under `MEALIE_READ_ONLY`). All three are **default-enabled** domains.

> **Namespacing note:** all three domains nest under `/api/households/` in Mealie (`/api/households/mealplans`, `/api/households/shopping/lists`, `/api/households/shopping/items`, `/api/households/cookbooks`). We group by **semantic domain** (`mealplan_*`, `shopping_*`, `cookbook_*`), never by URL prefix, per roadmap §1.6.

---

## 2. meal_plans — 8 tools (`src/tools/meal-plans/`)

Two sub-domains share the dir: meal-plan **entries** (`PlanEntry*`) and meal-plan **rules** (`PlanRules*`).

### 2.1 Reads (always on) — 4

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `mealplan_search` | `GET /api/households/mealplans` | paginated `ReadPlanEntry`; `start_date`/`end_date` range filter passthrough + pagination |
| `mealplan_get` | `GET /api/households/mealplans/{id}` | `response_format: concise\|detailed`; **`id` is an integer** (not a UUID) |
| `mealplan_today` | `GET /api/households/mealplans/today` | aggregated read; response body is typed `unknown` upstream → returned verbatim via `jsonResult` |
| `mealplan_rules` | `GET /api/households/mealplans/rules`, `GET .../rules/{id}` | sub-resource **read** tool: `action: list\|get` (rule `id` is a UUID) |

### 2.2 Writes (stripped under read-only) — 4

| Tool | Endpoint(s) | Destructive |
|---|---|---|
| `mealplan_create` | `POST /api/households/mealplans` **+** `POST .../mealplans/random` | — **variant-collapse** via `mode: entry\|random`. `entry` → `CreatePlanEntry` (date, entryType, title, text, recipeId?); `random` → `CreateRandomEntry` (date + entryType only, respects household rules). Both return `ReadPlanEntry` → echo concise. |
| `mealplan_update` | `PUT /api/households/mealplans/{id}` | — `idempotentHint`. **Fetch-merge:** GET `ReadPlanEntry` → merge `changes` → send `UpdatePlanEntry` (the update schema omits `householdId`/`recipe`; the merge drops them). |
| `mealplan_delete` | `DELETE /api/households/mealplans/{id}` | ✅ `confirm` |
| `mealplan_rule_write` | `POST` / `PUT` / `DELETE /api/households/mealplans/rules` | ✅ `confirm` on delete — write-**dispatcher** `action: create\|update\|delete`. Create/update both take `PlanRulesCreate` (day, entryType, queryFilterString). |

> **Rules consolidation:** rules collapse to **read + write-dispatcher** (2 tools) rather than a 5-tool CRUD family — they are a secondary automation sub-resource. meal_plans lands at **8 tools** vs the roadmap's 9–11 target; leaner, same 12/12 coverage.

### 2.3 Verified shape surprises (meal_plans)
- `GET /mealplans/today` returns an **untyped (`unknown`) body** — the handler returns it verbatim and does not assume a shape.
- **Three distinct entry schemas:** `CreatePlanEntry` (create), `UpdatePlanEntry` (update; omits `householdId`/`recipe`, adds `id`/`groupId`/`userId`), `ReadPlanEntry` (read; adds the `recipe` summary). The fetch-merge handles the gap.
- `POST /mealplans/random` is a **create variant** (200, body `CreateRandomEntry`), folded into `mealplan_create`.
- Plan-entry `id` is a **number**; rule `id` is a **UUID string**.
- DELETEs return the deleted object (200 + body); we still return the synthesized `{ deleted: id }` confirmation per convention.

---

## 3. shopping_lists — 11 tools (`src/tools/shopping-lists/`)

Two resources share the dir: shopping **lists** and shopping **items**.

### 3.1 Reads (always on) — 3

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `shopping_list_search` | `GET /api/households/shopping/lists` | paginated `ShoppingListSummary` (no `listItems` in the summary) |
| `shopping_list_get` | `GET .../shopping/lists/{id}` | **aggregated read** — `ShoppingListOut` already bundles `listItems` + `recipeReferences` + `labelSettings`; `response_format: concise\|detailed` |
| `shopping_item_get` | `GET .../shopping/items`, `GET .../shopping/items/{id}` | cross-list item reads: `action: list\|get` |

### 3.2 Writes (stripped under read-only) — 8

| Tool | Endpoint(s) | Destructive |
|---|---|---|
| `shopping_list_create` | `POST .../shopping/lists` | — `ShoppingListCreate` (name) → returns `ShoppingListOut` → echo concise |
| `shopping_list_update` | `PUT .../shopping/lists/{id}` | — `idempotentHint`. Fetch-merge: GET `ShoppingListOut` → merge `changes` → send `ShoppingListUpdate` (requires `id`/`groupId`/`userId`/`listItems`, so the full fetched list is sent back to avoid wiping items). |
| `shopping_list_delete` | `DELETE .../shopping/lists/{id}` | ✅ `confirm` |
| `shopping_list_label_settings` | `PUT .../shopping/lists/{id}/label-settings` | — dedicated write tool (distinct `ShoppingListMultiPurposeLabelUpdate[]` body + endpoint); reorders/assigns the list's label settings |
| `shopping_list_recipe_references` | `POST .../recipe`, `POST .../recipe/{rid}`, `POST .../recipe/{rid}/delete` | — write-**dispatcher** `action: add\|add_by_recipe\|remove`. **`remove` is a POST to a `/delete` path, not a DELETE verb.** `add` uses the non-deprecated bulk endpoint (`ShoppingListAddRecipeParamsBulk[]`, `recipeId` in body); `add_by_recipe` is the deprecated path-based single add; `remove` sends `ShoppingListRemoveRecipeParams` (`recipeDecrementQuantity`). All return `ShoppingListOut`. |
| `shopping_item_create` | `POST .../shopping/items` **+** `POST .../items/create-bulk` | — single+bulk collapse (`item` vs `items`); both take `ShoppingListItemCreate` and return `ShoppingListItemsCollectionOut` |
| `shopping_item_update` | `PUT .../shopping/items/{id}` **+** `PUT .../shopping/items` | — `idempotentHint`. Single (fetch-merge, `ShoppingListItemUpdate`, no `id` in body) + bulk (`ShoppingListItemUpdateBulk[]`, `id` in each) collapse |
| `shopping_item_delete` | `DELETE .../shopping/items/{id}` **+** `DELETE .../shopping/items?ids[]` | ✅ `confirm` — single (path) + bulk (`ids` query array) collapse |

### 3.3 Verified shape surprises (shopping_lists)
- **Bulk item ops return `ShoppingListItemsCollectionOut`** (`createdItems`/`updatedItems`/`deletedItems` arrays), not a single item — including single `POST /items` and `PUT /items/{id}`. Item writes echo a concise count summary of that container.
- **Recipe add/remove use POST, not PUT/DELETE**; remove is `POST .../recipe/{rid}/delete`. The dispatcher must not assume verb semantics from the action name.
- `add` (bulk) carries `recipeId` in each array element; the deprecated single add carries it in the path.
- Item/list **DELETE returns a bare `SuccessResponse`** (`{ message, error }`); bulk item delete takes `ids` as a query-string array.
- `ShoppingListItemOut` has `-Input`/`-Output` variants (different `unit`/`food`/`recipe` typings); the fetch-merge sends the fetched `-Output` items back, matching the recipe_update precedent.

---

## 4. cookbooks — 5 tools (`src/tools/cookbooks/`)

### 4.1 Reads (always on) — 2

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `cookbook_search` | `GET /api/households/cookbooks` | paginated `ReadCookBook` |
| `cookbook_get` | `GET .../cookbooks/{id}` | single `ReadCookBook` |

### 4.2 Writes (stripped under read-only) — 3

| Tool | Endpoint(s) | Destructive |
|---|---|---|
| `cookbook_create` | `POST .../cookbooks` | — `CreateCookBook`: `name` required; `description`/`public`/`queryFilterString`/`position`/`slug` optional with handler-supplied defaults (the generated type marks them required-with-default) |
| `cookbook_update` | `PUT .../cookbooks/{id}` **+** `PUT .../cookbooks` (bulk) | — `idempotentHint`. **Single+bulk collapse:** single (`id` + `changes`, fetch-merge, body `CreateCookBook`) vs bulk (`items: UpdateCookBook[]`, each with `id`/`groupId`/`householdId`). |
| `cookbook_delete` | `DELETE .../cookbooks/{id}` | ✅ `confirm` |

### 4.3 Verified shape surprises (cookbooks)
- **Single update uses `CreateCookBook`** (no id in body, id in path); **bulk update uses `UpdateCookBook[]`** (id/groupId/householdId in each). The collapse keeps both behind one tool.
- DELETE returns the deleted `ReadCookBook` (200 + body); we return `{ deleted: id }` per convention.

---

## 5. Cross-Cutting (reused from the PR #3 foundation)

- **No new `MealieClient` methods.** Every tool uses the existing generic verbs (`get`/`getPaginated`/`post`/`put`/`delete`). **No multipart in this PR.** The client stays strictly 1:1/thin; all consolidation lives in the tool layer.
- **Per-domain concise projection helpers** — `meal-plans/mealplan-projection.ts`, `shopping-lists/shopping-projection.ts`, `cookbooks/cookbook-projection.ts` — mirroring `recipes/recipe-projection.ts` (concise default ≈ ⅓ tokens; `response_format` on the heavy `*_get` reads).
- **Writes echo the affected resource, concise.** Unlike `recipe_create` (bare-slug → re-fetch), these creates/updates return the typed object directly → project concise with no re-fetch. Item writes echo a concise summary of the `ShoppingListItemsCollectionOut` container. Deletes return synthesized `{ deleted: id }`.
- **Confirm gate (handler-enforced) on the 5 hard-deletes** — `mealplan_delete`, `mealplan_rule_write`(delete), `shopping_list_delete`, `shopping_item_delete`, `cookbook_delete` — via the shared `requireConfirmation(confirm, action)`. `shopping_list_recipe_references` `remove` and `shopping_list_label_settings` are non-destructive list edits (no confirm).
- **Annotations:** `readOnlyHint` on reads; `destructiveHint:true` + `confirm` on the hard-deletes; `idempotentHint:true` on every PUT-style update; `openWorldHint:true` globally (Mealie is an external HTTP API).
- **Update bodies typed against `components["schemas"][...]`** for compile-time contract checks; surface Mealie's error body verbatim via `errorResult` (already carried by `MealieApiError`).

---

## 6. File Organization

Each domain is a **flat directory** with one tool per file (+ colocated `.test.ts`), one `index.ts` applying the read/write split, and one projection helper. Every dir is well under the 20-source-file cap — **no recipes-style subdivision** (that was forced only because recipes hit 24 source files).

```
src/tools/meal-plans/      (9 source files)   index.ts, mealplan-projection.ts,
                                              mealplan-{search,get,today,create,update,delete}.ts,
                                              mealplan-rules.ts, mealplan-rule-write.ts
src/tools/shopping-lists/  (13 source files)  index.ts, shopping-projection.ts,
                                              shopping-list-{search,get,create,update,delete}.ts,
                                              shopping-list-label-settings.ts,
                                              shopping-list-recipe-references.ts,
                                              shopping-item-{get,create,update,delete}.ts
src/tools/cookbooks/       (7 source files)   index.ts, cookbook-projection.ts,
                                              cookbook-{search,get,create,update,delete}.ts
```

Each `index.ts` exports `register<Domain>Tools(server, client, { readOnly })` (registers reads unconditionally, writes only when `!readOnly`) — and `createServer` gains three calls: `registerMealPlanTools`, `registerShoppingTools`, `registerCookbookTools`. Imports flow downward only.

---

## 7. Testing

- **Per-handler unit tests** with hand-written `MealieClient` fakes (generic `async <T>(): Promise<T>` methods, per strict TS). Cover: path/body/query mapping; dispatcher action routing + `missing(field)` guards; the **confirm gate** (missing → `isError`, present → proceeds); variant-collapse branches (entry/random, single/bulk, list/get); fetch-merge preserves untouched fields; concise projection; `isError` on client throw.
- **`server.test.ts` (read-only e2e) MUST be extended:** add all 24 new tool names to the `WRITE_TOOLS` (15) / `READ_TOOLS` (9) arrays and update the hard-coded length assertions — **read-only `10 → 19`, full `24 → 48`**. This is the easy-to-miss gate item (the test currently hard-codes "14 write tools").
- **Real-stdio subprocess checks** (carried forward): tool-list over stdio, plus a real tool-CALL (`get_about` success + a 401 error path). `demo.mealie.io/api/app/about` is 200 but household endpoints are 401 without a token, so the new tools can't be live-tested here — covered by unit fakes; **real-instance testing remains owed** and noted in the PR.
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` — confirm exit code 0 (empty lint output ≠ pass; use `npx biome check --write src/` to auto-fix import-member ordering).

---

## 8. Process

- Branch `feature/cooking-loop` off `develop`; **draft** PR into `develop`.
- Built foundation/archetype-first via sequential TDD in the main loop (shared per-domain `index.ts` + per-step quality gate make parallelism unsafe): cookbooks (smallest, proves the plain-CRUD + single/bulk-collapse archetypes) → meal_plans (variant-collapse create + sub-resource read/write-dispatcher) → shopping_lists (largest, item-collection echoes + the recipe-references dispatcher). Each tool behind the quality gate.
- An adversarial multi-lens code-review pass before hand-off for human review.

---

## 9. Sources
- Adversarially-verified endpoint inventory (3 domains × inventory + skeptic verify) against the committed `src/types/mealie.ts` — all `confirmed: true`, zero corrections.
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1, §3.2.
- Write foundation + cross-cutting conventions: [`2026-05-31-recipe-write-tools-design.md`](./2026-05-31-recipe-write-tools-design.md) §3–§6.
