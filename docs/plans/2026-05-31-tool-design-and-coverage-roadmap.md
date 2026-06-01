# Tool-Surface Design + Full Coverage Roadmap

**Date:** 2026-05-31
**Branch:** feature/recipe-read-tools → develop (PR #2)
**Status:** Conventions + roadmap are the project standard going forward. PR #2 implements the foundation + the first two (read-only) Recipes tools.

This document captures two things so they survive across many PRs:
1. **The tool-design conventions** (how we map Mealie's REST API to MCP tools) — settled, applies to every future domain.
2. **The full 100%-coverage roadmap** — every one of Mealie's 259 operations assigned to a tool/domain, with PR phasing — so future PRs have their map ready.

> **Provenance:** Conventions and the coverage map were derived from two independent research passes (this project + a parallel Unraid MCP effort, which converged) plus an adversarially-verified research workflow (15 load-bearing claims checked against primary sources: Anthropic's "Writing effective tools for agents," the MCP spec, GitHub's `github-mcp-server`). The endpoint→domain coverage map was generated against Mealie's live OpenAPI spec (the same nightly source as `src/types/mealie.ts`) and **deterministically verified: 259/259 operations accounted for, zero uncovered / phantom / double-mapped.**

---

## 1. Tool-Design Conventions (project standard)

### 1.1 Granularity — hybrid consolidation, never raw 1:1
A pure one-tool-per-endpoint mapping (~259 tools) is Anthropic's named anti-pattern ("tools that merely wrap API endpoints") and bloats client context before the first message (GitHub's 93-tool MCP ≈ **55k tokens** of definitions up front). Forcing artificial "workflow" tools onto plain CRUD is equally bad. We consolidate with four moves, on top of a **strictly 1:1 `MealieClient`** (the client keeps one typed method per endpoint per `AGENTS.md`; consolidation happens only in the thin tool-registration layer above it):

| Move | What | Example |
|---|---|---|
| **Variant-collapse** | N endpoints, one logical action → 1 tool + discriminator enum | 8 recipe-import endpoints → `recipe_import(source: url\|html\|json\|image\|zip\|…)` |
| **Method-dispatcher** | A resource's bulk/action endpoints → 1 tool + `action` enum | `recipe_bulk_actions(action: categorize\|tag\|settings\|delete)` |
| **Aggregated-read** | Bundle a resource's *natural* sub-objects into its get | `recipe_get` returns the recipe + comments/nutrition via `include` |
| **Plain CRUD** | Simple resources stay `search`/`get`/`create`/`update`/`delete` | unchanged — do not fake workflows |

**Sub-resource granularity** (comments, timeline, ratings, share-tokens, labels, ai-providers): prefer a **read tool + a write-dispatcher** over a full 5-tool CRUD family when the actions are simple. This is the main lever that keeps counts honest (see §3 calibration note).

### 1.2 Naming
`snake_case`, domain-prefixed, `[a-z0-9_]`, ≤64 chars. The prefix **is** the namespace: `recipe_*`, `mealplan_*`, `shopping_*`, `cookbook_*`, `organizer_*`, `food_*`/`unit_*`, `app_*`, `household_*`, `webhook_*`/`notification_*`, `group_*`, `user_*`, `admin_*`, `explore_*`. Set both `name` (machine) and `title` (human, e.g. "Search Recipes"). Satisfies the MCP spec, the stricter Claude API regex `^[a-zA-Z0-9_]{1,64}$`, and forthcoming SEP-986.

### 1.3 Reads
- **Search/filter over list-all.** Pagination passthrough on every list/search: `page`, `perPage` (modest default ~20, never unbounded), `search`, `orderBy`, `orderDirection`; surface `total`/`totalPages`.
- **`response_format: 'concise' | 'detailed'`** (default concise ≈ ⅓ tokens) on heavy reads.
- **Return stable UUID + slug** (Mealie slugs change on rename; chained calls need a stable id).
- Keep every response under the ~25k-token client cap; **media returns URLs/references, never inline base64.**

### 1.4 Writes & safety
- Destructive ops (delete, bulk-delete, purge, backup-restore) get `destructiveHint: true` **and** an explicit `confirm: true` parameter **and** are gated by a server-side **read-only switch** (env var) that strips all mutating tools regardless of toolset selection.
- Annotations are UX/policy hints only — **never trusted for security**. Real write-gating is the read-only switch.

### 1.5 Annotations (set explicitly — silence implies destructive)
`readOnlyHint` on reads; `destructiveHint` on destructive; `idempotentHint` on PUT-style updates; `openWorldHint: true` globally (Mealie is an external HTTP API), with import/scrape tools called out as the genuine fetch-arbitrary-URL cases.

### 1.6 Toolsets & exposure (the two-number coverage model)
- **Coverage = tools registered in code.** **Default-enabled = a curated subset** exposed per session.
- Each domain is a **toolset**, grouped by *semantic domain, not URL prefix* (Mealie nests meal-plans, shopping, cookbooks, webhooks all under `/api/households/`). Enable via env var / `--toolsets` flag, with **conditional `register<Domain>Tools()` at startup**.
- **Static selection only** — do NOT build dynamic meta-tool discovery (GitHub removed theirs as more complexity than value). Progressive disclosure / code-execution is a *future* lever, YAGNI until tool count actually hurts.

### 1.7 File organization
`src/tools/<domain>/` directory, **one tool per file** (`recipe-search.ts`, `recipe-get.ts`) + an `index.ts` exporting the toolset-aware `register<Domain>Tools(server, client)`. Handlers exported separately for testing. (`about.ts` may be migrated to `src/tools/app/` later for uniformity — not required by PR #2.)

---

## 2. PR #2 — Foundation + Recipes (read-only)

**Scope:** the conventions plumbing + MealieClient read foundation + two Recipes read tools. Only what read tools exercise is built; write verbs, the `confirm` gate, the read-only switch, and destructive annotations are **documented here but implemented in PR #3** (no untested/unused infrastructure shipped).

### 2.1 MealieClient foundation (read-only this PR)
- `get<T>(path, query?)` — typed query-param support (`URLSearchParams`).
- A typed **paginated list** return mapping Mealie's `PaginationBase`: `{ items, total, page, perPage, totalPages }`.
- Defer `post`/`put`/`patch`/`delete` + file upload to PR #3 (first writes that need them).

### 2.2 Conventions established by this PR
Domain namespacing (`recipe_*`), `name` + `title`, `response_format: concise|detailed` (default concise) + a concise projection helper, pagination passthrough (default `perPage` ~20), `search`/`orderBy`/filter passthrough, `readOnlyHint`/`idempotentHint`/`openWorldHint` annotations, aggregated-read `include`, UUID + slug in results, toolset-aware `registerRecipeTools`.

### 2.3 The two tools
- **`recipe_search`** → `GET /api/recipes`: paginated `RecipeSummary`; passes through `search`/`orderBy`/`categories`/`tags`/`tools`/`foods`; default `perPage` ~20; returns items (uuid+slug+name) + pagination meta. `readOnly`, `idempotent`.
- **`recipe_get`** → `GET /api/recipes/{slug}`: `response_format: concise|detailed`; `include: [comments, nutrition]` aggregated-read; returns uuid+slug. `readOnly`.

### 2.4 Testing
Vitest + hand-written `MealieClient` fakes (no network). Cover: `recipe_search` maps query params + returns pagination meta; `recipe_get` concise vs detailed projection; `include` aggregation; uuid+slug present; error path returns `isError`.

### 2.5 Out of scope → PR #3+
All Recipes writes, the `confirm` gate + read-only switch, image/assets/timeline/comments tools, and all other domains.

---

## 3. Full Coverage Roadmap (all 259 operations)

**Coverage:** **259/259 operations accounted for** — 254 mapped to tools, **5 intentionally omitted** (auth: `POST /api/auth/token`, `POST /api/auth/logout`, `GET /api/auth/refresh`, `GET /api/auth/oauth`, `GET /api/auth/oauth/callback` — login/session/OAuth are handled by server config, not agent tools).

> **Calibration note (read before trusting counts):** A first-pass fan-out produced **165 tools / 78 default**. That number is *uncalibrated* — the per-domain mapping under-applied consolidation, most visibly in Recipes (32 tools, with comments/timeline/share-tokens each split into full 5-tool CRUD families) where the calibrated target is **~14–18**. The **endpoint→domain map below is verified and durable; the tool counts are TARGETS**, finalized in each domain's own PR brainstorm by applying §1.1 (especially the sub-resource read+write-dispatcher rule). Realistic calibrated totals: **~120–150 tools registered, ~45–55 default-enabled** — kept under the ~55k-token default-context line, and trimmable further via toolset selection.

### 3.1 Toolset summary

| Domain | Namespace | Ops | Target tools | Default? | Target PR |
|---|---|---:|---|---|---|
| recipes | `recipe_*` | 58 | ~14–18 | ✅ default | PR #2 (read) + PR #3 (write) |
| meal_plans | `mealplan_*` | 12 | ~9–11 | ✅ default | PR #4 |
| shopping_lists | `shopping_*` | 17 | ~10–11 | ✅ default | PR #4 |
| cookbooks | `cookbook_*` | 6 | ~5 | ✅ default | PR #4 |
| organizers | `organizer_*` | 20 | ~5 | ✅ default | PR #5 |
| foods_units | `food_*`/`unit_*` | 12 | ~10–12 | ✅ default | PR #5 |
| app | `app_*` | 4 | ~2 | ✅ default | PR #6 (mostly done in PR #1) |
| households_mgmt | `household_*` | 10 | ~7 | ⬚ opt-in | PR #7 |
| household_automation | `webhook_*`/`notification_*`/`recipe_action_*` | 19 | ~12–15 | ⬚ opt-in | PR #7 |
| groups | `group_*` | 26 | ~15–21 | ⬚ opt-in | PR #8 |
| users_auth | `user_*` | 22 (17 mapped + 5 omitted) | ~9 | ⬚ opt-in | PR #9 |
| admin | `admin_*` | 38 | ~20–27 | ⬚ opt-in | PR #10 |
| explore | `explore_*` | 15 | ~5 | ⬚ opt-in | PR #11 |
| **Total** | | **259** | **~120–150** (~45–55 default) | | |

### 3.2 Per-domain coverage + consolidation approach

Endpoint groups are Mealie's own tags. "Collapses" note the headline consolidation moves.

**recipes** (58 ops; tags: CRUD, Images/Assets, Bulk Actions, Comments, Timeline, Exports, Shared, Ingredient Parser, Shared:Recipes). Calibrated tool set: `recipe_search`, `recipe_get` (aggregated comments/nutrition), `recipe_create`, `recipe_update` (PUT+PATCH collapse), `recipe_delete`, `recipe_update_many`, `recipe_import` (**8→1**, openWorld), `recipe_bulk_actions` (**4→1** dispatcher, destructive), `recipe_export` (jobs + formats), `recipe_image` (set/upload/delete dispatcher), `recipe_assets`, `recipe_media` (read), `recipe_parse_ingredients` (single+bulk), `recipe_comments` (read + write-dispatcher), `recipe_timeline` (read + write-dispatcher), `recipe_share` (tokens + shared view), `recipe_suggestions`, `recipe_duplicate`, `recipe_mark_made`. *Sub-resource families (comments/timeline/share) are the calibration lever — consolidate to read + write-dispatcher.*

**meal_plans** (12; Mealplans + Mealplan Rules): plan CRUD (`mealplan_search/get/create/update/delete`, `create` collapses random), `mealplan_today` (aggregated), and rule CRUD (`mealplan_rule_*`).

**shopping_lists** (17; Lists + Items): list CRUD with `shopping_list_get` aggregating items; `shopping_list_recipe_references` (add/add-by-recipe/remove dispatcher); item CRUD with single+bulk variant-collapse on create/update/delete.

**cookbooks** (6): `cookbook_search/get/create/update/delete` (update collapses single+bulk).

**organizers** (20; Categories + Tags + Tools): variant-collapse the three parallel resources behind a `type` discriminator → `organizer_search/get/create/update/delete` (~5 tools for 20 ops — the biggest collapse).

**foods_units** (12; Foods + Units): two resources, CRUD each + `food_merge`/`unit_merge` (destructive dispatcher).

**app** (4; About + Utils): `app_get_info` (about/theme/startup aggregated) + `app_download_file`. Largely covered by PR #1's `get_about`.

**households_mgmt** (10; Self Service + Invitations): `household_get_self` (aggregated), members, preferences, permissions, invitations, `household_invite` (dispatcher).

**household_automation** (19; Webhooks + Event Notifications + Recipe Actions): three resources, each read + write-dispatcher + test/trigger actions.

**groups** (26; Self Service, Labels, AI Providers, Reports, Seeders, AI Provider Settings, Households, Migrations): group prefs + members; label CRUD; ai-provider CRUD + settings; report read/delete; `group_seed` (dispatcher); household listing; migration start.

**users_auth** (22; CRUD, Authentication, Ratings, Passwords, Tokens, Registration, Images): `user_me` (aggregated favorites/ratings), update, password change/reset, register, favorites/ratings dispatchers, api-token dispatcher, avatar. **5 auth ops omitted** (config-handled).

**admin** (38; Manage Users/Households/Groups, Backups, Maintenance, AI Providers, About, Email, Debug): admin CRUD for users/households/groups; backup lifecycle incl. **destructive restore/delete** (read-only switch + confirm); `admin_maintenance` dispatcher; ai-providers; about/stats; email; debug. Highest blast radius — ships last, gated.

**explore** (15; public/unauthenticated browse of recipes/foods/organizers/cookbooks/households): `explore_recipe_search/get/suggestions` + `explore_list`/`explore_get` (variant-collapse across resource types). Independent public surface.

### 3.3 PR phasing

| PR | Title | Domains | Rationale |
|---|---|---|---|
| **#2** | Foundation + Recipe READ | recipes (`recipe_search`, `recipe_get`) | Stand up MealieClient read foundation, toolset registry, pagination/`response_format` plumbing on the highest-value read path. |
| **#3** | Recipe WRITE + lifecycle | recipes (remainder) | Complete the flagship: create/update/delete, import/scrape, bulk actions, images/assets, comments, timeline, parser, exports, share tokens. Introduces the write verbs, `confirm` gate, and read-only switch. |
| **#4** | The cooking loop | meal_plans, shopping_lists, cookbooks | The core daily workflow on top of recipes — the trio agents chain together. |
| **#5** | Catalog primitives | organizers, foods_units | Shared taxonomy recipes/plans/lists reference; completes the default surface. |
| **#6** | App close-out | app | Small default domain (about/theme/startup aggregate + file-download util). |
| **#7** | Opt-in: households + automation | households_mgmt, household_automation | Household plumbing + webhooks/notifications/recipe-actions. |
| **#8** | Opt-in: groups | groups | Group-scoped admin-lite. |
| **#9** | Opt-in: users + self-service | users_auth | Self profile, passwords, tokens, avatar. |
| **#10** | Opt-in: admin | admin | Site operations; highest blast radius; gated. |
| **#11** | Opt-in: explore | explore | Public unauthenticated browse; reaches 100% coverage (259/259). |

*Per-PR tool counts are finalized in each PR's own brainstorm by applying the §1.1 consolidation rules; the table in §3.1 gives target ranges, not commitments.*

---

## 4. Sources
- Anthropic — [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- MCP spec — [Tools (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) · [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- [github/github-mcp-server](https://github.com/github/github-mcp-server) (toolsets, read-only mode, dynamic-discovery removal) · [GitHub: fewer tools](https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/)
- [LongFuncEval (arXiv:2505.10570)](https://arxiv.org/abs/2505.10570) (tool-count degradation; effect is modest for frontier models)
