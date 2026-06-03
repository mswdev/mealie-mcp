# PR #8 Design — Opt-in: Groups

**Date:** 2026-06-02
**Branch:** feature/groups → develop (PR #8)
**Status:** Approved (scope confirmed: **one PR**; labels named **`label_*`** first-class; migration confirm-gated, seed not). The **second opt-in PR** — the first to *validate* the `MEALIE_TOOLSETS` foundation PR #7 introduced by reusing it unchanged (add one `groups` token, one conditional `registerGroupTools()`, grow the `server.test.ts` opt-in axis). No new switch mechanism.

Applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1 read + write-dispatcher / variant-collapse, §1.6 toolsets) and finishes the **groups** row of §3.2. Every endpoint shape below was inventoried and **adversarially verified against the committed `src/types/mealie.ts`** by an 8-resource-group inventory → independent skeptic → reconcile workflow: **26/26 operations confirmed, zero corrections, zero missing, zero phantom**; the highest-stakes facts (migration multipart, the three full-replace PUTs, the write-only `apiKey` secret, the reports bare-array, the delete shapes) independently re-checked with exact line evidence.

The groups domain is Mealie's heterogeneous "group-scoped admin-lite" surface spanning eight resource groups (Self Service, Households listing, Labels, AI Providers, AI Provider Settings, Reports, Seeders, Migrations). It is **opt-in** — OFF unless `groups` is named in `MEALIE_TOOLSETS`. The default surface stays exactly at today's **26 reads / 66 full**.

---

## 1. Scope

**One PR** (explicit decision, matching #3/#4/#5/#7). The eight resource groups are code-independent in the tool layer (no cross-imports; each file compiles alone), so one PR carries no internal integration risk and lets the `groups` toolset token land **once** — splitting would force two PRs to both touch the shared `config.ts` / `server.ts` / `server.test.ts` and bump the toolset counts twice.

**Coverage:** **26 endpoints** → **12 new tools** (5 reads + 7 writes). Opt-in (default OFF).

| Resource group | Endpoints | Reads | Writes |
|---|---:|---:|---:|
| Group Self Service (self/members/preferences/storage) | 6 | →`group_self_get` (5) | →`group_self_update` (1) |
| Households listing (group-scoped) | 2 | →`group_households_list` (2) | — |
| MultiPurpose Labels (CRUD) | 5 | →`label_get` (2) | →`label_write` (3) |
| AI Providers (CRUD) | 4 | →`group_ai_provider_get` (1)* | →`group_ai_provider_write` (3) |
| AI Provider Settings (singleton) | 2 | →`group_ai_provider_get` (1)* | →`group_ai_provider_settings_update` (1) |
| Reports (read + delete) | 3 | →`group_report_get` (2) | →`group_report_delete` (1) |
| Seeders (foods/labels/units) | 3 | — | →`group_seed` (3) |
| Migrations (start data migration) | 1 | — | →`group_start_migration` (1) |
| **Total** | **26** | **5 tools / 13 ops** | **7 tools / 13 ops** |

\* `group_ai_provider_get` covers **both** AI read ops (provider-by-id + the settings singleton); the AI rows share that one read tool.

**Roadmap count delta (flagged, not silently missed):** lands at **12 tools vs the ~15–21 target** — a deliberate consolidation (parallel resources collapsed behind `view`/`target`/`action` discriminators; the AI settings read folded into the provider read). Per the §3 calibration note, counts are TARGETS finalized in each PR's brainstorm; PR #7 likewise came in under target. No tools were invented to hit a number.

---

## 2. Reuse the PR #7 toolset switch (no new mechanism)

The `MEALIE_TOOLSETS` foundation already exists end-to-end. PR #8 reuses it verbatim:

1. **`config.ts`** — add `"groups"` to the `KNOWN_TOOLSETS` const (one line). `parseToolsets`, `ToolsetName`, the `z` schema, and the unknown-token-warns-and-ignores behavior already cover it.
2. **`server.ts`** — one conditional after the default registrations:
   ```ts
   if (options.toolsets.has("groups")) registerGroupTools(server, client, options);
   ```
3. **`index.ts` / transports** — **no change**. `toolsets: config.MEALIE_TOOLSETS` already threads into both `startStdio` and `handleMcpPost`.

Composition with `MEALIE_READ_ONLY` is **orthogonal and free**: `registerGroupTools` runs the same internal read/write split as every other domain, so `MEALIE_TOOLSETS=groups` + `MEALIE_READ_ONLY=true` exposes the 5 group reads and strips the 7 group writes. `groups` is independently selectable (works with or without `households`/`automation`).

---

## 3. The 12 tools (`src/tools/groups/`)

All twelve live in one flat `src/tools/groups/` dir (mixed `group_*` + `label_*` prefixes, exactly as `household-automation/` holds `webhook_*`/`event_notification_*`/`recipe_action_*` — the dir is an implementation detail; the prefix is the agent-facing namespace). `index.ts` registers reads always, writes only when `!readOnly`.

### 3.1 Reads (always on) — 5

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `group_self_get` | `GET /self` · `GET /members` · `GET /members/{username_or_id}` · `GET /preferences` · `GET /storage` | **`view` discriminator** (`group` default \| `members` \| `preferences` \| `storage`). `group` → `GroupSummary` (embeds `preferences` + `aiProviderSettings`), `response_format: concise\|detailed`. `members` is the only paginated branch → `getPaginated<UserSummary>` with page/perPage/orderBy/orderDirection(`asc`\|`desc`)/orderByNullPosition(`first`\|`last`)/queryFilter; an optional **`usernameOrId`** sub-arg routes to `GET /members/{username_or_id}` (single `UserSummary`) — **plain string, accepts a username OR a uuid; do NOT uuid-validate.** `preferences` → `ReadGroupPreferences`; `storage` → `GroupStorage`. |
| `group_households_list` | `GET /groups/households` · `GET /groups/households/{household_slug}` | List (paginated `PaginationBase_HouseholdSummary_`) + get-by-**slug** (bare `HouseholdSummary`). Lookup key is the **slug** (`household_slug`), not the uuid. **Distinct from PR #7's `household_self_*`** — this is the group's *list* of households (read-only, lighter `HouseholdSummary`). |
| `label_get` | `GET /labels` · `GET /labels/{item_id}` | List (paginated `MultiPurposeLabelPagination`, items `MultiPurposeLabelSummary`) + get-by-id (`MultiPurposeLabelOut`). **Labels live here** — this read enables shopping's `labelId` → name resolution (deferred from PR #5). `response_format: concise\|detailed`. |
| `group_ai_provider_get` | `GET /ai-providers/providers/{provider_id}` · `GET /ai-providers/settings` | **`provider_id` present** → one `AIProviderOut`; **absent** → `AIProviderSettingsOut` (the three nullable provider-id pointers + the `providers` summary list + three read-only enabled flags). Description must state explicitly: *no `provider_id` returns AI settings incl. the provider list* — there is **no native provider-list endpoint**, the settings response is the only enumeration. `AIProviderOut` **never** carries `apiKey`. |
| `group_report_get` | `GET /reports` · `GET /reports/{item_id}` | List → **bare array `ReportSummary[]`** (NOT a pagination envelope) → `get<ReportSummary[]>`, return `{ items, count }` (precedent: `household_invitations_list`); optional `report_type` filter (`ReportCategory`: `backup\|restore\|migration\|bulk_import`). Get-by-id → `ReportOut` (adds `entries[]`). |

### 3.2 Writes (stripped under read-only) — 7

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `group_self_update` | `PUT /preferences` | **Fetch-merge** (`UpdateGroupPreferences` is a distinct schema but a FULL replace — both `privateGroup`/`showAnnouncements` are required-with-`@default true`). GET `/preferences` → **strip `groupId`/`id`** (the Update schema omits them) → overlay `changes` → PUT. `idempotentHint`. Preferences is the *only* writable self-resource (no permissions endpoint here, unlike households), so a single dedicated update verb — no `target` dispatcher. |
| `label_write` | `POST /labels` · `PUT /labels/{item_id}` · `DELETE /labels/{item_id}` | **`action`** (`create`\|`update`\|`delete`). create = `MultiPurposeLabelCreate {name, color}` (`color` required-with-`@default #959595` — supply it). update = `MultiPurposeLabelUpdate` (distinct schema, but **full-object: `name`/`color`/`groupId`/`id` all required → fetch-merge mandatory**; missing `groupId`/`id` → 422). delete confirm-gated (`destructiveHint`); returns 200 + entity → synthesize `{deleted: id}`. create/delete return 200 (not 201/204). |
| `group_ai_provider_write` | `POST /ai-providers/providers` · `PUT /…/{provider_id}` · `DELETE /…/{provider_id}` | **`action`** (`create`\|`update`\|`delete`). create = `AIProviderCreate`, update = `AIProviderUpdate` (structurally identical; both require `apiKey`). **Secret handling:** `apiKey` is a **write-only credential** — `AIProviderOut` (the only read shape) never returns it, so **fetch-merge cannot recover it; the caller MUST re-supply `apiKey` on every update** or it silently resets to empty. Never echo/log `apiKey` (responses project `AIProviderOut`, which omits it; the client logs url+method only, never the body). Other required-with-default fields to supply: `timeout`(300)/`requestHeaders`({})/`requestParams`({}). delete confirm-gated; 200 + entity → `{deleted: id}`. |
| `group_ai_provider_settings_update` | `PUT /ai-providers/settings` | **Fetch-merge** (`AIProviderSettingsUpdate` is distinct but full-replace: all three pointers `defaultProviderId`/`audioProviderId`/`imageProviderId` are required + nullable; omitting one **nulls** it). GET `AIProviderSettingsOut` → carry the three pointers → change the target → PUT; **never send the Out-only fields** (`providers`, the three `*Enabled` flags). `idempotentHint`. Separate from `group_ai_provider_write` because the read-only switch strips whole write tools — settings read (in `group_ai_provider_get`) and settings write must be distinct tools. |
| `group_seed` | `POST /seeders/foods` · `…/labels` · `…/units` | **`target`** (`foods`\|`labels`\|`units`) — variant-collapse over three byte-identical ops. Body `SeederConfig {locale}` (required free string, **not** an enum). Returns `SuccessResponse {message, error}` — the handler **must surface `message` and treat `error === true` as failure even on HTTP 200**. Additive/non-destructive → write-gated, **no confirm**. |
| `group_start_migration` | `POST /migrations` | **Multipart** (`multipart/form-data`). Reuses `readUploadFile` + `postMultipart` (recipe-import precedent). FormData = `archive` (file Blob, read in the registration layer like `loadImportFile`) + `migration_type` (string, `SupportedMigrations`: `nextcloud\|chowdown\|copymethat\|paprika\|mealie_alpha\|tandoor\|plantoeat\|myrecipebox\|recipekeeper\|cookn`) + `add_migration_tag` (**stringified** bool, required-with-`@default false` — set explicitly). Returns `ReportSummary` → echo incl. the **report `id`** so an agent can chain `group_report_get` (category=migration) to poll status. Imports a whole dataset (high blast radius) → **`destructiveHint` + confirm:true**. |
| `group_report_delete` | `DELETE /reports/{item_id}` | confirm-gated (`destructiveHint`). Response is **200 + `unknown`** (not 204, not the entity) → treat body as opaque, synthesize `{deleted: id}`. |

---

## 4. Cross-Cutting

### 4.1 Foundation reused (no new `MealieClient` methods)

Every tool uses the existing generic verbs (`get`/`getPaginated`/`post`/`put`/`delete`, plus `postMultipart` for migration). Consolidation lives entirely in the tool layer; the client stays strictly 1:1/thin. Shared `jsonResult`/`errorResult` (surfacing Mealie's error body via `MealieApiError`) and `requireConfirmation(confirm, action)` (handler-enforced, **before the try**). The migration file is read in the registration layer (via `readUploadFile`) so the handler stays filesystem-free and unit-testable — the recipe-import pattern.

### 4.2 The carried-forward gotchas, instantiated for this PR

1. **Fetch-merge mandatory on all 3 PUTs** — `group_self_update` (strip `groupId`/`id`), `label_write` update (full 4-field object), `group_ai_provider_settings_update` (3 required-nullable pointers; never echo Out-only fields). Each reads like "partial update is safe" (all three have a *distinct* `*Update` schema) but each is a **full replace** — the trap that bit every prior PR. GET current → overlay the caller's subset → PUT the complete body.
2. **The write-only secret** — `apiKey` (AI providers) is required on create *and* update but absent from every read shape; fetch-merge can't recover it, so the caller re-supplies it each update. Never echoed, never logged.
3. **Delete shape asymmetry** — `label_write`/`group_ai_provider_write` deletes return 200 + the entity; `group_report_delete` returns 200 + `unknown`. Synthesize `{deleted: id}` uniformly.
4. **List shape asymmetry** — members/households/labels are `*Pagination` envelopes (`getPaginated`); **reports is a bare array** (`get<ReportSummary[]>`); AI providers has **no list endpoint** (use `/settings.providers`). Members get-by-id key is polymorphic (username or uuid); households get-by-**slug**.
5. **Required-but-undefaulted / required-with-default fields a typed literal must supply** — label `color` (`@default #959595`), AI `apiKey`/`timeout`/`requestHeaders`/`requestParams`, group-prefs `privateGroup`/`showAnnouncements`, migration `add_migration_tag`, seed `locale`. Verify each `required` set against `mealie.ts` before constructing the body.

### 4.3 Typed vs freeform bodies

Build typed `components["schemas"][...]` objects for creates/dispatch (`MultiPurposeLabelCreate`, `AIProviderCreate`/`AIProviderUpdate`, `SeederConfig`, the migration `Body_…` fields). Freeform `z.record(z.unknown())` **untyped** `changes`, fetch-merged, for the PUT updates. Enums validated verbatim against `mealie.ts`: `SupportedMigrations` (10), `ReportCategory` (4), `OrderDirection`/`OrderByNullPosition`. `accept-language` (an optional header on every op) is **intentionally omitted** across all tools — redundant with the seed `locale` body field and the client uses fixed JSON headers (matches prior domains).

### 4.4 Annotations

`readOnlyHint` on the 5 reads (+`idempotentHint` on the paginated list reads, per precedent). `idempotentHint` on the 3 PUT updates. `destructiveHint` + `confirm` on the 4 destructive/high-blast ops (`label_write` delete, `group_ai_provider_write` delete, `group_report_delete`, `group_start_migration`). `group_seed` is write-registered but **non-destructive** (no `destructiveHint`, no confirm). `openWorldHint: true` globally (Mealie is an external HTTP API; migration additionally reads a server-local file).

---

## 5. File Organization

Flat `src/tools/groups/` dir, one tool per file (+ colocated `.test.ts`), one `index.ts` applying the read/write split, one shared `group-projection.ts` for concise helpers (split only if a file grows unwieldy). **~14 source files — under the 20-cap** (12 tools + index + projection; `.test.ts` files don't count).

```
src/tools/groups/   index.ts, group-projection.ts,
                    group-self-get.ts, group-self-update.ts, group-households-list.ts,
                    label-get.ts, label-write.ts,
                    group-ai-provider-get.ts, group-ai-provider-write.ts,
                    group-ai-provider-settings-update.ts,
                    group-seed.ts, group-start-migration.ts,
                    group-report-get.ts, group-report-delete.ts
```

`index.ts` → `registerGroupTools(server, client, { readOnly, toolsets })`; registers reads always, writes (incl. `group_seed`/`group_start_migration`) only when `!readOnly`. `createServer` gains one conditional call. Imports flow downward only; no sibling cross-imports.

---

## 6. Testing

- **Per-handler unit tests** with hand-written `MealieClient` fakes (generic `async <T>(): Promise<T>`, per strict TS). Cover: the `view`/`action`/`target` discriminator branches; **fetch-merge preserves untouched fields** on all 3 PUTs (explicit silent-reset regression each; group-prefs `groupId`/`id` strip; AI-settings 3-pointer carry-over); the **`apiKey` never echoed** assertion + re-supply-required-on-update; the **bare-array** reports read vs the paginated reads; **delete shape asymmetry** (entity vs 200/`unknown`) synthesizing a uniform `{deleted}`; the confirm gate (missing → `isError`, present → proceeds) on the 4 destructive ops; **`group_seed` `error:true`-on-200 → failure**; **multipart FormData assembly** — assert all three migration fields (`archive`, `migration_type`, `add_migration_tag` serialized as a string) land in the FormData; the polymorphic members key + the slug-keyed household get; enum mapping; `isError` on client throw.
- **`config.test.ts`:** `parseToolsets` — a `groups` token enables groups; `households,automation,groups` enables all three; unknown token still warns + is ignored while `groups` survives.
- **`server.test.ts` — grow the opt-in axis** (`GROUPS_READS` = the 5 reads, `GROUPS_WRITES` = the 7 writes; grown per-resource as they land):
  - **Default (no toolsets) stays 26 / 66** — assert all 12 group tools **absent** (regression guard).
  - **`groups` enabled, full → 78** (31 reads + 47 writes): assert the 5 reads + 7 writes present, households/automation absent.
  - **`groups` enabled + read-only → 31 reads** (the 5 reads appear; the 7 writes stripped).
  - **All three toolsets enabled, full → 91** (36 reads + 55 writes) — proves orthogonal composition.
- **Real-stdio subprocess check:** tools/list for (a) default ⇒ 66/26 with no `group_*`/`label_*`, (b) `MEALIE_TOOLSETS=groups` ⇒ 78, (c) + read-only ⇒ 31; `app_get_info` 200. **demo.mealie.io caveat:** every group endpoint is **401 without a token** (auth-scoped) → these reads AND writes can't be live-tested; covered by unit fakes, **real-instance testing remains owed** (noted in the PR body).
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` — exit 0 (empty lint output ≠ pass; `npx biome check --write src/` to auto-fix import-order).

---

## 7. Process

- Branch `feature/groups` off `develop` (verified @ 26/66 with PR #7 merged, HEAD `a7f8144`); **draft** PR into `develop`.
- **Sequential TDD in the main loop** (shared `config.ts`, `server.ts`, per-domain `index.ts`, and `server.test.ts` + per-step quality gate make parallelism unsafe). Foundation/archetype-first:
  1. **Toolset wiring** — `groups` in `KNOWN_TOOLSETS` + `createServer` conditional + an (initially empty) `registerGroupTools`; `config.test.ts` + the `server.test.ts` default-26/66-unchanged guard. Proves the switch before any tool exists.
  2. **labels** — `label_get` + `label_write` (create/update[fetch-merge]/delete[confirm,entity]). Proves the read + write-dispatcher CRUD archetype; highest cross-domain value (shopping `labelId`).
  3. **group self-service** — `group_self_get` (view dispatcher, paginated members + polymorphic by-id) + `group_self_update` (prefs fetch-merge, strip groupId/id).
  4. **households-listing + reports** — `group_households_list` (list + slug) ; `group_report_get` (bare array) + `group_report_delete` (confirm, 200/unknown).
  5. **AI providers** — `group_ai_provider_get` (provider | settings) + `group_ai_provider_write` (secret apiKey) + `group_ai_provider_settings_update` (fetch-merge).
  6. **seeders + migration** — `group_seed` (target dispatcher, error-flag) + `group_start_migration` (multipart, confirm).
  7. Bump `server.test.ts` counts to final (78 full / 31 read-only when `groups` on; 91 all-three; 66/26 default unchanged); real-stdio check; README `MEALIE_TOOLSETS=groups`.
- **Adversarial multi-lens code review** (workflow) before hand-off; then the author runs `superpowers:requesting-code-review`.

---

## 8. Sources

- Adversarially-verified endpoint inventory: 8-resource-group inventory → independent skeptic → reconcile workflow against committed `src/types/mealie.ts` — **26/26 operations confirmed, zero corrections / missing / phantom**; highest-stakes facts (migration `multipart/form-data` `Body_start_data_migration_…`; the three distinct-but-full-replace PUTs; the write-only `apiKey`; reports bare-array; the 200/`unknown` report delete; `SupportedMigrations` 10-member enum) independently re-checked with exact line evidence.
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1, §1.6), §3.2 (groups row), §3.3 (PR #8).
- Freshest archetype precedent: [`2026-06-02-households-automation-design.md`](./2026-06-02-households-automation-design.md) (the opt-in toolset switch; read + write-dispatcher; fetch-merge updates; confirm-gated permissions; bare-array read) and [`2026-06-02-catalog-primitives-design.md`](./2026-06-02-catalog-primitives-design.md) (multi-resource variant-collapse; fetch-merge; the deferred-labels note). Multipart precedent: `src/tools/recipes/import/recipe-import.ts` (`readUploadFile` + `postMultipart` + registration-layer file read).
