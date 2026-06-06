# PR #10 — Opt-in: Admin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Per the project owner's instruction the build runs **sequentially in the main loop** (shared `config.ts`/`server.ts`/`server.test.ts`/`index.ts` + a per-step quality gate make parallel subagents unsafe).

**Goal:** Add the opt-in `admin` toolset — 17 MCP tools covering all 38 `/api/admin/*` operations — by reusing the existing `MEALIE_TOOLSETS` switch (4th reuse).

**Architecture:** New `src/tools/admin/` with `manage/` + `site/` subdirs (19 source files would crowd the 20-cap flat), one tool per file, `index.ts` read/write split, registered behind a new `admin` token via one conditional in `createServer`. All consolidation in the tool layer atop existing generic `MealieClient` verbs; **no client changes**. Default surface stays 26/66.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk`, `zod`, Vitest (hand-written fakes), Biome, tsup. Types in `src/types/mealie.ts` (generated, authoritative).

**Design:** [`2026-06-06-admin-design.md`](./2026-06-06-admin-design.md) — read §3 (per-tool contracts) and §4.2–§4.3 (secrets + gotchas) before each task.

**Archetype files to mirror (read once up front):**
- `src/tools/app/app-get-info.ts` — aggregated read with `include` (admin_about mirrors this).
- `src/tools/app/app-download-file.ts` — download-URL composition off `client.baseUrl` (admin_backup_get's file_name branch).
- `src/tools/foods-units/food-search.ts` — pagination passthrough + slim list items (the three paginated admin lists).
- `src/tools/users/user-me.ts` / `user-projection.ts` — view-dispatcher read + projection helper shape.
- `src/tools/users/user-self-update.ts` — whitelist fetch-merge (`Object.fromEntries` filter; no `delete`, no destructure-discards).
- `src/tools/users/user-api-token-write.ts` — action write-dispatcher + write-once secret surfacing (`SHOWN_ONCE_NOTE`) + confirm gate placement.
- `src/tools/users/user-password-write.ts` — `secretSafeErrorResult` usage in a secret-bearing dispatcher.
- `src/tools/users/user-avatar-upload.ts` — registration-layer file read **without** a confirm precondition (`loadAvatar`); `src/tools/groups/group-start-migration.ts` — multipart form assembly.
- `src/tools/groups/group-ai-provider-write.ts` — AI-provider create/update/delete incl. apiKey re-supply semantics (admin version adds `group_id` + admin paths).
- `src/tools/groups/group-seed.ts` — `SuccessResponse.error:true`-on-200 handling.
- `src/tools/result.ts` (`jsonResult`/`errorResult`/`secretSafeErrorResult`), `src/tools/confirm.ts` (`requireConfirmation`).

**Inventory facts (adversarially verified against `src/types/mealie.ts` — trust these over memory):**
- **38 ops total**: about=3 + email-ready=1, users=7, households=5, groups=5, ai-providers=4, email-test=1, backups=6, maintenance=5, debug=1.
- **PUT /api/admin/users/{item_id} body IS `UserOut`** (the read schema — NO UserUpdate/AdminUserIn exists). Straight fetch-merge round-trip: send the merged full object **including** `id`/`groupId`/`groupSlug`/`householdId`/`householdSlug`/`cacheKey`/`tokens`. The PUT **cannot change a password** (UserOut has no password field).
- **`UserIn`** (admin create): truly-required `username`/`fullName`/`email`/`password` (plaintext secret); required-with-@default `authMethod`("Mealie"), `admin`(false), `advanced`(false), `showAnnouncements`(true), `canInvite`/`canManage`/`canManageHousehold`/`canOrganize`(false); optional `id`/`group`/`household`/`lastReadAnnouncement`. 201 → UserOut (no password echo).
- **`POST /api/admin/users/password-reset-token`**: body `ForgotPassword {email}` → **201 `PasswordResetToken {token}` — the RESPONSE is the secret** (write-once surfacing). **unlock**: POST, no body, optional `force` boolean **query** flag → `UnlockResults {unlocked: number}`.
- **`UpdateHouseholdAdmin`** (distinct, narrower than read): `{id: uuid4 REQUIRED IN BODY, groupId: uuid4 required, name required, preferences?: UpdateHouseholdPreferences}` — read-side `slug`/`group`/`users`/`webhooks` NOT accepted. **`GroupAdminUpdate`**: `{id: uuid4 REQUIRED IN BODY, name required, preferences?: UpdateGroupPreferences, aiProviderSettings?: AIProviderSettingsUpdate}` — read-side `slug`/`categories`/`webhooks`/`households`/`users` NOT accepted; `aiProviderSettings` is **write-only** (absent from GroupInDB — cannot be fetch-merged).
- **`HouseholdCreate {name required, groupId?: string|null}`** (groupId plain string, no uuid format). **`GroupBase {name}`** — one field.
- **AI providers**: SAME schemas as PR #8 (`AIProviderCreate`/`AIProviderUpdate`/`AIProviderOut`) + an extra `group_id` path param; **create returns 200, not 201**; NO admin list endpoint and NO admin settings path (both group-scoped only, PR #8). `apiKey` is write-only (@default "") — fetch-merge cannot recover it; re-supply or it blanks.
- **Backups**: GET list → **`AllBackups` WRAPPER `{imports: BackupFile[], templates: string[]}`** (`BackupFile {name, date, size: STRING}`); POST create → **no body**, 201 `SuccessResponse`; GET `{file_name}` → **`FileTokenResponse {fileToken}`** (a download token for `/api/utils/download`, NOT bytes; the token is secret-bearing on error paths); upload → multipart `Body_upload_one_api_admin_backups_upload_post`, single required field verbatim **`archive`**; restore → POST, **no body**, target via path param only, 200 `SuccessResponse`.
- **Maintenance**: `MaintenanceSummary {dataDirSize: STRING, cleanableImages: number, cleanableDirs: number}`; `MaintenanceStorageDetails` = 5 required STRING sizes; the 3 cleans POST with **no body** → `SuccessResponse`; all destructive (upstream has no confirm flag).
- **Email**: GET → `EmailReady {ready}`; POST → body `EmailTest {email}` (JSON) → `EmailSuccess {success: boolean, error?: string|null}` — **positive-success**: HTTP 200 + `success:false` + error MESSAGE STRING = failure (differs from `SuccessResponse {message, error: boolean}`).
- **Debug**: POST `/api/admin/debug/openai/{provider_id}`; body = OPTIONAL multipart `Body_debug_openai_…_post {image?: string|null}` (field verbatim `image`) → `DebugResponse {success, response?: string|null}`.
- **All path params are plain `string`** (item_id/group_id/provider_id/file_name — no uuid4 format upstream; never uuid-validate). **No bare-array lists** (3 pagination envelopes via `getPaginated` + the AllBackups wrapper).
- **Redactions** (model-facing output only, never the merge base): `AdminAboutInfo.dbUrl` (may embed DB credentials), `UserOut.cacheKey`. Negative: `UserOut.tokens` is metadata-only — keep it.
- **`secretSafeErrorResult` catch blocks** (secrets ride requests OR responses): `admin_user_write`, `admin_user_actions`, `admin_ai_provider_write`, `admin_backup_get`, `admin_about`.

**Quality gate — run at the end of EVERY task before committing:**
```bash
npm run build && npm run typecheck && npm run test && npm run lint
```
Exit 0 required. Auto-fix import-order/format with `npx biome check --write src/`. Strict-TS reminders: optional MCP-arg fields need explicit `| undefined`; test fakes of generic client methods must be generic (`async <T>(): Promise<T>`); conditional spreads for optional body/query fields; no `delete`, no unused destructure-discards (project via `Object.fromEntries(...filter)`).

---

## Phase 0 — Toolset wiring + `admin_about` (folded, per the PR #8/#9 precedent)

### Task 0.1: Register the `admin` token

**Files:** Modify `src/config.ts:28`, `src/config.test.ts`.

**Step 1 — failing tests (`config.test.ts`):**
```ts
it("enables the admin toolset", () => {
  expect(parseToolsets("admin")).toEqual(new Set(["admin"]));
});

it("enables all five toolsets together", () => {
  expect(parseToolsets("households,automation,groups,users,admin")).toEqual(
    new Set(["households", "automation", "groups", "users", "admin"]),
  );
});
```

**Step 2 — run, expect FAIL** (`admin` unknown → warned + ignored): `npx vitest run src/config.test.ts`

**Step 3 — implement:**
```ts
export const KNOWN_TOOLSETS = ["households", "automation", "groups", "users", "admin"] as const;
```

**Step 4 — run config tests, expect PASS.** No commit yet — the token lands with the first tool (Task 0.2; Biome bans an empty registrar's unused params).

### Task 0.2: `admin_about` (aggregated read) + projection + index + server conditional

**Files:**
- Create: `src/tools/admin/admin-projection.ts`
- Create: `src/tools/admin/site/admin-about.ts` (+ `.test.ts`)
- Create: `src/tools/admin/index.ts`
- Modify: `src/server.ts`

**Step 1 — projection helper** `admin-projection.ts` (the shared pick/omit primitives + per-resource projections; mirror `user-projection.ts`'s shape):
```ts
import type { components } from "../../types/mealie.js";

/** An admin-visible user, as returned by the /api/admin/users endpoints. */
export type AdminUser = components["schemas"]["UserOut"];
/** Instance diagnostics from GET /api/admin/about. */
export type AdminAbout = components["schemas"]["AdminAboutInfo"];

/** Output-only redactions: dbUrl may embed DB credentials; cacheKey is an opaque
 * session-ish value. Stripped from every model-facing result (NEVER from the
 * fetch-merge base — the user PUT must round-trip cacheKey/tokens). */
const ABOUT_REDACTED_FIELDS = ["dbUrl"] as const;
const USER_REDACTED_FIELDS = ["cacheKey"] as const;
const USER_CONCISE_FIELDS = [
  "id", "username", "fullName", "email", "admin", "authMethod",
  "group", "household", "groupId", "householdId", "tokens",
] as const;

export function pickFields(source, fields): Record<string, unknown> { /* Object.fromEntries filter-in */ }
export function omitFields(source, fields): Record<string, unknown> { /* Object.fromEntries filter-out */ }
export function projectAdminAbout(about: AdminAbout): Record<string, unknown> { /* omit dbUrl */ }
export function projectAdminUser(user: AdminUser, format: "concise" | "detailed"): Record<string, unknown> {
  /* detailed → omit USER_REDACTED_FIELDS; concise → pick USER_CONCISE_FIELDS (no cacheKey in the list) */
}
```
(Household/group/provider projections are added in their own tasks — YAGNI now.) JSDoc every export (`@param`/`@returns`).

**Step 2 — failing test (`admin-about.test.ts`):** mirror `app-get-info.test.ts`. Cover:
- default (no include) → `get("/api/admin/about")` only; result has `about.version`-style fields and **NO `dbUrl` key** (fake returns `dbUrl: "postgres://user:pass@host/db"` — assert the stringified result does not contain `"postgres://"`).
- `include: ["statistics", "check", "email_ready"]` → additionally `get("/api/admin/about/statistics")`, `get("/api/admin/about/check")`, `get("/api/admin/email")`; result carries `statistics` (integer counts), `check` (readiness booleans), `email_ready` (`{ready}`).
- error path: client throws `MealieApiError` (status 500, detail `"postgres://leak"`) → `isError`, text contains `HTTP 500` and **NOT** `"postgres://"` (`secretSafeErrorResult`).

**Step 3 — run, expect FAIL:** `npx vitest run src/tools/admin/site/admin-about.test.ts`

**Step 4 — implement** `site/admin-about.ts`:
```ts
const ABOUT_PATH = "/api/admin/about";
const STATISTICS_PATH = "/api/admin/about/statistics";
const CHECK_PATH = "/api/admin/about/check";
const EMAIL_READY_PATH = "/api/admin/email";
const INCLUDE_SECTIONS = ["statistics", "check", "email_ready"] as const;
type GetClient = Pick<MealieClient, "get">;
// inputSchema: include: z.array(z.enum(INCLUDE_SECTIONS)).optional()
```
Sequential awaited gets per included section (mirror `app-get-info.ts`); base result `{ about: projectAdminAbout(...) }`. Catch = `secretSafeErrorResult(error, "admin_about", "Failed to read admin info")`. `name: "admin_about"`, `title: "Get Admin Instance Info"`, `annotations: { readOnlyHint: true, openWorldHint: true }`. Description: "Read instance diagnostics (version, config — DB connection string redacted) plus optional statistics, config check, and email readiness. Note: check.emailReady and email_ready report the same readiness (the API exposes both)."

**Step 5 — create `src/tools/admin/index.ts`** (mirror `users/index.ts`; JSDoc names the toolset + the site-operator scope):
```ts
export type RegisterOptions = { readOnly: boolean };
export function registerAdminTools(server, client, options): void {
  // Reads (always on).
  registerAdminAbout(server, client);
  if (options.readOnly) return;
  // Writes (stripped under read-only) — added per task.
}
```

**Step 6 — wire `src/server.ts`:** import `registerAdminTools` (alphabetical — it sorts FIRST among the tools imports) + conditional after the `users` block:
```ts
  if (options.toolsets.has("admin")) {
    registerAdminTools(server, client, options);
  }
```

**Step 7 — full gate, expect PASS** (no existing test enables `admin` → default still 26/66).

**Step 8 — commit:**
```bash
git add src/config.ts src/config.test.ts src/server.ts src/tools/admin/
git commit -m "feat(admin): register opt-in admin toolset + admin_about (dbUrl redacted)"
```

---

## Phase 1 — `admin_user_get` (read — paginated list + by-id)

### Task 1.1: `admin_user_get`

**Files:** Create `src/tools/admin/manage/admin-user-get.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- no `item_id` → `getPaginated("/api/admin/users", { perPage: 20, ... })` (passthrough `search→queryFilter`? NO — admin lists have `queryFilter`, pass `page`/`perPage`/`orderBy`/`orderDirection`/`queryFilter` straight through); slim items `{id, username, fullName, email, admin}` + pagination meta (`total`/`page`/`perPage`/`totalPages`).
- `item_id: "u1"` → `get("/api/admin/users/u1")`; concise result keeps `tokens` and **drops `cacheKey`** (fake returns `cacheKey: "leak-me"`; assert absent); `response_format: "detailed"` returns everything except `cacheKey`.
- `isError` on throw (plain `errorResult` — no secrets here).

**Step 2 — run, expect FAIL.**

**Step 3 — implement** (mirror `food-search.ts` for the list + `user-me.ts` for the entity branch):
```ts
const USERS_PATH = "/api/admin/users";
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
type GetClient = Pick<MealieClient, "get" | "getPaginated">;
// inputSchema: item_id? (plain z.string() — no uuid validation), queryFilter?,
//   page?/perPage?/orderBy?/orderDirection?, response_format?
```
`name: "admin_user_get"`, `title: "Admin: Get Users"`, read annotations. Description: "List all users on the instance (paginated) or read one by id (admin-only). The token list shows ids/names only, never token values."

**Step 4 — PASS. Step 5 — register read in `index.ts`. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_user_get — paginated list + by-id (cacheKey redacted)"`

---

## Phase 2 — `admin_user_write` (write — UserOut round-trip merge + password secret)

### Task 2.1: `admin_user_write`

**Files:** Create `src/tools/admin/manage/admin-user-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `action: "create", username: "sam", fullName: "Sam", email: "s@x.io", password: "pw-secret"` → `post("/api/admin/users", body)` where body carries the 8 required-with-defaults (`authMethod: "Mealie"`, `admin: false`, `advanced: false`, `showAnnouncements: true`, `canInvite/canManage/canManageHousehold/canOrganize: false`) and NO `group`/`household` keys (conditional spreads); fake returns a UserOut → result is the concise projection; **stringified result does NOT contain `"pw-secret"`**.
- `action: "create", admin: true, group: "Home"` → body carries `admin: true` + `group: "Home"`.
- `action: "create"` missing any of the four required fields → `isError`, no client call.
- `action: "update", item_id: "u1", changes: { fullName: "New" }` → `get("/api/admin/users/u1")` (fake returns a full UserOut incl. `cacheKey: "ck"`, `tokens: [...]`, `groupId: "g1"`) then `put("/api/admin/users/u1", merged)` where merged has `fullName: "New"` AND **still carries `cacheKey`/`tokens`/`groupId`** (the PUT body IS UserOut — round-trip, don't strip); result's `user` projection **does not** contain `cacheKey`.
- `action: "update"` without `item_id` or without `changes` → `isError`.
- `action: "delete", item_id: "u1"` without `confirm` → `isError`, zero client calls; with `confirm: true` → `delete("/api/admin/users/u1")` → `{ deleted: "u1" }`.
- error path: throw `MealieApiError` (422, detail echoing `"pw-secret"`) → `isError`, text has `HTTP 422`, **NOT** `"pw-secret"` (`secretSafeErrorResult`).

**Step 2 — run, expect FAIL.**

**Step 3 — implement** (dispatcher mirrors `user-api-token-write.ts`; merge mirrors `user-self-update.ts` but **without** a whitelist — straight `{ ...current, ...changes }`):
```ts
const USERS_PATH = "/api/admin/users";
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;
type UserIn = components["schemas"]["UserIn"];
// inputSchema: action enum [create|update|delete]; username?/fullName?/email?/password? (create);
//   admin?/advanced? (z.boolean(), create); group?/household? (NAME strings, create);
//   item_id? (update/delete); changes? (z.record, update); confirm? (delete)
```
- create: typed `UserIn` literal — 4 required args + the 8 defaults + conditional spreads for `group`/`household`; echo `projectAdminUser(created, "concise")`. Comment: password is a request secret — never echoed/logged.
- update: GET by id as `Record<string, unknown>`, `const merged = { ...current, ...args.changes };`, PUT full merged (comment: the PUT schema IS UserOut — server-derived fields round-trip; a partial body would silently reset flags). Echo `{ updated: item_id, user: projectAdminUser(merged as AdminUser, "concise") }`. Description notes: **cannot change passwords** — use `admin_user_actions(password_reset_token)`.
- delete: `requireConfirmation(confirm, \`delete user ${item_id}\`)` before the try; DELETE → `{ deleted: item_id }`.
- Catch = `secretSafeErrorResult(error, "admin_user_write", "Failed to write user")` for ALL branches.
- `name: "admin_user_write"`, `annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }`.

**Step 4 — PASS. Step 5 — register write (after `if (options.readOnly) return;`). Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_user_write — create/update/delete[confirm] (UserOut round-trip, secretSafe)"`

---

## Phase 3 — `admin_user_actions` (write — unlock + write-once reset token)

### Task 3.1: `admin_user_actions`

**Files:** Create: `src/tools/admin/manage/admin-user-actions.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `action: "unlock"` → `post("/api/admin/users/unlock", {})` (no `force` query when unset); fake returns `{ unlocked: 2 }` → `{ action: "unlock", unlocked: 2 }`.
- `action: "unlock", force: true` → query `{ force: true }` passed (assert the fake captured it).
- `action: "password_reset_token", email: "s@x.io"` → `post("/api/admin/users/password-reset-token", { email: "s@x.io" })`; fake returns `{ token: "reset-secret" }` → result **contains `token: "reset-secret"`** AND the shown-once note text.
- `action: "password_reset_token"` without `email` → `isError`, no client call.
- error path: `MealieApiError` whose detail embeds `"reset-secret"` → `isError`, `HTTP <status>` only, **no `"reset-secret"`** (`secretSafeErrorResult`).

**Step 2 — run, expect FAIL.**

**Step 3 — implement:**
```ts
const UNLOCK_PATH = "/api/admin/users/unlock";
const RESET_TOKEN_PATH = "/api/admin/users/password-reset-token";
/** The reset token appears only in this response — deliver it out-of-band, once. */
const SHOWN_ONCE_NOTE =
  "Deliver this reset token to the user out-of-band — it is shown only once and never retrievable again.";
type ActionsClient = Pick<MealieClient, "post">;
type ResetTokenResponse = components["schemas"]["PasswordResetToken"];
type ForgotBody = components["schemas"]["ForgotPassword"];
// inputSchema: action enum [unlock|password_reset_token]; force? (z.boolean(), unlock);
//   email? (password_reset_token)
```
- unlock: `client.post<UnlockResults>(UNLOCK_PATH, {}, ...(force !== undefined ? { force } : {}))` — match `client.post(path, body, query?)`; pass the query object only when `force` is set (conditional spread or a small `unlockQuery(args)` helper).
- password_reset_token: typed `ForgotBody`; echo `{ action, email, token: response.token, note: SHOWN_ONCE_NOTE }` — **the deliberate write-once exception** (user_api_token_write precedent).
- Catch = `secretSafeErrorResult(error, "admin_user_actions", "Failed to run user action")`.
- `name: "admin_user_actions"`, `title: "Admin: User Account Recovery"`, `annotations: { readOnlyHint: false, openWorldHint: true }` (non-destructive writes — no confirm). Description: "Unlock locked-out user accounts (optionally force) or generate a password-reset token for a user by email. The token is shown exactly once."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_user_actions — unlock / password-reset-token (shown once)"`

---

## Phase 4 — `admin_household_get` + `admin_household_write` (whitelist-projection archetype)

### Task 4.1: `admin_household_get`

**Files:** Create `src/tools/admin/manage/admin-household-get.ts` (+ `.test.ts`); Modify `index.ts`. Add `projectAdminHousehold` (+ `HOUSEHOLD_CONCISE_FIELDS = ["id", "name", "slug", "groupId", "group"]`) to `admin-projection.ts`.

**Step 1 — failing test:** list → `getPaginated("/api/admin/households", …)`, slim items `{id, name, slug, groupId}` + meta; `item_id: "h1"` → `get("/api/admin/households/h1")` concise/detailed; `isError` on throw (plain `errorResult`).

**Step 2 — FAIL. Step 3 — implement** (clone the Phase 1 shape; `HOUSEHOLDS_PATH = "/api/admin/households"`). Description: "List households across ALL groups (admin) or read one by id — household ids come from this list."

**Step 4 — PASS. Step 5 — register read. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_household_get — paginated list + by-id"`

### Task 4.2: `admin_household_write`

**Files:** Create `src/tools/admin/manage/admin-household-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 0 — verify the nested-prefs field set** before coding (the read shape is `ReadHouseholdPreferences`, the PUT takes `UpdateHouseholdPreferences` — different field sets):
```bash
grep -n "UpdateHouseholdPreferences:" -A 40 src/types/mealie.ts | head -60
```
Copy the exact key list into `HOUSEHOLD_PREFS_FIELDS`.

**Step 1 — failing test:**
- `action: "create", name: "Beach House"` → `post("/api/admin/households", { name: "Beach House" })` (NO `groupId` key when unset); with `group_id: "g1"` → body carries `groupId: "g1"`.
- `action: "update", item_id: "h1", changes: { name: "Renamed" }` → `get("/api/admin/households/h1")` (fake returns HouseholdInDB with `id: "h1"`, `groupId: "g1"`, `name`, `slug: "beach"`, `group: "Home"`, `users: [...]`, `webhooks: [...]`, `preferences: { id: "p1", privateHousehold: true, …extra read-only keys }`) then `put("/api/admin/households/h1", body)` where body:
  - has `id: "h1"` (**duplicated into the body** — UpdateHouseholdAdmin requires it), `groupId: "g1"`, `name: "Renamed"`;
  - has **NO `slug`/`group`/`users`/`webhooks` keys** (whitelist regression);
  - has **NO `preferences` key** (untouched → omitted, the optional-field-safest path).
- `action: "update", changes: { preferences: { privateHousehold: false } }` → body.preferences = merged current+changes prefs **projected onto `HOUSEHOLD_PREFS_FIELDS`** (assert an extra read-only key from the fake's prefs is absent; `privateHousehold: false` present).
- update missing `item_id`/`changes` → `isError`. `action: "delete"` sans confirm → `isError`, zero calls; confirmed → `delete("/api/admin/households/h1")` → `{ deleted: "h1" }`.
- `isError` on throw (plain `errorResult` — no secrets in this tool).

**Step 2 — FAIL. Step 3 — implement:**
```ts
const HOUSEHOLDS_PATH = "/api/admin/households";
/** UpdateHouseholdAdmin's exact field set — the PUT accepts nothing else. */
const HOUSEHOLD_UPDATE_FIELDS = ["id", "groupId", "name", "preferences"] as const;
const HOUSEHOLD_PREFS_FIELDS = [/* from Step 0 — verbatim UpdateHouseholdPreferences keys */] as const;
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;
type HouseholdCreate = components["schemas"]["HouseholdCreate"];
```
Update flow: GET current → `merged = { ...current, ...changes }` → `body = pickFields(merged, HOUSEHOLD_UPDATE_FIELDS)` → `body.preferences` only when `changes.preferences` set: `pickFields({ ...currentPrefs, ...changesPrefs }, HOUSEHOLD_PREFS_FIELDS)`; else drop the key entirely (it's optional — omission leaves prefs untouched server-side). Keep the merge helpers as small named functions (≤25 lines each, ≤2 nesting). `name: "admin_household_write"`, destructive annotations. Description notes `group_id`/`groupId` moves a household between groups.

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_household_write — create/update/delete[confirm] (UpdateHouseholdAdmin whitelist)"`

---

## Phase 5 — `admin_group_get` + `admin_group_write`

### Task 5.1: `admin_group_get`

Clone Task 4.1 for groups (`GROUPS_PATH = "/api/admin/groups"`; slim `{id, name, slug}`; `projectAdminGroup` + `GROUP_CONCISE_FIELDS = ["id", "name", "slug", "preferences"]`).
`git commit -am "feat(admin): admin_group_get — paginated list + by-id"`

### Task 5.2: `admin_group_write`

**Files:** Create `src/tools/admin/manage/admin-group-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 0 — verify** `GroupAdminUpdate` + `UpdateGroupPreferences` field sets (same grep pattern; PR #8 fact: `UpdateGroupPreferences` is ONLY `privateGroup` + `showAnnouncements`).

**Step 1 — failing test:** create → `post("/api/admin/groups", { name: "X" })` (GroupBase — name ONLY, no other keys). update mirrors Task 4.2: body = `{ id (dup), name }` + `preferences` only when changed (projected onto `UpdateGroupPreferences` keys — assert read-side `groupId`/`id` inside prefs are stripped, the PR #8 lesson) + **`aiProviderSettings` passed through VERBATIM only when the caller supplies it** (write-only — assert absent otherwise; never fetched-merged). Read-side `slug`/`categories`/`webhooks`/`households`/`users` never sent. delete confirm-gated → `{ deleted }`. `isError` on throw.

**Step 2 — FAIL. Step 3 — implement** (clone 4.2's shape; `GROUP_UPDATE_FIELDS = ["id", "name", "preferences", "aiProviderSettings"]`). Description warns: "aiProviderSettings cannot be read back through this surface — supply all three pointer fields (defaultProviderId/audioProviderId/imageProviderId) when setting it (see group_ai_provider_get in the groups toolset)."

**Step 4 — PASS. Step 5 — register. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_group_write — create/update/delete[confirm] (GroupAdminUpdate whitelist)"`

---

## Phase 6 — `admin_ai_provider_get` + `admin_ai_provider_write`

### Task 6.1: `admin_ai_provider_get`

**Files:** Create `src/tools/admin/manage/admin-ai-provider-get.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:** `group_id: "g1", provider_id: "p1"` → `get("/api/admin/groups/g1/ai-providers/providers/p1")`; result drops `apiKey` even if the fake (adversarially) injects one. `isError` on throw.

**Step 2 — FAIL. Step 3 — implement.** Both params required (`z.string()`). Reuse/clone PR #8's `projectProvider` defensive-drop (small local `projectAdminProvider` in `admin-projection.ts` — sibling cross-imports from `groups/` are forbidden). Description: "Read one AI provider in any group (admin). There is NO admin list endpoint — enumerate via the groups toolset's group_ai_provider_get, or know the provider id."
`git commit -am "feat(admin): admin_ai_provider_get — by group+provider id (apiKey never echoed)"`

### Task 6.2: `admin_ai_provider_write`

**Files:** Create `src/tools/admin/manage/admin-ai-provider-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test** (mirror `group-ai-provider-write.test.ts` cases, with `group_id` + admin paths):
- create: required `group_id`+`name`+`api_key` → `post("/api/admin/groups/g1/ai-providers/providers", body)` with `timeout: 300`, `requestHeaders: {}`, `requestParams: {}` defaults; **result/projection never contains the api_key value**.
- update: `provider_id` required; fetch current `AIProviderOut` → merged body where **`apiKey` comes ONLY from args** (assert: api_key arg absent → body.apiKey is `""`-or-error per the PR #8 archetype's exact behavior — mirror it); changed fields overlay.
- delete: confirm-gated → `{ deleted: provider_id }`.
- error path: `MealieApiError` detail embedding the api_key → sanitized (`secretSafeErrorResult`).

**Step 2 — FAIL. Step 3 — implement** mirroring `src/tools/groups/group-ai-provider-write.ts` **exactly** (arg names, apiKey re-supply semantics, description warning) with: `group_id` arg, admin base path builder `providersPath(group_id)`, catch = `secretSafeErrorResult`. Note create returns **200 not 201** (no code impact — `client.post` parses any 2xx).

**Step 4 — PASS. Step 5 — register. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_ai_provider_write — create/update/delete[confirm] (apiKey re-supply, secretSafe)"`

---

## Phase 7 — `admin_backup_get` + `admin_backup_write`

### Task 7.1: `admin_backup_get`

**Files:** Create `src/tools/admin/site/admin-backup-get.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- no `file_name` → `get("/api/admin/backups")`; fake returns `{ imports: [{ name: "b.zip", date: "…", size: "1.2 MB" }], templates: ["t1"] }` → result `{ imports, templates }` passthrough (wrapper — NOT items/count, NOT pagination meta).
- `file_name: "b.zip"` → `get("/api/admin/backups/b.zip")`; fake returns `{ fileToken: "tok-secret" }` → result is `{ fileName: "b.zip", downloadUrl: "<baseUrl>/api/utils/download?token=tok-secret" }` (mirror `app-download-file.ts`'s URL builder — encodeURIComponent the token).
- error path on the file_name branch: thrown error whose message embeds `"tok-secret"` → sanitized (`secretSafeErrorResult`; assert no `"tok-secret"` in the result text).

**Step 2 — FAIL. Step 3 — implement.**
```ts
const BACKUPS_PATH = "/api/admin/backups";
const DOWNLOAD_PATH = "/api/utils/download";
type BackupsList = components["schemas"]["AllBackups"];
type FileToken = components["schemas"]["FileTokenResponse"];
type GetClient = Pick<MealieClient, "get" | "baseUrl">;
```
Description: "List backup archives (imports + templates; sizes are display strings) or get a one-time download URL for one backup by file name."
`git commit -am "feat(admin): admin_backup_get — AllBackups wrapper + download-URL (secretSafe)"`

### Task 7.2: `admin_backup_write`

**Files:** Create `src/tools/admin/site/admin-backup-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `action: "create"` → `post("/api/admin/backups", {})`; fake returns `{ message: "ok", error: false }` → `{ action: "create", message: "ok" }`.
- **error-flag-on-200**: fake returns `{ message: "disk full", error: true }` → `isError` with `"disk full"` in the text (group_seed precedent).
- `action: "upload", filePath: "/tmp/b.zip"` + pre-read Blob → `postMultipart("/api/admin/backups/upload", form)` where `form.get("archive")` is the Blob (**verbatim field name** — assert `form.get("file")` is null).
- upload without a readable file → `isError`, no client call.
- `action: "delete", file_name: "b.zip"` sans confirm → `isError`, zero calls; confirmed → `delete("/api/admin/backups/b.zip")` → `{ deleted: "b.zip" }`; delete without `file_name` → `isError`.
- `isError` on throw (plain `errorResult` — no secrets in these branches).

**Step 2 — FAIL. Step 3 — implement.** Handler signature `(client, args, file?: Blob)` + registration-layer `loadBackupArchive` reading whenever `action === "upload" && filePath` (the **avatar** `loadAvatar` precedent — upload is NOT confirm-gated); form assembly mirrors `group-start-migration.ts` (`form.append("archive", file, basename)`). Shared local `successOrError(response, action)` helper for the SuccessResponse error-flag check (reused by restore + cleans? NO — siblings can't cross-import; put `checkSuccessResponse` in `admin-projection.ts` since site/ + manage/ share that ancestor). `annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }` (delete inside).

**Step 4 — PASS. Step 5 — register. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_backup_write — create/upload(multipart 'archive')/delete[confirm]"`

---

## Phase 8 — `admin_backup_restore` (THE double gate)

### Task 8.1: `admin_backup_restore`

**Files:** Create `src/tools/admin/site/admin-backup-restore.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test (order matters — gates BEFORE any client call):**
- `file_name: "b.zip"` (no confirm) → `isError` mentioning confirmation; **zero client calls**.
- `confirm: true` but `confirm_file_name` missing → `isError` naming `confirm_file_name`; zero calls.
- `confirm: true, confirm_file_name: "other.zip"` → `isError` stating the mismatch (includes both names); zero calls.
- `confirm: true, confirm_file_name: "b.zip"` → `post("/api/admin/backups/b.zip/restore", {})`; fake `{ message: "restored", error: false }` → `{ restored: "b.zip", message: "restored" }`.
- error-flag-on-200 → `isError` with the message; `isError` on throw.

**Step 2 — FAIL. Step 3 — implement:**
```ts
const BACKUPS_PATH = "/api/admin/backups";
type RestoreClient = Pick<MealieClient, "post">;
// inputSchema: file_name (req), confirm?, confirm_file_name?
//   .describe("Re-type file_name exactly — second factor for the most destructive op in the API")
```
Gate sequence at the top of the handler, before the try: (1) `requireConfirmation(args.confirm, \`restore backup ${args.file_name} (OVERWRITES the entire instance)\`)`; (2) `confirm_file_name !== file_name` → named-mismatch isError. POST with `{}` body (none upstream). `checkSuccessResponse`. `name: "admin_backup_restore"`, `title: "Admin: RESTORE Backup (Destructive)"`, `annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }`. Description: "RESTORE a backup — OVERWRITES the entire Mealie instance (all recipes, users, settings) with the archive's contents and may restart the server / invalidate sessions. Requires confirm:true AND confirm_file_name re-typed to exactly match file_name."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(admin): admin_backup_restore — double-gated (confirm + re-typed filename)"`

---

## Phase 9 — `admin_maintenance_get` + `admin_maintenance_clean`

### Task 9.1: `admin_maintenance_get`

**Files:** Create `src/tools/admin/site/admin-maintenance-get.ts` (+ `.test.ts`); Modify `index.ts`.

Failing test: default/`view: "summary"` → `get("/api/admin/maintenance")` passthrough (`dataDirSize` is a STRING — assert verbatim); `view: "storage"` → `get("/api/admin/maintenance/storage")` (5 string sizes). Implement (tiny view dispatcher; plain passthrough `jsonResult`, shapes are small — no projection). Description notes sizes are display strings and `cleanableImages`/`cleanableDirs` preview what admin_maintenance_clean would remove.
`git commit -am "feat(admin): admin_maintenance_get — summary/storage"`

### Task 9.2: `admin_maintenance_clean`

**Files:** Create `src/tools/admin/site/admin-maintenance-clean.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `target: "images"` sans confirm → `isError`, zero calls; confirmed → `post("/api/admin/maintenance/clean/images", {})` → `{ cleaned: "images", message }`.
- `target: "recipe_folders"`, confirmed → path `/api/admin/maintenance/clean/recipe-folders` (**enum token has an underscore, the path a hyphen** — assert exactly).
- `target: "temp"` confirmed → `/clean/temp`. Error-flag-on-200 → `isError`. `isError` on throw.

**Step 2 — FAIL. Step 3 — implement:**
```ts
/** target token → upstream path suffix (recipe_folders → recipe-folders). */
const CLEAN_PATHS = {
  images: "/api/admin/maintenance/clean/images",
  temp: "/api/admin/maintenance/clean/temp",
  recipe_folders: "/api/admin/maintenance/clean/recipe-folders",
} as const;
```
`requireConfirmation(confirm, \`clean ${target} (irreversibly deletes files)\`)` before the try. Per-target description: images purges non-.webp originals; temp empties the temp dir; recipe_folders deletes folders with non-UUID names. Destructive annotations.
`git commit -am "feat(admin): admin_maintenance_clean — images/temp/recipe_folders[confirm]"`

---

## Phase 10 — `admin_email_test`

### Task 10.1: `admin_email_test`

**Files:** Create `src/tools/admin/site/admin-email-test.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:** `email: "s@x.io"` → `post("/api/admin/email", { email: "s@x.io" })`; fake `{ success: true }` → `{ sent: true, email }`. **Positive-success**: fake `{ success: false, error: "SMTP refused" }` → `isError` containing `"SMTP refused"` (NOT a thrown error — a 200 body). Missing email → zod-required. `isError` on throw.

**Step 2 — FAIL. Step 3 — implement.** Typed `EmailTest` body; check `response.success === false` → manual isError result with `response.error ?? "email test failed"`. Plain write annotations (side-effecting, non-destructive — sends a real email; say so in the description). `name: "admin_email_test"`.
`git commit -am "feat(admin): admin_email_test — positive-success semantics (sends real email)"`

---

## Phase 11 — `admin_debug_openai`

### Task 11.1: `admin_debug_openai`

**Files:** Create `src/tools/admin/site/admin-debug-openai.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `provider_id: "p1"` (no image) → `postMultipart("/api/admin/debug/openai/p1", form)` with an **empty FormData** (assert `form.get("image")` is null) — the upstream body is optional multipart; an empty form is the deterministic encoding.
- `provider_id: "p1", image_path: "/tmp/i.png"` + pre-read Blob → `form.get("image")` is the Blob (verbatim field name).
- fake returns `{ success: true, response: "pong" }` → passthrough `{ success, response }`. `isError` on throw.

**Step 2 — FAIL. Step 3 — implement.** Registration-layer `loadDebugImage` (reads whenever `image_path` set — avatar precedent); handler `(client, args, file?: Blob)`; always `postMultipart` (append `image` only when file present). Write annotations (fires a real, possibly billable, AI-provider call — say so). `name: "admin_debug_openai"`.
`git commit -am "feat(admin): admin_debug_openai — provider connectivity probe (optional multipart image)"`

---

## Phase 12 — Finalize e2e counts, real-stdio check, README

### Task 12.1: Grow the `server.test.ts` opt-in axis to final counts

**Files:** Modify `src/server.test.ts`.

**Step 1 — add the arrays + cases** (mirror the users block):
```ts
const ADMIN_READS = [
  "admin_about", "admin_user_get", "admin_household_get", "admin_group_get",
  "admin_ai_provider_get", "admin_maintenance_get", "admin_backup_get",
]; // 7
const ADMIN_WRITES = [
  "admin_user_write", "admin_user_actions", "admin_household_write", "admin_group_write",
  "admin_ai_provider_write", "admin_backup_write", "admin_backup_restore",
  "admin_maintenance_clean", "admin_email_test", "admin_debug_openai",
]; // 10
```
Add both to `ALL_OPTIN` (default-absence guard). New `describe` block:
- `admin` only, full → all 17 present, other opt-ins absent, `toHaveLength(83)` (66 + 7 + 10).
- `admin` only + read-only → the 7 reads present, the 10 writes absent, `toHaveLength(33)` (26 + 7).
- **Grow the composition case** from all-four (99) to **all FIVE** (`households,automation,groups,users,admin`) → `toHaveLength(116)` (45 reads + 71 writes); all `ALL_OPTIN` tools present.
- Default (no toolsets) → still **26/66**, all 17 admin tools absent.
- Existing users-on 74/28 cases must stay green untouched.

**Step 2 — run `npx vitest run src/server.test.ts`, expect PASS** (a count mismatch = a missing/extra registration in `index.ts` — fix before proceeding). **Step 3 — full gate. Step 4 — commit:**
`git commit -am "test(server): finalize admin opt-in e2e — 83 full / 33 read-only (66/26 default unchanged, 116 all-five)"`

### Task 12.2: Real-stdio subprocess smoke check (throwaway)

Run the built server over stdio for three configs and diff `tools/list` (prior PR's throwaway script pattern; no commit): default → 66, no `admin_*`; `MEALIE_TOOLSETS=admin` → 83; + `MEALIE_READ_ONLY=true` → 33. Confirm `app_get_info` still answers against demo.mealie.io. **Do NOT live-call any admin op** — all are 401/403 on demo without an admin token, and restore/delete/cleans/email must NEVER be live-tested against any real instance. Record real-instance testing as owed (PR body).

### Task 12.3: README — document `MEALIE_TOOLSETS=admin`

**Files:** Modify `README.md`. Add `admin` to the toolsets table (mirror the `users` row): 17 opt-in tools, site-operator surface (manage users/households/groups, AI providers, backups incl. double-gated restore, maintenance cleans, email test, debug). Call out: highest-blast-radius toolset — enable deliberately; combine with `MEALIE_READ_ONLY=true` for a stats/inspection-only mode; backup restore requires confirm + re-typed filename. Gate; commit:
`git commit -am "docs(readme): document MEALIE_TOOLSETS=admin (17 opt-in tools, gated)"`

---

## Phase 13 — Review + PR

1. **Adversarial multi-lens code-review workflow** (find → adversarially verify) over the branch diff. Lenses: (a) **secrets** — password/reset-token/apiKey/fileToken/dbUrl/cacheKey never escape any result or log incl. error paths; reset-token echoed exactly once by design; `secretSafeErrorResult` on the five designated tools; (b) **merge correctness** — UserOut round-trip (no stripping) vs household/group whitelist (no read-side leakage, id-in-body, nested-prefs projection, aiProviderSettings passthrough-only) vs apiKey re-supply; (c) **gating** — confirm before ANY client call everywhere; the restore double gate; read-only strips exactly the 10 writes; (d) **contract fidelity** — paths verbatim (incl. `recipe-folders` hyphen), multipart field names (`archive`/`image`), wrapper-vs-envelope shapes, both error-on-200 conventions; (e) **house rules** — ≤25-line functions, ≤2 nesting, ≤3 params, no magic numbers, JSDoc on exports, no `any`, file-org (subdirs under cap, tests colocated, no sibling cross-imports). Fix confirmed findings (own commits), re-run the gate.
2. **Push** `feature/admin`; open a **draft** PR into `develop` (`gh pr create --draft --base develop`). PR body: scope (17 tools / 38 ops, opt-in `admin`), verified-inventory provenance, count math (default 26/66 unchanged → 83/33/116), the triple-gating story (opt-in × read-only × confirm/double-confirm), and the **owed real-instance testing** caveat (with the NEVER-live-test list).
3. Hand off for the owner's `superpowers:requesting-code-review` + human review before merge.

---

## Done when

- All 17 tools implemented, unit-tested, registered behind the `admin` toolset; `npm run build && npm run typecheck && npm run test && npm run lint` exits 0.
- `server.test.ts`: default 26/66 unchanged; admin-on 83; read-only-within 33; all-five 116; users-on 74/28 untouched.
- Draft PR open into `develop`; real-instance testing noted as owed.
