# PR #7 Design — Opt-in: Households + Automation

**Date:** 2026-06-02
**Branch:** feature/households-automation → develop (PR #7)
**Status:** Approved. The **first opt-in PR** — it introduces the toolset-selection switch (`MEALIE_TOOLSETS`) that PRs #8–#11 reuse, on top of the proven write foundation (generic `MealieClient` verbs, `MEALIE_READ_ONLY`, `requireConfirmation`, shared `jsonResult`/`errorResult`, per-domain read/write register split).

Applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1 read + write-dispatcher consolidation and §1.6 toolsets) and finishes the **households_mgmt** + **household_automation** rows of §3.2. Every endpoint shape below was inventoried and **adversarially verified against the committed `src/types/mealie.ts`** by a 5-resource inventory→skeptic→reconcile workflow: **29/29 operations confirmed, zero corrections, zero missing, zero phantom, zero gaps.**

These two domains are the household plumbing (self-service, members, preferences, permissions, invitations) and its event automation (webhooks, Apprise notifications, recipe actions). Both are **opt-in** — OFF unless named in `MEALIE_TOOLSETS`. The default surface stays exactly at today's 26 reads / 66 full.

---

## 1. Scope

**One PR** (explicit decision, matching #3/#4/#5). The two domains are code-independent in the tool layer (no cross-imports; each dir compiles alone), so one PR carries no internal integration risk and lets the opt-in toolset switch land once.

**Coverage:** **29 endpoints** (households_mgmt 10 + household_automation 19) → **13 new tools** (5 reads + 8 writes). Both domains **opt-in** (default OFF).

| Domain | Endpoints | Tools | Reads | Writes |
|---|---:|---:|---:|---:|
| households_mgmt (`household_*`) | 10 | 4 | 2 | 2 |
| household_automation (`webhook_*` / `event_notification_*` / `recipe_action_*`) | 19 | 9 | 3 | 6 |
| **Total** | **29** | **13** | **5** | **8** |

**Roadmap count deltas (flagged, not silently missed):**
- households_mgmt lands at **4 tools vs the ~7 target** — a deliberate consolidation: 5 reads collapse into one `view`-dispatcher, the 2 PUTs into one `target`-dispatcher, and invitation create+email into one `action`-dispatcher (matching the roadmap's own "household_invite (dispatcher)" sketch). Per the §3 calibration note, counts are targets finalized in each PR's brainstorm.
- household_automation lands at **9 tools** — inside (low end of) the ~12-15 target. Each of the 3 parallel resources = read + write-dispatcher (create|update|delete) + a side-effecting action verb, per §1.1.

---

## 2. The toolset switch (headline new foundation)

The opt-in analog of what `MEALIE_READ_ONLY` was for PR #3. **Static selection only** — no dynamic meta-tool discovery (§1.6; GitHub removed theirs as more complexity than value).

### 2.1 `MEALIE_TOOLSETS` env var + `parseToolsets` (mirrors `parseReadOnly`)

- New env var **`MEALIE_TOOLSETS`** — comma-separated tokens, e.g. `MEALIE_TOOLSETS=households,automation`. Unset/empty → no opt-in toolsets (default surface only).
- **`parseToolsets(value): Set<ToolsetName>`** in `src/config.ts`: split on `,`, `trim()`, `toLowerCase()`, drop empties, dedupe via the Set, validate each token against a `KNOWN_TOOLSETS` const (`["households", "automation"] as const`; future PRs extend it).
- **Unknown/typo'd tokens are logged to stderr and ignored** (`logger.warn({ token }, "Unknown MEALIE_TOOLSETS token ignored")`) — a single typo can't brick the server, and valid tokens still take effect. `logger.ts` imports only `pino`, so importing it into `config.ts` is safe (no circular dependency).
- Added to `configSchema` via `z.preprocess` exactly like `MEALIE_READ_ONLY` (preprocess receives `undefined` when unset → returns an empty Set).
- Tokens are **independently selectable** — `households` without `automation` is valid (§1.6 "each domain is a toolset").
- **Env var only — no `--toolsets` CLI flag.** MCP clients configure via env; `index.ts` does not parse argv today, so a flag is unneeded surface (roadmap said "and/or"; we take the simpler half).

### 2.2 Conditional registration in `createServer`

- `ServerOptions` gains `toolsets`: `{ readOnly: boolean; toolsets: ReadonlySet<ToolsetName> }`.
- Default domains register unconditionally (unchanged). Then, conditionally:
  ```ts
  if (options.toolsets.has("households")) registerHouseholdTools(server, client, options);
  if (options.toolsets.has("automation")) registerHouseholdAutomationTools(server, client, options);
  ```
- `index.ts` threads `toolsets: config.MEALIE_TOOLSETS` into **both** `createServer(...)` call sites (stdio `startStdio` + HTTP `handleMcpPost`).

### 2.3 Composition with `MEALIE_READ_ONLY` (orthogonal)

The two switches are independent axes:
- **`MEALIE_TOOLSETS`** selects *whether a domain is present at all*.
- **`MEALIE_READ_ONLY`** still strips writes *within* any enabled domain, because each opt-in registrar runs the same internal read/write split it would for a default domain.

So `MEALIE_TOOLSETS=households,automation` + `MEALIE_READ_ONLY=true` → the 5 opt-in **reads** appear, the 8 opt-in **writes** are stripped.

---

## 3. households_mgmt — 4 tools (`src/tools/households/`)

Two resources (Self Service + Invitations). All endpoints are scoped to the **caller's own** household.

### 3.1 Reads (always on) — 2

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `household_self_get` | `GET /self` · `GET /preferences` · `GET /statistics` · `GET /members` · `GET /self/recipes/{recipe_slug}` | **`view` discriminator** (`household` default \| `preferences` \| `statistics` \| `members` \| `recipe`). `members` is the only paginated branch → `getPaginated` with page/perPage/orderBy/orderDirection(`asc`\|`desc`)/orderByNullPosition(`first`\|`last`)/queryFilter passthrough. `recipe` requires `recipe_slug` and returns the **thin `HouseholdRecipeSummary` pivot `{lastMade?, recipeId}` — NOT a full recipe** (doc: use the recipes toolset for recipe content). `response_format: concise\|detailed` on the heavy `household` view; the small config/stat objects return whole. |
| `household_invitations_list` | `GET /invitations` | Returns a **bare `ReadInviteToken[]` array — no pagination envelope** → use generic `get<ReadInviteToken[]>`, **not** `getPaginated` (precedent: organizer_search's empty branch). |

### 3.2 Writes (stripped under read-only) — 2

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `household_self_update` | `PUT /preferences` · `PUT /permissions` | **`target` discriminator** (`preferences` \| `permissions`), with **disjoint typed payloads** (do not share a body shape). **Both full-replace → fetch-merge mandatory** (see §5). `idempotentHint`. **`target=permissions` is privilege-elevating** (`SetPermissions` can grant `canManageHousehold`) → **gated behind `confirm: true`**, fetch-merges the target member's current `UserOut` flags so an omitted flag never silently downgrades them, and **echoes the resulting flag set** in the response. `target=preferences` is ungated. |
| `household_invite` | `POST /invitations` · `POST /invitations/email` | **`action` discriminator** (`create` \| `send_email`). `create` → `CreateInviteToken {uses (required, no default), groupId?, householdId?}` → 201 + single `ReadInviteToken`. `send_email` → `EmailInvitation {email, token}` → **fires an invitation email** (network side-effect) → response is the **verbatim-typo'd `EmailInitationResponse {success, error?}`** (there is no `EmailInvitationResponse` in `mealie.ts`). Non-destructive; no confirm gate. Mirrors Mealie's two-step create-then-email flow. |

---

## 4. household_automation — 9 tools (`src/tools/household-automation/`)

Three near-parallel resources (Webhooks, Event Notifications, Recipe Actions), each mapped to the **same skeleton**: a read (list + get-by-id), a `create|update|delete` write-dispatcher (delete confirm-gated *inside* it, exactly like `mealplan_rule_write`), and a separate side-effecting action verb. The action verbs are **non-destructive but fire network/email**, so they register as **writes** (stripped under read-only) — a read-only server must not fire test webhooks, send Apprise notifications, or trigger recipe actions.

### 4.1 Reads (always on) — 3

| Tool | Endpoints | Response |
|---|---|---|
| `webhook_get` | `GET /webhooks` (list) · `GET /webhooks/{item_id}` | `WebhookPagination` (list, branch on `item_id` absent) / `ReadWebhook` (single). `webhookType` enum is single-member `['mealplan']`. |
| `event_notification_get` | `GET /events/notifications` · `…/{item_id}` | `GroupEventPagination` / `GroupEventNotifierOut`. `response_format: concise\|detailed` — concise omits the heavy 27-boolean `options` object. |
| `recipe_action_get` | `GET /recipe-actions` · `…/{item_id}` | `GroupRecipeActionPagination` / `GroupRecipeActionOut`. `actionType` enum `['link','post']`. |

All lists take the standard pagination + order query passthrough (`OrderDirection asc\|desc`, `OrderByNullPosition first\|last`).

### 4.2 Writes (stripped under read-only) — 6

| Tool | Endpoints | Notes |
|---|---|---|
| `webhook_write` | `POST /webhooks` · `PUT /webhooks/{item_id}` · `DELETE /webhooks/{item_id}` | `action` (`create`\|`update`\|`delete`). create/update both use **`CreateWebhook`** (no distinct `*Update` schema) → **fetch-merge on update**. Required-with-default fields to always populate: `enabled`(true)/`name`('')/`url`('')/`webhookType`('mealplan'); **`scheduledTime` is required but has NO default — caller must supply.** `delete` confirm-gated (`destructiveHint`); returns the deleted **`ReadWebhook` body** (200, not 204). |
| `webhook_action` | `POST /webhooks/{item_id}/test` · `POST /webhooks/rerun` | `action` (`test` needs `item_id` \| `rerun` re-fires all of today's scheduled webhooks, no id). Both return **`unknown`** bodies (200, untyped) → surface a generic success echo, never parse a typed result. Non-destructive (no confirm) but side-effecting. |
| `event_notification_write` | `POST /events/notifications` · `PUT /…/{item_id}` · `DELETE /…/{item_id}` | create = `GroupEventNotifierCreate` (minimal: `name` + optional `appriseUrl`). update = `GroupEventNotifierUpdate` — **a distinct `*Update` schema but still full-replace** (`name`/`enabled`/`groupId`/`householdId`/`options`/`id` all required) → **fetch-merge mandatory** (the trap). Required-with-default on update: `enabled`(true) + `options` (object of **27 required @default-false booleans**). `delete` confirm-gated; returns **bare 204** (no body — unlike the other two deletes). |
| `event_notification_test` | `POST /events/notifications/{item_id}/test` | Sends a **live Apprise test notification** to the configured `appriseUrl`. No request body; returns **bare 204**. Non-destructive, side-effecting. |
| `recipe_action_write` | `POST /recipe-actions` · `PUT /…/{item_id}` · `DELETE /…/{item_id}` | create = `CreateGroupRecipeAction {actionType, title, url}` (3 fields). update = **`SaveGroupRecipeAction`** (no distinct `*Update` schema) — a **superset** adding required **`groupId`+`householdId`** the create body lacks → **fetch-merge mandatory** (read them back from the GET). `delete` confirm-gated; returns the deleted **`GroupRecipeActionOut` body** (200). |
| `recipe_action_trigger` | `POST /recipe-actions/{item_id}/trigger/{recipe_slug}` | **Fires** the configured link/post action against a recipe. **Two path params** (`item_id`, `recipe_slug`). Optional body `Body_trigger_action_…_post {recipe_scale (required-in-schema, @default 1)}` — when a typed body is sent it must set `recipe_scale`. Returns **bare 202 (`unknown`)** → fire-and-forget, do not parse. Non-destructive, side-effecting. |

---

## 5. Cross-Cutting

### 5.1 Foundation reused (no new `MealieClient` methods)

Every tool uses the existing generic verbs (`getPaginated`/`get`/`post`/`put`/`delete`, empty-body-tolerant). No multipart. Consolidation lives entirely in the tool layer. Shared `jsonResult`/`errorResult` (surfacing Mealie's error body via `MealieApiError`) and `requireConfirmation(confirm, action)` (handler-enforced, BEFORE the try). Per-domain concise projection helpers where the payload is heavy.

### 5.2 The five carried-forward gotchas (the implementation spec)

1. **Fetch-merge is mandatory on ALL FIVE PUTs** — including the two with a *distinct* `*Update` schema (`UpdateHouseholdPreferences`, `GroupEventNotifierUpdate`), which reads like "partial update is safe" but is a **trap: both are still full-replace**. The other three (`SetPermissions`, `CreateWebhook` reused, `SaveGroupRecipeAction` reused) are also full-replace. For every one: GET current → overlay the caller's subset → PUT the complete body. Otherwise omitted fields silently reset to defaults (and for `permissions`, silently **downgrade** a member).
2. **Delete return-shape asymmetry** — `webhook_write`/`recipe_action_write` deletes return **200 with the deleted entity**; `event_notification_write` delete returns **bare 204**. Synthesize `{ deleted: id }` uniformly so the tool contract is stable regardless.
3. **Untyped / non-uniform action responses** — webhook test+rerun → 200 `unknown`; notification test → 204; recipe-action trigger → 202 `unknown`. None have a typed schema → return a generic `{ ok: true, ... }` echo, never parse.
4. **Required-but-undefaulted fields** a typed literal must supply explicitly — webhook `scheduledTime`; recipe-action update `groupId`+`householdId` (server-injected on create, so read back from the GET); invitation `uses`; notification update's full 27-boolean `options` object.
5. **Verbatim typo** — the invitation email response schema is **`EmailInitationResponse`** (missing the "v"). Reference it exactly or the import fails.

### 5.3 Typed vs freeform bodies

Build typed `components["schemas"][...]` objects when constructing from known args (creates/updates/dispatch). Verify each enum (`WebhookType` single-member `['mealplan']`, `GroupRecipeActionType ['link','post']`, the order enums) against `mealie.ts` before coding.

### 5.4 Annotations

`readOnlyHint` on the 5 reads; `idempotentHint` on the PUT-style updates; `destructiveHint` + `confirm` on the 3 deletes **and** on `household_self_update(target=permissions)`; `openWorldHint: true` globally; action verbs (`*_action`/`*_test`/`*_trigger`, `send_email`) are non-destructive (no `destructiveHint`, no confirm) but are write-registered.

---

## 6. File Organization

Flat dirs, one tool per file (+ colocated `.test.ts`), one `index.ts` applying the read/write split, per-domain projection helper(s) where heavy. Both dirs are well under the 20-source-file cap.

```
src/tools/households/            (~6 source)   index.ts, household-projection.ts,
                                               household-self-get.ts, household-self-update.ts,
                                               household-invitations-list.ts, household-invite.ts
src/tools/household-automation/  (~11 source)  index.ts, (projection helper[s] as needed),
                                               webhook-{get,write,action}.ts,
                                               event-notification-{get,write,test}.ts,
                                               recipe-action-{get,write,trigger}.ts
```

`households/index.ts` → `registerHouseholdTools(server, client, { readOnly, toolsets })`; `household-automation/index.ts` → `registerHouseholdAutomationTools(...)`. Each registers reads always, writes (incl. the side-effecting action verbs) only when `!readOnly`. Imports flow downward only; no sibling cross-imports.

---

## 7. Testing

- **Per-handler unit tests** with hand-written `MealieClient` fakes (generic `async <T>(): Promise<T>`, per strict TS). Cover: the `view`/`target`/`action` discriminator branches; **fetch-merge preserves untouched fields** on all 5 PUTs (explicit silent-reset regression test each); the **permissions confirm-gate + no-silent-downgrade merge**; the **bare-array** read (`household_invitations_list`); delete return-shape asymmetry (entity vs 204) synthesizing a uniform `{deleted}`; untyped action responses surfaced as a generic echo; the `EmailInitationResponse` typed result; enum mapping; `isError` on client throw; confirm gate (missing → `isError`, present → proceeds) on the 3 deletes + permissions.
- **`config.test.ts`:** `parseToolsets` — empty/unset → empty Set; `households,automation` → both; case-insensitive + trimmed; duplicates collapse; **unknown token warns + is ignored** while valid tokens survive.
- **`server.test.ts` — the new third axis (opt-in toolsets):**
  - **Default (no toolsets) stays 26 / 66** — assert the 13 opt-in tools are **absent**.
  - **Toolsets `{households, automation}` enabled, full → 79** (31 reads + 48 writes): assert all 5 new reads + 8 new writes present.
  - **Toolsets enabled + read-only → 31** (the 5 new reads appear; the 8 new writes stripped).
  - Extend `READ_TOOLS`/`WRITE_TOOLS` and parameterize `listToolNames` to take `{ readOnly, toolsets }`.
- **Real-stdio subprocess check:** tools/list for (a) default ⇒ 66/26 with no `household_*`/`webhook_*`, (b) `MEALIE_TOOLSETS=households,automation` ⇒ 79, (c) + read-only ⇒ 31; `app_get_info` 200. **demo.mealie.io caveat:** `/api/app/about` is 200, but household/webhook/notification/recipe-action endpoints are **401 without a token** (auth-scoped) → these reads AND writes can't be live-tested; covered by unit fakes, **real-instance testing remains owed** (note in the PR body).
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` — exit 0 (empty lint output ≠ pass; `npx biome check --write src/` to auto-fix import-order).

---

## 8. Process

- Branch `feature/households-automation` off `develop` (verified @ 26/66 with PR #6 merged); **draft** PR into `develop`.
- **Sequential TDD in the main loop** (shared per-domain `index.ts`, `config.ts`, and `server.test.ts` + per-step quality gate make parallelism unsafe). Foundation/archetype-first:
  1. **Toolset switch** — `parseToolsets` + `config` + `ServerOptions`/`createServer` conditional registration + `index.ts` wiring, with `config.test.ts` and the new `server.test.ts` axis (initially asserting the two empty opt-in dirs register nothing). Proves the switch before any tool exists.
  2. **household_automation: webhooks** — proves the resource skeleton end-to-end (get → write create/update[fetch-merge]/delete[confirm] → action test/rerun), wired behind the `automation` toolset + tested.
  3. **event_notifications** — reuses the skeleton; exercises the distinct-`*Update`-but-still-full-replace trap + the 27-boolean `options` + the 204 delete.
  4. **recipe_actions** — reuses the skeleton; exercises the create⊂save superset + the 2-path-param 202 trigger.
  5. **households: self-service** — `household_self_get` (view dispatcher) + `household_self_update` (preferences + permissions confirm-gate).
  6. **households: invitations** — `household_invitations_list` (bare array) + `household_invite` (create + send_email).
  7. Bump `server.test.ts` counts to final (79 full / 31 read-only enabled; 66/26 default unchanged); real-stdio check; README.
- **Adversarial multi-lens code review** (workflow) before hand-off; then the author runs `superpowers:requesting-code-review`.

---

## 9. Sources

- Adversarially-verified endpoint inventory: 5-resource inventory → skeptic-verify → reconcile workflow against committed `src/types/mealie.ts` — **29/29 operations confirmed, zero corrections / missing / phantom / gaps**; highest-stakes facts (fetch-merge on all 5 PUTs, delete asymmetry, untyped action responses, `EmailInitationResponse` typo) independently re-checked.
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1, §1.6), §3.2 (households_mgmt + household_automation rows), §3.3 (PR #7).
- Freshest archetype precedent: [`2026-06-01-cooking-loop-design.md`](./2026-06-01-cooking-loop-design.md) (read + write-dispatcher: `mealplan-rules.ts` + `mealplan-rule-write.ts`; fetch-merge updates; read/write split) and [`2026-06-02-app-closeout-design.md`](./2026-06-02-app-closeout-design.md) (per-domain `register*Tools` + `createServer` wiring; aggregated read).
