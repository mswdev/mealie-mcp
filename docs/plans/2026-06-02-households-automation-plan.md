# PR #7 — Opt-in: Households + Automation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. **This build runs SEQUENTIALLY in the main loop** (per the owner's instruction): the shared `config.ts`, `server.ts`, `server.test.ts`, and per-domain `index.ts` plus the per-step quality gate make parallel execution unsafe. Do NOT dispatch parallel subagents for the build.

**Goal:** Add the static opt-in toolset switch (`MEALIE_TOOLSETS`) and two opt-in domains — households_mgmt (4 tools) and household_automation (9 tools), 13 new tools (5 read / 8 write) — reaching toolsets-on 79 full / 31 read-only while the default surface stays 26/66.

**Architecture:** Mirror `parseReadOnly`: `parseToolsets` → `Set<ToolsetName>` on `Config`; `createServer` registers default domains unconditionally and the two opt-in domains conditionally on `options.toolsets`. Each opt-in `register*Tools(server, client, options)` runs the same internal read/write split so `MEALIE_READ_ONLY` still strips writes within an enabled toolset. Tools follow the proven read + write-dispatcher archetype (`mealplan_rule_write`) on the generic `MealieClient` verbs.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod, `@modelcontextprotocol/sdk`, vitest, Biome, pino. Types from `src/types/mealie.ts` (committed OpenAPI gen).

---

## Conventions to reuse (do not re-derive)

- **Idioms** (mirror exactly): `food-search.ts` (paginated `getPaginated<T>` + `toConcise`, `DEFAULT_PER_PAGE=20`/`MAX_PER_PAGE=100`, `idempotentHint` on searches); `food-get.ts` (`response_format: concise|detailed` + projection); `food-projection.ts` (cast-through `as unknown as Record<string,unknown>`, `CONCISE_FIELDS`); `food-update.ts` (**fetch-merge** `{...current, ...args.changes}`, `idempotentHint`); `food-delete.ts` (`requireConfirmation(confirm, action)` BEFORE the try, returns `{deleted:id}`, `destructiveHint`); `mealplan-rule-write.ts` (write-dispatcher: delete handled before try, create/update in try, `missing(field)` helper); `foods-units/index.ts` (reads, then `if (options.readOnly) return;`, then writes).
- **Strict-TS rules:** optional MCP-arg fields are typed `T | undefined` explicitly in the `Args` type; test fakes implement generic client methods as `async <T>(): Promise<T>`. Never `any`. Never `delete obj.key` (Biome `noDelete`) or unused destructure-discards.
- **Bodies:** typed `components["schemas"][...]` literals for create/dispatch (supply required-with-default fields); freeform `changes: z.record(z.unknown())` (untyped passthrough) fetch-merged for updates.
- **The 5 gotchas** (design §5.2): (1) **fetch-merge mandatory on ALL 5 PUTs** incl. the two with a distinct `*Update` schema; (2) delete return-shape asymmetry → always synthesize `{deleted:id}`; (3) untyped/204/202 action responses → return a generic echo, never parse; (4) required-but-undefaulted fields a literal must supply; (5) verbatim typo `EmailInitationResponse`.
- **Quality gate after every task:** `npm run build && npm run typecheck && npm run test && npm run lint` → exit 0. Auto-fix import order with `npx biome check --write src/`.
- **No tool throws** — return `errorResult(...)`. `openWorldHint: true` on every tool.

---

## Phase 0 — Toolset switch foundation (must land before any tool)

### Task 0.1: `parseToolsets` + config

**Files:** Modify `src/config.ts`; Test `src/config.test.ts`.

**Step 1 — failing tests** (`src/config.test.ts`, new `describe("parseToolsets")`):
```ts
import { parseToolsets } from "./config.js";
// unset/empty → empty set
expect(parseToolsets(undefined).size).toBe(0);
expect(parseToolsets("").size).toBe(0);
// both tokens
const both = parseToolsets("households,automation");
expect(both.has("households")).toBe(true);
expect(both.has("automation")).toBe(true);
// case-insensitive + trimmed + de-duped
const norm = parseToolsets(" Households , AUTOMATION , households ");
expect([...norm].sort()).toEqual(["automation", "households"]);
// unknown token ignored, valid survives (no throw)
const mixed = parseToolsets("households,bogus");
expect(mixed.has("households")).toBe(true);
expect(mixed.has("bogus" as never)).toBe(false);
expect(mixed.size).toBe(1);
```

**Step 2 — run, expect FAIL** (`parseToolsets` not exported).

**Step 3 — implement** in `src/config.ts` (add near `parseReadOnly`):
```ts
import { logger } from "./logger.js";

/** Opt-in toolset tokens recognized in MEALIE_TOOLSETS. Extend per opt-in PR (#8-#11). */
export const KNOWN_TOOLSETS = ["households", "automation"] as const;
/** A recognized opt-in toolset name. */
export type ToolsetName = (typeof KNOWN_TOOLSETS)[number];

/** Type guard: is the token one of the recognized opt-in toolsets? */
function isKnownToolset(token: string): token is ToolsetName {
  return (KNOWN_TOOLSETS as readonly string[]).includes(token);
}

/**
 * Parses MEALIE_TOOLSETS into the set of enabled opt-in toolsets. Comma-separated,
 * case-insensitive, trimmed, de-duplicated. Unknown tokens are logged to stderr and
 * ignored so one typo never blocks startup (valid tokens still take effect).
 *
 * @param value - Raw env value (or undefined when unset)
 * @returns The set of recognized toolset names to enable (empty when unset)
 */
export function parseToolsets(value: string | undefined): Set<ToolsetName> {
  const enabled = new Set<ToolsetName>();
  if (value === undefined) return enabled;
  for (const raw of value.split(",")) {
    const token = raw.trim().toLowerCase();
    if (token === "") continue;
    if (isKnownToolset(token)) enabled.add(token);
    else logger.warn({ token }, "Ignoring unknown MEALIE_TOOLSETS token");
  }
  return enabled;
}
```
Add to `configSchema`:
```ts
  MEALIE_TOOLSETS: z.preprocess(
    (value) => parseToolsets(typeof value === "string" ? value : undefined),
    z.set(z.enum(KNOWN_TOOLSETS)),
  ),
```

**Step 4 — run tests, expect PASS.** Quality gate.

**Step 5 — commit:** `feat(config): add MEALIE_TOOLSETS opt-in toolset switch (parseToolsets)`

---

### Task 0.2: Empty opt-in registrars + conditional wiring

**Files:** Create `src/tools/households/index.ts`, `src/tools/household-automation/index.ts`; Modify `src/server.ts`, `src/index.ts`.

**Step 1 — create stub registrars** (will fill as tools land):
```ts
// src/tools/households/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";

/** Options controlling which household tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the households_mgmt toolset (opt-in via MEALIE_TOOLSETS=households).
 * Reads are always registered; writes only when not read-only.
 */
export function registerHouseholdTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  // reads (always)
  // if (options.readOnly) return;
  // writes
  void server;
  void client;
  void options;
}
```
Same shape for `household-automation/index.ts` → `registerHouseholdAutomationTools`. (Remove the `void` placeholders as soon as real registrations are added in later phases.)

**Step 2 — `server.ts`:** import `ToolsetName` from `./config.js`; extend `ServerOptions`; add conditional calls.
```ts
import type { ToolsetName } from "./config.js";
import { registerHouseholdTools } from "./tools/households/index.js";
import { registerHouseholdAutomationTools } from "./tools/household-automation/index.js";

export type ServerOptions = { readOnly: boolean; toolsets: ReadonlySet<ToolsetName> };
// ...after the default registrations:
  if (options.toolsets.has("households")) registerHouseholdTools(server, client, options);
  if (options.toolsets.has("automation")) registerHouseholdAutomationTools(server, client, options);
```

**Step 3 — `index.ts`:** thread `toolsets` into BOTH `createServer` calls (`startStdio` + `handleMcpPost`):
```ts
const server = createServer(client, {
  readOnly: config.MEALIE_READ_ONLY,
  toolsets: config.MEALIE_TOOLSETS,
});
```

**Step 4 — `server.test.ts`:** generalize `listToolNames` to take options + assert default surface unchanged AND empty-toolset enabling is a no-op.
```ts
import type { ToolsetName } from "./config.js";
const NO_TOOLSETS: ReadonlySet<ToolsetName> = new Set();
async function listToolNames(opts: {
  readOnly: boolean;
  toolsets?: ReadonlySet<ToolsetName>;
}): Promise<string[]> {
  const server = createServer(new MealieClient("https://m.test", "tok"), {
    readOnly: opts.readOnly,
    toolsets: opts.toolsets ?? NO_TOOLSETS,
  });
  /* ...unchanged transport/list/close... */
}
```
Update the two existing tests to call `listToolNames({ readOnly: true })` / `({ readOnly: false })` (still 26 / 66). Add:
```ts
it("enabling toolsets that register nothing yet leaves the default surface unchanged", async () => {
  const names = await listToolNames({ readOnly: false, toolsets: new Set(["households", "automation"]) });
  expect(names).toHaveLength(66); // grows to 79 in Phase 6 as tools land
});
```
> NOTE: the toolsets-on count assertions are finalized in **Phase 6** once all 13 tools exist; during Phases 1–5 only per-tool unit tests change. Update this placeholder count as you go OR (preferred) leave a single `it.todo` and replace in Phase 6. Keep the **default 26/66** assertions green at every step.

**Step 5 — quality gate; commit:** `feat(server): conditional opt-in toolset registration + empty households/automation registrars`

---

## Phase 1 — household_automation: webhooks (the resource archetype)

Dir `src/tools/household-automation/`. Schemas (verified): `CreateWebhook` (POST+PUT body; **no distinct *Update**), `ReadWebhook` (response), `WebhookPagination` (list). Enum `WebhookType=['mealplan']` (single-member). Path base `/api/households/webhooks`.

### Task 1.1: `webhook-projection.ts`

**File:** Create `src/tools/household-automation/webhook-projection.ts` (+ test).
```ts
import type { components } from "../../types/mealie.js";
/** Full webhook as returned by Mealie. */
export type Webhook = components["schemas"]["ReadWebhook"];
/** Concise fields (omit groupId/householdId noise). */
const CONCISE_FIELDS = ["id", "name", "url", "enabled", "webhookType", "scheduledTime"] as const;
export function projectWebhook(hook: Webhook, format: "concise" | "detailed"): Record<string, unknown> {
  if (format === "detailed") return hook as unknown as Record<string, unknown>;
  const source = hook as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}
```
**Test:** detailed returns whole; concise keeps only the 6 fields. **Commit:** `feat(automation): webhook projection`.

### Task 1.2: `webhook_get` (read)

**File:** Create `webhook-get.ts` (+ test). Client surface `Pick<MealieClient,"get"|"getPaginated">`.

**Contract:** branch on `item_id`. Absent → `getPaginated<Webhook>("/api/households/webhooks", {page, perPage:perPage??20, orderBy, orderDirection, orderByNullPosition, queryFilter})`, return `toConcise(page)` (items projected via the 6-field concise map + pagination meta, like `food-search`). Present → `get<Webhook>("/api/households/webhooks/{item_id}")` → `projectWebhook(hook, response_format ?? "concise")`. inputSchema: `item_id?`, `response_format?`, `page?`, `perPage?` (max 100), `orderBy?`, `orderDirection?: enum[asc,desc]`, `orderByNullPosition?: enum[first,last]`, `queryFilter?`. Annotations `{ readOnlyHint:true, openWorldHint:true }` (list branch is idempotent but the tool is dual-mode; keep `readOnlyHint`).

**Tests:** no `item_id` → calls `getPaginated` with default perPage 20, returns items+meta; with `item_id` → calls `get` at the `/{id}` path, concise vs detailed projection; client throw → `isError`.
**Commit:** `feat(automation): webhook_get (list + get-by-id)`.

### Task 1.3: `webhook_write` (create | update | delete dispatcher)

**File:** Create `webhook-write.ts` (+ test). Client surface `Pick<MealieClient,"get"|"post"|"put"|"delete">`.

**inputSchema:** `action: z.enum(["create","update","delete"])`; create fields `name?`, `url?`, `webhookType?: z.enum(["mealplan"])`, `enabled?: z.boolean()`, `scheduledTime?` (string, "HH:MM" time); `item_id?` (update/delete); `changes?: z.record(z.unknown())` (update fetch-merge passthrough); `confirm?` (delete).

**Handler** (mirror `mealplan-rule-write`):
```ts
export async function webhookWriteHandler(client, args): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);   // confirm gate inside, before try
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "webhook_write", "Failed to write webhook");
  }
}
```
- `create`: require `name`, `url`, `scheduledTime` (else `missing(...)`). Build typed body and POST:
```ts
const body: components["schemas"]["CreateWebhook"] = {
  enabled: args.enabled ?? true,
  name: args.name as string,
  url: args.url as string,
  webhookType: args.webhookType ?? "mealplan",
  scheduledTime: args.scheduledTime as string,
};
return jsonResult(projectWebhook(await client.post<Webhook>("/api/households/webhooks", body), "concise"));
```
- `update`: require `item_id` + `changes`; fetch-merge:
```ts
const path = `/api/households/webhooks/${args.item_id}`;
const current = await client.get<Record<string, unknown>>(path);
const merged = { ...current, ...args.changes };
return jsonResult(projectWebhook(await client.put<Webhook>(path, merged), "concise"));
```
- `remove`: require `item_id`; `requireConfirmation(args.confirm, 'delete webhook "<id>"')` BEFORE the try; `await client.delete(path)`; return `{ deleted: args.item_id }` (webhook delete returns the entity at 200 — we deliberately synthesize the uniform shape).

Annotations `{ readOnlyHint:false, destructiveHint:true, idempotentHint:true, openWorldHint:true }` (destructive because the dispatcher includes delete; PUT path is idempotent).

**Tests:** create maps the typed body (defaults: enabled true, webhookType 'mealplan') + requires name/url/scheduledTime (missing → `isError`); update fetch-merges (fake `get` returns a full webhook with `scheduledTime`/`url`; assert the PUT body retains untouched fields and applies `changes`); delete missing `confirm` → `isError`, with `confirm:true` → `{deleted}` + DELETE called; client throw → `isError`.
**Commit:** `feat(automation): webhook_write (create/update[fetch-merge]/delete[confirm])`.

### Task 1.4: `webhook_action` (test | rerun)

**File:** Create `webhook-action.ts` (+ test). Client surface `Pick<MealieClient,"post">`.

**inputSchema:** `action: z.enum(["test","rerun"])`; `item_id?` (required for `test`).
**Handler:** `test` → require `item_id`; `await client.post("/api/households/webhooks/{item_id}/test", {})` → return `{ ok: true, action: "test", item_id }` (response is untyped `unknown` — do NOT parse). `rerun` → `await client.post("/api/households/webhooks/rerun", {})` → `{ ok: true, action: "rerun" }`. Wrap in try/`errorResult`.
> The generic verbs send a JSON body; passing `{}` is fine (endpoints take no body; Mealie ignores it). If a no-body POST is preferred, pass `undefined` — `#send` will `JSON.stringify(undefined)` → `"undefined"`; **prefer `{}`** to keep a valid empty JSON body.

Annotations `{ readOnlyHint:false, openWorldHint:true }` (NOT destructive; side-effecting). Registered as a **write** (Phase 1.6 index).

**Tests:** `test` requires `item_id` (missing → `isError`); `test` posts to the `/{id}/test` path and returns a generic ok echo (does not assume a typed body — fake `post` resolves `undefined`); `rerun` posts to `/rerun`; client throw → `isError`.
**Commit:** `feat(automation): webhook_action (test/rerun — non-destructive, write-gated)`.

### Task 1.5: Wire webhooks into `household-automation/index.ts`

Replace the stub body: register `webhook_get` (read), then `if (options.readOnly) return;`, then `webhook_write`, `webhook_action`. Quality gate. **Commit:** `feat(automation): register webhooks behind the automation toolset`.

### Task 1.6: e2e smoke for the automation toolset (webhooks only)

In `server.test.ts`, extend the placeholder toolset-on test to assert `webhook_get` present when `toolsets:{automation}`, absent by default, and `webhook_write`/`webhook_action` stripped under read-only. (Counts finalized Phase 6.) **Commit:** `test(server): automation toolset exposes webhook tools (read/write split)`.

---

## Phase 2 — household_automation: event_notifications

Schemas (verified): `GroupEventNotifierCreate` (create: `name` + optional `appriseUrl`), `GroupEventNotifierUpdate` (**distinct *Update BUT full-replace**: `name`/`enabled`/`groupId`/`householdId`/`options`/`id` required + `appriseUrl?`), `GroupEventNotifierOut` (response), `GroupEventPagination` (list). `options` = `GroupEventNotifierOptions` (**27 required @default-false booleans**). Path base `/api/households/events/notifications`. **Delete → bare 204.** **Test → bare 204** (live Apprise send).

### Task 2.1: `event-notification-projection.ts`
`type EventNotifier = components["schemas"]["GroupEventNotifierOut"]`. Concise omits the heavy `options`: `CONCISE_FIELDS = ["id","name","enabled","appriseUrl"]`. Detailed returns whole. **Commit.**

### Task 2.2: `event_notification_get` (read)
Same dual-mode shape as `webhook_get`: list → `getPaginated<EventNotifier>(".../notifications")` concise items `{id,name,enabled}`; single → `projectEventNotifier(get<EventNotifier>(".../{id}"), fmt)`. **Tests** mirror 1.2. **Commit.**

### Task 2.3: `event_notification_write` (create | update | delete)
Mirror `webhook_write` with these differences:
- `create`: typed `GroupEventNotifierCreate { name: args.name, ...(args.appriseUrl !== undefined ? { appriseUrl: args.appriseUrl } : {}) }` (only `name` required; **no required-with-default fields** on create). POST → 201 `GroupEventNotifierOut`.
- `update`: fetch-merge `{...current, ...changes}` (current = `get<Record<string,unknown>>(".../{id}")`) — this is the **distinct-schema-but-full-replace trap**; the merge supplies `enabled` + the 27-bool `options` from the fetched record. PUT → 200.
- `delete`: confirm gate; `await client.delete(path)`; **expect no body (204)** → return `{ deleted: item_id }`.

Use `appriseUrl` conditional spread to satisfy `exactOptionalPropertyTypes`. **Tests:** create body (name only; appriseUrl present only when supplied); **update fetch-merge preserves `options` + `enabled`** (explicit silent-reset regression — fake `get` returns the full notifier with all 27 options; assert PUT body retains them); delete confirm gate + 204 path returns `{deleted}` even when `delete` resolves `undefined`. **Commit.**

### Task 2.4: `event_notification_test` (action verb)
`Pick<MealieClient,"post">`; require `item_id`; `await client.post(".../{id}/test", {})` → `{ ok:true, action:"test", item_id }` (204, no body — don't parse). `{ readOnlyHint:false, openWorldHint:true }`. **Tests:** posts to `/{id}/test`, requires `item_id`, generic echo, throw → `isError`. **Commit.**

### Task 2.5: Register notifications in `index.ts` (read; then writes `event_notification_write`, `event_notification_test`). Quality gate. **Commit.**

---

## Phase 3 — household_automation: recipe_actions

Schemas (verified): `CreateGroupRecipeAction` (`actionType`,`title`,`url` — 3 fields, all required, none defaulted), `SaveGroupRecipeAction` (**no distinct *Update**; PUT body = create's 3 + **required `groupId`+`householdId`**), `GroupRecipeActionOut` (response), `GroupRecipeActionPagination` (list). Enum `GroupRecipeActionType=['link','post']`. Path base `/api/households/recipe-actions`. **Delete → 200 + entity. Trigger → 202 `unknown`.**

### Task 3.1: `recipe-action-projection.ts`
`type RecipeAction = components["schemas"]["GroupRecipeActionOut"]`. `CONCISE_FIELDS=["id","actionType","title","url"]`. **Commit.**

### Task 3.2: `recipe_action_get` (read) — dual-mode, mirrors 1.2. **Commit.**

### Task 3.3: `recipe_action_write` (create | update | delete)
- `create`: typed `CreateGroupRecipeAction { actionType, title, url }` — require all three (`missing`). Enum `actionType` validated by `z.enum(["link","post"])`. POST → 201.
- `update`: **fetch-merge mandatory** — `SaveGroupRecipeAction` is a SUPERSET requiring `groupId`+`householdId` (server-injected on create, absent from `CreateGroupRecipeAction`). `current = get<Record<string,unknown>>(path)` carries them; `{...current, ...changes}` resends them. Assert in test that the PUT body includes `groupId`+`householdId` from the fetched record. PUT → 200.
- `delete`: confirm gate; returns 200 + entity → synthesize `{ deleted: item_id }`.
**Tests:** create requires the 3 fields + maps enum; **update fetch-merge carries groupId/householdId** (regression); delete confirm gate. **Commit.**

### Task 3.4: `recipe_action_trigger` (action verb)
`Pick<MealieClient,"post">`; inputSchema `item_id` (required), `recipe_slug` (required), `recipe_scale?: z.number()`. Path `/api/households/recipe-actions/{item_id}/trigger/{recipe_slug}`. Body: send `{ recipe_scale: args.recipe_scale ?? 1 }` (schema field required-in-body with @default 1). Returns **202 `unknown`** → `{ ok:true, action:"trigger", item_id, recipe_slug }` (don't parse). `{ readOnlyHint:false, openWorldHint:true }`. **Tests:** posts to the 2-path-param URL with `recipe_scale` body (default 1 when omitted); requires item_id+recipe_slug; throw → `isError`. **Commit.**

### Task 3.5: Register recipe-actions in `index.ts` (read; writes `recipe_action_write`, `recipe_action_trigger`). Quality gate. **Commit.** Automation domain now complete (3 reads + 6 writes = 9 tools).

---

## Phase 4 — households_mgmt: self-service

Dir `src/tools/households/`. Schemas (verified): `HouseholdInDB` (self), `ReadHouseholdPreferences`/`UpdateHouseholdPreferences` (9 prefs; **distinct *Update but full-replace**), `HouseholdStatistics`, `PaginationBase_UserOut_` (members, paginated), `HouseholdRecipeSummary` (thin `{lastMade?, recipeId}` pivot), `SetPermissions` (`userId` + 4 flags, all required; flags @default false), `UserOut` (permissions response).

### Task 4.1: `household-projection.ts`
`type Household = components["schemas"]["HouseholdInDB"]`. Concise for the `household` view: `["id","name","slug","groupId"]`. Detailed returns whole. (Preferences/statistics/recipe-pivot return whole — already tiny.) **Commit.**

### Task 4.2: `household_self_get` (view dispatcher, read)
**File:** `household-self-get.ts`. Client `Pick<MealieClient,"get"|"getPaginated">`.
**inputSchema:** `view?: z.enum(["household","preferences","statistics","members","recipe"])` (default `household`), `recipe_slug?` (required for `recipe`), `response_format?` (household view), members pagination (`page?`,`perPage?`,`orderBy?`,`orderDirection?`,`orderByNullPosition?`,`queryFilter?`).
**Handler** routes by view:
- `household` → `projectHousehold(get<Household>("/api/households/self"), fmt)`.
- `preferences` → `get("/api/households/preferences")` whole.
- `statistics` → `get("/api/households/statistics")` whole.
- `members` → `getPaginated("/api/households/members", {page, perPage:perPage??20, orderBy, orderDirection, orderByNullPosition, queryFilter})` whole page.
- `recipe` → require `recipe_slug` (`missing`); `get("/api/households/self/recipes/{recipe_slug}")` whole; description notes it's a thin pivot, not full recipe content.
Wrap in try/`errorResult`. `{ readOnlyHint:true, openWorldHint:true }`.
**Tests:** each view hits the right path; default view = household + concise/detailed; members default perPage 20; `recipe` without slug → `isError`; throw → `isError`. **Commit.**

### Task 4.3: `household_self_update` (target dispatcher, write)
**File:** `household-self-update.ts`. Client `Pick<MealieClient,"get"|"put">`.
**inputSchema:** `target: z.enum(["preferences","permissions"])`; `changes?: z.record(z.unknown())` (preferences fetch-merge passthrough); permissions fields `userId?`, `canManageHousehold?`, `canManage?`, `canInvite?`, `canOrganize?` (all booleans); `confirm?` (permissions gate).
**Handler:**
- `preferences`: require `changes`; fetch-merge `current = get<Record>("/api/households/preferences")` (the read counterpart `ReadHouseholdPreferences` = update fields + id); `merged = {...current, ...changes}`; PUT `/api/households/preferences`; return whole (or projected). **No confirm.** `idempotentHint`.
- `permissions`: **privilege-elevating → confirm-gated**: `requireConfirmation(args.confirm, 'change permissions for member <userId>')` BEFORE the try. Require `userId`. **Fetch-merge the member's current flags** so an omitted flag never downgrades: read the member's current `UserOut` (members view paginated → find by id, OR document that the caller passes all 4 flags). **Decision:** require `userId`, then build `SetPermissions { userId, canManageHousehold, canManage, canInvite, canOrganize }` where each flag = `args.flag ?? <current>`; fetch current via `getPaginated("/api/households/members")` and locate the member by `id===userId` to source current flags (fallback: if not found, default the 4 flags to the supplied values, treating absent as `false` only with an explicit note). PUT `/api/households/permissions`; **echo the resulting flag set** in the response (`{ userId, permissions: {...} }`). `destructiveHint:true`.

> Implementation note for the permissions merge: `PaginationBase_UserOut_.items` are `UserOut` carrying the 4 permission booleans. Find `items.find(u => u.id === userId)`; under `noUncheckedIndexedAccess`, guard the lookup. If the member isn't in the current household page, return an `isError` ("member not found in household") rather than guessing flags — safer than a silent reset.

**Tests:** preferences fetch-merge preserves untouched prefs (regression); permissions missing `confirm` → `isError`; permissions with `confirm:true` fetch-merges current flags (fake members page) so an omitted flag is preserved, echoes resulting flags; missing `userId` → `isError`; member-not-found → `isError`; throw → `isError`. **Commit.**

---

## Phase 5 — households_mgmt: invitations

Schemas (verified): `ReadInviteToken` (**bare array** on GET; `{token,usesLeft,groupId,householdId}`), `CreateInviteToken` (`uses` required no default; `groupId?`,`householdId?`), `EmailInvitation` (`email`,`token`), `EmailInitationResponse` (**verbatim typo**; `{success, error?}`).

### Task 5.1: `household_invitations_list` (read)
**File:** `household-invitations-list.ts`. Client `Pick<MealieClient,"get">`. **No pagination** — `get<components["schemas"]["ReadInviteToken"][]>("/api/households/invitations")` → return `{ items, count: items.length }` (precedent: organizer empty branch). `{ readOnlyHint:true, openWorldHint:true }`.
**Tests:** returns the bare array wrapped as `{items,count}`; uses `get` not `getPaginated`; throw → `isError`. **Commit.**

### Task 5.2: `household_invite` (create | send_email dispatcher, write)
**File:** `household-invite.ts`. Client `Pick<MealieClient,"post">`.
**inputSchema:** `action: z.enum(["create","send_email"])`; `uses?: z.number().int().positive()`, `groupId?`, `householdId?` (create); `email?`, `token?` (send_email).
**Handler:**
- `create`: require `uses`; typed `CreateInviteToken { uses, ...(groupId?...), ...(householdId?...) }`; POST `/api/households/invitations` → 201 `ReadInviteToken`; return it.
- `send_email`: require `email` + `token`; typed `EmailInvitation { email, token }`; POST `/api/households/invitations/email` → `EmailInitationResponse` (reference the typo'd schema key exactly); return `{ success, error }`. **Fires an email** — note in description; no confirm.
Wrap in try/`errorResult`. `{ readOnlyHint:false, openWorldHint:true }` (non-destructive; no `destructiveHint`).
**Tests:** create requires `uses` + maps optional ids via conditional spread; send_email requires email+token + returns the typed `{success,error}`; missing fields → `isError`; throw → `isError`. **Commit.**

### Task 5.3: Wire households into `households/index.ts`
Register reads (`household_self_get`, `household_invitations_list`), then `if (options.readOnly) return;`, then writes (`household_self_update`, `household_invite`). Quality gate. **Commit:** households domain complete (2 reads + 2 writes = 4 tools).

---

## Phase 6 — Finalize e2e, README, real-stdio verification

### Task 6.1: `server.test.ts` — final toolset-on counts
Add to `READ_TOOLS` (default-axis stays untouched) a new opt-in arrays + a `describe("opt-in toolsets")` block:
```ts
const OPTIN_READS = ["household_self_get","household_invitations_list",
  "webhook_get","event_notification_get","recipe_action_get"];
const OPTIN_WRITES = ["household_self_update","household_invite",
  "webhook_write","webhook_action","event_notification_write","event_notification_test",
  "recipe_action_write","recipe_action_trigger"];
```
Assertions:
- default (no toolsets), full → **66**, read-only → **26**; none of `OPTIN_READS`/`OPTIN_WRITES` present.
- `toolsets:{households,automation}`, full → **79**; all OPTIN_READS + OPTIN_WRITES present.
- `toolsets:{households,automation}`, read-only → **31**; OPTIN_READS present, OPTIN_WRITES absent.
- (optional) `toolsets:{households}` only → default + 2 reads + 2 writes; no `webhook_*` etc.
Quality gate. **Commit:** `test(server): opt-in toolset e2e — 79 full / 31 read-only, 66/26 default unchanged`.

### Task 6.2: README — document the toolset switch + new domains
Add `MEALIE_TOOLSETS` to the env table; a "Opt-in toolsets" section (households, automation tokens; compose with `MEALIE_READ_ONLY`); list the 13 tools. **Commit:** `docs(readme): MEALIE_TOOLSETS + households/automation tools`.

### Task 6.3: Real-stdio subprocess check (manual verification, not committed unless scripted)
Build, then run the server over stdio with a throwaway client for three configs and assert `tools/list` counts: (a) default → 66 (and 26 with `MEALIE_READ_ONLY=true`), no `household_*`/`webhook_*`; (b) `MEALIE_TOOLSETS=households,automation` → 79; (c) + `MEALIE_READ_ONLY=true` → 31. Confirm `app_get_info` returns 200 against `demo.mealie.io`. **demo caveat:** household/webhook/notification/recipe-action endpoints are 401 without a token → their reads+writes can't be live-tested; record "real-instance testing owed" in the PR body.

### Task 6.4: Adversarial multi-lens code review (workflow), then hand off
Run the review workflow (correctness/contract · conventions/strict-TS · test-quality · security[permissions gate]). Address findings. Then push and open the **draft** PR into `develop`; the owner runs `superpowers:requesting-code-review` before merge.

---

## Done criteria
- `npm run build && npm run typecheck && npm run test && npm run lint` exit 0.
- `server.test.ts`: 66/26 default unchanged; 79/31 with both toolsets; read-only strips opt-in writes.
- All 5 PUTs fetch-merge (regression tests green); 3 deletes confirm-gated; permissions confirm-gated + no silent downgrade; action verbs write-gated.
- Both new dirs under the 20-file cap; no sibling cross-imports; JSDoc on all exports; no magic numbers; methods ≤25 lines / ≤2 nesting.
- Draft PR into `develop`; real-instance testing gap noted.
