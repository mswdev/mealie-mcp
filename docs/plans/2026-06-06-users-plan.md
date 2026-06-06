# PR #9 — Opt-in: Users (self-service) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Per the project owner's instruction the build runs **sequentially in the main loop** (shared `config.ts`/`server.ts`/`server.test.ts`/`index.ts` + a per-step quality gate make parallel subagents unsafe).

**Goal:** Add the opt-in `users` toolset — 8 MCP tools covering all 17 mapped self-service user operations (22 incl. the 5 omitted auth ops) — by reusing the existing `MEALIE_TOOLSETS` switch.

**Architecture:** New flat `src/tools/users/` dir, one tool per file + `index.ts` read/write split, registered behind a new `users` token in `KNOWN_TOOLSETS` via one conditional in `createServer`. All consolidation lives in the tool layer atop the existing generic `MealieClient` verbs; no client changes (reuses `postMultipart` for the avatar upload). Default surface stays 26/66.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk`, `zod`, Vitest (hand-written fakes), Biome, tsup. Types in `src/types/mealie.ts` (generated, authoritative).

**Design:** [`2026-06-06-users-design.md`](./2026-06-06-users-design.md) — read §3 (per-tool contracts) and §4.2 (the 7 instantiated gotchas) before each task.

**Archetype files to mirror (read once up front):**
- `src/tools/groups/group-self-get.ts` — `view` dispatcher read (user_me mirrors this).
- `src/tools/groups/group-self-update.ts` — fetch-merge PUT with key filtering (user_self_update inverts it: whitelist-project, don't strip).
- `src/tools/groups/label-write.ts` — `action` write-dispatcher (create/update/delete, `missing()` helper, confirm gate).
- `src/tools/groups/group-start-migration.ts` + `src/tools/upload.ts` — multipart (`readUploadFile` + `postMultipart`, registration-layer file read via a `loadArchive`-style helper).
- `src/tools/groups/group-projection.ts` — projection helper shape (typed `components["schemas"]` + `*_CONCISE_FIELDS` const + `project*()`).
- `src/tools/result.ts` (`jsonResult`/`errorResult`), `src/tools/confirm.ts` (`requireConfirmation`).

**Inventory facts (adversarially verified against `src/types/mealie.ts` — trust these over memory):**
- `PUT /api/users/{item_id}` reuses `mealie__schema__user__user__UserBase` (no Update schema). UserBase fields: `id?`, `username?`, `fullName?`, `email` (required), `authMethod` (enum `Mealie|LDAP|OIDC`), `admin`, `group?`, `household?` (nullable **name strings**), `advanced`, `showAnnouncements`, `lastReadAnnouncement?`, `canInvite`, `canManage`, `canManageHousehold`, `canOrganize`. It does NOT have `groupId`/`groupSlug`/`householdId`/`householdSlug`/`tokens`/`cacheKey` (those are UserOut-only).
- Ratings/favorites reads return a **wrapper** `{ ratings: [...] }`: self → `UserRatings_UserRatingSummary_`, by-id → `UserRatings_UserRatingOut_`. Single-rating read → bare `UserRatingSummary`. NOT pagination envelopes, NOT bare arrays.
- Rating/favorite **writes exist only on the by-id paths** (`/api/users/{id}/ratings/{slug}` POST body `UserRatingUpdate {rating?}`; `/api/users/{id}/favorites/{slug}` POST/DELETE, no body) — handlers resolve the caller's id via `GET /api/users/self` first.
- Token create → 201 `LongLiveTokenCreateResponse {name, id: number, createdAt?, token}` — `token` is the **raw secret, shown only here**; `LongLiveTokenOut` (in `UserOut.tokens`) has no token field; **no token list endpoint**. Delete key `token_id` is an **integer**; returns `DeleteTokenResponse {tokenDelete}`.
- Avatar: `POST /api/users/{id}/image`, multipart, FormData field named exactly **`profile`**. 200 → `unknown`.
- Register: `CreateUserRegistration` — required `email`/`username`/`fullName`/`password`/`passwordConfirm`; required-with-default `advanced`/`private`/`seedData` (false) + `locale` ("en-US"); optional `group`/`household`/`groupToken`. 201 → `UserOut`.
- Passwords: `ChangePassword {currentPassword, newPassword}`, `ForgotPassword {email}`, `ResetPassword {token, email, password, passwordConfirm}` — all 200s are `unknown`.
- All password/rating/avatar/profile-PUT responses are `unknown` → synthesize echoes, never parse.

**Quality gate — run at the end of EVERY task before committing:**
```bash
npm run build && npm run typecheck && npm run test && npm run lint
```
Exit 0 required (empty lint output ≠ pass). Auto-fix import-order/format with `npx biome check --write src/`. `noUncheckedIndexedAccess`: optional MCP-arg fields need explicit `| undefined`; test fakes of generic client methods must be generic (`async <T>(): Promise<T>`); use conditional spreads for optional body fields.

---

## Phase 0 — Toolset wiring + `user_me` (folded, per the PR #8 precedent)

### Task 0.1: Register the `users` token

**Files:**
- Modify: `src/config.ts:28` (`KNOWN_TOOLSETS`)
- Modify: `src/config.test.ts`

**Step 1 — failing test (`config.test.ts`):**
```ts
it("enables the users toolset", () => {
  expect(parseToolsets("users")).toEqual(new Set(["users"]));
});

it("enables all four toolsets together", () => {
  expect(parseToolsets("households,automation,groups,users")).toEqual(
    new Set(["households", "automation", "groups", "users"]),
  );
});
```

**Step 2 — run, expect FAIL** (`users` unknown → warned + ignored): `npx vitest run src/config.test.ts`

**Step 3 — implement:**
```ts
export const KNOWN_TOOLSETS = ["households", "automation", "groups", "users"] as const;
```

**Step 4 — run config tests, expect PASS.** No commit yet — the token lands with the first tool (Task 0.2), mirroring PR #8's first commit (an empty registrar can't ship: Biome flags unused `server`/`client` params).

### Task 0.2: `user_me` (read — view dispatcher) + index + server conditional

**Files:**
- Create: `src/tools/users/user-projection.ts`
- Create: `src/tools/users/user-me.ts` (+ `.test.ts`)
- Create: `src/tools/users/index.ts`
- Modify: `src/server.ts`

**Step 1 — projection helper** `user-projection.ts` (mirror `group-projection.ts`):
```ts
import type { components } from "../../types/mealie.js";

/** The logged-in user, as returned by GET /api/users/self. */
export type User = components["schemas"]["UserOut"];

/** Fields kept in a user's concise projection. `tokens` MUST stay: UserOut.tokens
 * (LongLiveTokenOut[] — id/name/createdAt, never the raw value) is the API's only
 * token enumeration, and user_api_token_write(delete) needs the integer id. */
const USER_CONCISE_FIELDS = [
  "id", "username", "fullName", "email", "admin",
  "group", "household", "groupId", "householdId", "tokens",
] as const;

export function projectUser(user: User, format: "concise" | "detailed"): Record<string, unknown> { /* same shape as projectGroup */ }
```

**Step 2 — failing test (`user-me.test.ts`):** mirror `group-self-get.test.ts`. Cover:
- default (no view) → `get("/api/users/self")`; concise result has `id`/`username`/`email` **and `tokens`** (fake returns a UserOut with `tokens: [{ id: 1, name: "t", createdAt: "…" }]`, plus `cacheKey`/`groupSlug` that concise must drop); `response_format: "detailed"` returns everything.
- `view: "ratings"` → `get("/api/users/self/ratings")`; fake returns `{ ratings: [{ recipeId: "r1", rating: 4.5, isFavorite: false }] }` (the wrapper); handler returns `{ items, count: 1 }`.
- `view: "ratings", recipe_id: "r1"` → `get("/api/users/self/ratings/r1")` → bare `UserRatingSummary` passed through.
- `view: "favorites"` → `get("/api/users/self/favorites")` → `{ items, count }`.
- `isError` on client throw.

**Step 3 — run, expect FAIL** (`userMeHandler` undefined): `npx vitest run src/tools/users/user-me.test.ts`

**Step 4 — implement** `user-me.ts` mirroring `group-self-get.ts`:
```ts
const SELF_PATH = "/api/users/self";
const RATINGS_PATH = "/api/users/self/ratings";
const FAVORITES_PATH = "/api/users/self/favorites";
type GetClient = Pick<MealieClient, "get">;
type RatingsWrapper = components["schemas"]["UserRatings_UserRatingSummary_"];
// inputSchema: view enum [profile|ratings|favorites] (default profile),
//   recipe_id? (z.string(), "one recipe's rating; view=ratings"),
//   response_format? (view=profile)
```
- `profile` (default) → `projectUser(await client.get<User>(SELF_PATH), format)`.
- `ratings` + `recipe_id` → `jsonResult(await client.get(`${RATINGS_PATH}/${recipe_id}`))`.
- `ratings`/`favorites` → `const wrapper = await client.get<RatingsWrapper>(path); jsonResult({ items: wrapper.ratings, count: wrapper.ratings.length })` (the wrapper is NOT a pagination envelope — return items + count, no pagination meta).
- `name: "user_me"`, `title: "Get My User (Self)"`, `annotations: { readOnlyHint: true, openWorldHint: true }`. Description: "Read the current authenticated user by view: profile (default; includes the API-token list — ids/names only, never token values), ratings, or favorites (pass recipe_id with view=ratings for one recipe)."

**Step 5 — create `src/tools/users/index.ts`** (mirror `groups/index.ts`; registrar JSDoc names the toolset):
```ts
export type RegisterOptions = { readOnly: boolean };
export function registerUserTools(server, client, options): void {
  // Reads (always on).
  registerUserMe(server, client);
  if (options.readOnly) return;
  // Writes (stripped under read-only) — added per task.
}
```

**Step 6 — wire `src/server.ts`:** import `registerUserTools` (alphabetical) + conditional after the `groups` block:
```ts
  if (options.toolsets.has("users")) {
    registerUserTools(server, client, options);
  }
```

**Step 7 — run full gate, expect PASS** (no existing test enables `users` → default still 26/66).

**Step 8 — commit:**
```bash
git add src/config.ts src/config.test.ts src/server.ts src/tools/users/
git commit -m "feat(users): register opt-in users toolset + user_me (view dispatcher)"
```

---

## Phase 1 — `user_ratings_get` (read — by-id wrapper reads)

### Task 1.1: `user_ratings_get`

**Files:** Create `src/tools/users/user-ratings-get.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `user_id: "u1"` (default view) → `get("/api/users/u1/ratings")`; fake returns the `UserRatings_UserRatingOut_` wrapper (items carry `userId`/`id` extras) → `{ items, count }`.
- `user_id: "u1", view: "favorites"` → `get("/api/users/u1/favorites")`.
- missing `user_id` → handled by zod (required) — no handler test needed; assert handler passes the raw string through (no uuid validation).
- `isError` on throw.

**Step 2 — run, expect FAIL.**

**Step 3 — implement:**
```ts
type RatingsOutWrapper = components["schemas"]["UserRatings_UserRatingOut_"];
// inputSchema: user_id: z.string() (required), view: z.enum(["ratings","favorites"]).optional()
```
`get<RatingsOutWrapper>(`/api/users/${user_id}/${view ?? "ratings"}`)` → `{ items, count }`. `name: "user_ratings_get"`, `title: "Get a User's Ratings"`, read annotations. **Description:** "Read another user's recipe ratings or favorites by user id. User ids come from the groups toolset's group_self_get(view: members)." (cross-toolset glue — say it verbatim).

**Step 4 — PASS. Step 5 — register read in `index.ts`. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_ratings_get — by-id ratings/favorites (wrapper reads)"`

---

## Phase 2 — `user_self_update` (write — fetch-merge whitelist archetype)

### Task 2.1: `user_self_update`

**Files:** Create `src/tools/users/user-self-update.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- fake `get("/api/users/self")` returns a full UserOut: `{ id: "u1", username: "matt", fullName: "Matt", email: "m@x.io", authMethod: "Mealie", admin: false, group: "Home", household: "Family", advanced: false, showAnnouncements: true, canInvite: false, canManage: false, canManageHousehold: false, canOrganize: false, groupId: "g1", groupSlug: "home", householdId: "h1", householdSlug: "family", tokens: [], cacheKey: "abc" }`.
- call with `changes: { fullName: "New Name" }`; assert:
  - PUT path is `/api/users/u1` (id from the fetched self);
  - PUT body has `fullName: "New Name"` AND preserves `email`/`admin`/`showAnnouncements`/`canInvite`… (silent-reset guard);
  - PUT body does **NOT** contain `groupId`, `groupSlug`, `householdId`, `householdSlug`, `tokens`, `cacheKey` (whitelist regression — UserOut-only keys never sent);
  - `changes` keys outside the whitelist are dropped (call with `changes: { fullName: "x", cacheKey: "evil" }` → no `cacheKey` in body).
- missing `changes` → `isError` (no client call). `isError` on throw.

**Step 2 — run, expect FAIL.**

**Step 3 — implement:**
```ts
const SELF_PATH = "/api/users/self";
/** The PUT body schema (mealie__schema__user__user__UserBase) field set — the PUT
 * reuses the base schema (no UserUpdate exists), so the body is whitelist-projected
 * from the fetched UserOut (which carries extra *Id/*Slug/tokens/cacheKey keys). */
const USER_BASE_FIELDS = [
  "id", "username", "fullName", "email", "authMethod", "admin",
  "group", "household", "advanced", "showAnnouncements", "lastReadAnnouncement",
  "canInvite", "canManage", "canManageHousehold", "canOrganize",
] as const;
type UpdateClient = Pick<MealieClient, "get" | "put">;
// inputSchema: { changes: z.record(z.unknown()) }
```
Handler: require `changes`; `const current = await client.get<Record<string, unknown>>(SELF_PATH);` build `merged` by picking `USER_BASE_FIELDS` from `{ ...current, ...changes }` via `Object.fromEntries(...filter)` (NOT `delete`, NOT destructure-discards — Biome). `await client.put(`/api/users/${current.id}`, merged);` (response `unknown` — ignore); `jsonResult({ updated: current.id, user: merged })`. `name: "user_self_update"`, `annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true }`. Description notes: permission flags (`admin`, `can*`) pass through but require admin rights on the instance; `group`/`household` are **name strings**, not ids.

**Step 4 — PASS. Step 5 — register write (after `if (options.readOnly) return;`). Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_self_update — fetch-merge PUT (UserBase whitelist projection)"`

---

## Phase 3 — `user_ratings_write` (write — self-id resolution + confirm gate)

### Task 3.1: `user_ratings_write`

**Files:** Create `src/tools/users/user-ratings-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `action: "rate", recipe_slug: "pasta", rating: 4.5` → `get("/api/users/self")` (returns `{ id: "u1", … }`) then `post("/api/users/u1/ratings/pasta", { rating: 4.5 })`; echoes `{ action: "rate", recipeSlug: "pasta", rating: 4.5 }`.
- `action: "rate"` without `rating` → `isError` (no client call).
- `action: "favorite", recipe_slug: "pasta"` → GET self then `post("/api/users/u1/favorites/pasta", …)` (no meaningful body).
- `action: "unfavorite"` without `confirm` → `isError` AND **zero client calls (not even the self GET)**.
- `action: "unfavorite", confirm: true` → GET self then `delete("/api/users/u1/favorites/pasta")` → `{ action: "unfavorite", recipeSlug: "pasta" }`.
- `isError` on throw.

**Step 2 — run, expect FAIL.**

**Step 3 — implement** mirroring `label-write.ts`:
```ts
const SELF_PATH = "/api/users/self";
type WriteClient = Pick<MealieClient, "get" | "post" | "delete">;
type RatingUpdate = components["schemas"]["UserRatingUpdate"];
// inputSchema: action enum [rate|favorite|unfavorite], recipe_slug: z.string(),
//   rating? (z.number(), "0–5, halves allowed"), confirm?
```
- `requireConfirmation` for `unfavorite` **before the try and before the self GET**.
- All branches resolve `const self = await client.get<User>(SELF_PATH);` then hit `/api/users/${self.id}/…` (no self-scoped write endpoints exist upstream — say so in a comment).
- `rate`: require `rating`; body `RatingUpdate = { rating: args.rating }`; POST `…/ratings/${recipe_slug}`.
- `favorite`: POST `…/favorites/${recipe_slug}` (match `client.post`'s signature for a body-less POST — check how `event-notification-test.ts`/`webhook-action.ts` call it).
- `unfavorite`: DELETE `…/favorites/${recipe_slug}`.
- All responses are `unknown` → synthesize `{ action, recipeSlug, …(rating for rate) }`. `name: "user_ratings_write"`, `annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }`. Description: "Rate, favorite, or unfavorite a recipe as the current user (your id is resolved automatically)."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_ratings_write — rate/favorite/unfavorite[confirm] (self-id resolution)"`

---

## Phase 4 — `user_api_token_write` (write — write-once secret + integer id)

### Task 4.1: `user_api_token_write`

**Files:** Create `src/tools/users/user-api-token-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `action: "create", name: "ha-bridge"` → `post("/api/users/api-tokens", { name: "ha-bridge", integrationId: "generic" })` (default supplied); fake returns `{ name: "ha-bridge", id: 7, createdAt: "…", token: "ey.raw.secret" }`; result **contains `token: "ey.raw.secret"`** and the shown-once warning text; result contains the integer `id`.
- `action: "create"` without `name` → `isError`.
- `action: "delete"` without `confirm` → `isError` (no client call); `action: "delete", token_id: 7, confirm: true` → `delete("/api/users/api-tokens/7")`; fake returns `{ tokenDelete: "ha-bridge" }`; result is `{ deleted: 7 }`.
- `action: "delete"` without `token_id` → `isError`.
- `isError` on throw.

**Step 2 — run, expect FAIL.**

**Step 3 — implement:**
```ts
const TOKENS_PATH = "/api/users/api-tokens";
const DEFAULT_INTEGRATION_ID = "generic";
/** Create responses carry the raw token exactly once (upstream: "the token field is sensitive"). */
const SHOWN_ONCE_NOTE =
  "Save this token now — it is shown only once and can never be retrieved again.";
type WriteClient = Pick<MealieClient, "post" | "delete">;
type TokenCreated = components["schemas"]["LongLiveTokenCreateResponse"];
type TokenIn = components["schemas"]["LongLiveTokenIn"];
// inputSchema: action enum [create|delete], name?, integrationId?,
//   token_id? (z.number().int() — INTEGER, the one non-uuid id), confirm?
```
- `create`: require `name`; `const body: TokenIn = { name, integrationId: args.integrationId ?? DEFAULT_INTEGRATION_ID };` → `jsonResult({ id, name, createdAt, token, note: SHOWN_ONCE_NOTE })` from the response. **The deliberate exception:** the raw token IS echoed (once, by design) — but never logged (the client logs url+method only; add no logging here).
- `delete`: require `token_id`; `requireConfirmation(confirm, `delete API token ${token_id}`)` before the try; DELETE `${TOKENS_PATH}/${token_id}`; → `{ deleted: token_id }`.
- `name: "user_api_token_write"`, `annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }`. Description: "Create or delete (confirm required) your own API tokens. Create returns the token value exactly once; list existing tokens via user_me (ids/names only)."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_api_token_write — create (token shown once) / delete[confirm, integer id]"`

---

## Phase 5 — `user_password_write` (write — secret-heavy dispatcher)

### Task 5.1: `user_password_write`

**Files:** Create `src/tools/users/user-password-write.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- `action: "change", currentPassword: "old-secret", newPassword: "new-secret"` → `put("/api/users/password", { currentPassword: "old-secret", newPassword: "new-secret" })` → result `{ action: "change", success: true }`; **assert `JSON.stringify(result)` contains neither `"old-secret"` nor `"new-secret"`**.
- `action: "change"` missing either field → `isError`.
- `action: "forgot", email: "m@x.io"` → `post("/api/users/forgot-password", { email: "m@x.io" })` → success message mentioning the reset email/SMTP.
- `action: "reset", token: "tok-secret", email, password: "pw-secret", passwordConfirm: "pw-secret"` → `post("/api/users/reset-password", {…all four…})` → `{ action: "reset", success: true }`; **stringified result contains neither `"tok-secret"` nor `"pw-secret"`**.
- missing required reset fields → `isError`. `isError` on throw (and the secrets don't appear in the error result either — pass a thrown error whose message is clean; `MealieApiError` carries the upstream response body, never the request).

**Step 2 — run, expect FAIL.**

**Step 3 — implement:**
```ts
const CHANGE_PATH = "/api/users/password";
const FORGOT_PATH = "/api/users/forgot-password";
const RESET_PATH = "/api/users/reset-password";
type WriteClient = Pick<MealieClient, "put" | "post">;
type ChangeBody = components["schemas"]["ChangePassword"];
type ForgotBody = components["schemas"]["ForgotPassword"];
type ResetBody = components["schemas"]["ResetPassword"];
// inputSchema: action enum [change|forgot|reset], currentPassword?, newPassword?,
//   email?, token? ("the emailed reset token"), password?, passwordConfirm?
```
- Typed bodies per action; all three responses are `unknown` → ignore and synthesize: change/reset → `{ action, success: true }`; forgot → `{ action: "forgot", success: true, message: "If the address exists, a reset email was sent (requires instance SMTP)." }`.
- **No confirm** (explicit design decision — change is self-gated by `currentPassword`, reset by the emailed token). **Never put any password/token arg in any result or log.**
- `name: "user_password_write"`, `annotations: { readOnlyHint: false, openWorldHint: true }` (plain write). Description: "Change your password (currentPassword + newPassword), request a reset email (forgot + email), or complete a reset (reset + token/email/password/passwordConfirm). Password values are never echoed."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_password_write — change/forgot/reset (secrets never echoed)"`

---

## Phase 6 — `user_register` (write — public typed-body create)

### Task 6.1: `user_register`

**Files:** Create `src/tools/users/user-register.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test:**
- minimal call (`email`/`username`/`fullName`/`password`/`passwordConfirm`) → `post("/api/users/register", body)` where body carries the four required-with-defaults: `advanced: false, private: false, seedData: false, locale: "en-US"` — and NO `group`/`household`/`groupToken` keys (conditional spreads).
- with `groupToken: "invite-secret"` → body carries it; **the result does not** (stringified result lacks `"invite-secret"`, the password, and `passwordConfirm`).
- fake `post` returns a UserOut → result echoes the concise projection (`id`/`username`/`email` present).
- missing any required field → `isError`. `isError` on throw (signup-disabled instances surface Mealie's error body via `errorResult`).

**Step 2 — run, expect FAIL.**

**Step 3 — implement:**
```ts
const REGISTER_PATH = "/api/users/register";
const DEFAULT_LOCALE = "en-US";
type RegisterClient = Pick<MealieClient, "post">;
type RegistrationBody = components["schemas"]["CreateUserRegistration"];
// inputSchema: email, username, fullName, password, passwordConfirm (all z.string() required);
//   group?, household? ("group/household NAME to join"), groupToken? ("invite token"),
//   advanced?, private?, seedData? (z.boolean()), locale?
```
Body literal: the five required strings + `advanced: args.advanced ?? false`, `private: args.private ?? false`, `seedData: args.seedData ?? false`, `locale: args.locale ?? DEFAULT_LOCALE`, conditional spreads for `group`/`household`/`groupToken`. `const user = await client.post<User>(REGISTER_PATH, body);` → `jsonResult({ registered: true, user: projectUser(user, "concise") })`. `name: "user_register"`, `annotations: { readOnlyHint: false, openWorldHint: true }` (plain create, no confirm). Description: "Register a NEW user account (public endpoint — not scoped to the current user; instances may have signup disabled). Optional groupToken joins via invite."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_register — public account creation (typed body, secrets never echoed)"`

---

## Phase 7 — `user_avatar_upload` (write — multipart)

### Task 7.1: `user_avatar_upload`

**Files:** Create `src/tools/users/user-avatar-upload.ts` (+ `.test.ts`); Modify `index.ts`.

**Step 1 — failing test** (handler takes a pre-read `file?: Blob`, like `groupStartMigrationHandler`):
- `filePath: "/tmp/me.png"`, `file: new Blob([…])` → `get("/api/users/self")` (returns `{ id: "u1" }`) then `postMultipart("/api/users/u1/image", form)` where `form.get("profile")` is the Blob — **the field name is exactly `profile`** (assert via `form.get("profile")`, and `form.get("file")` is null).
- result `{ uploaded: true, userId: "u1" }`.
- missing `file` → `isError` ("filePath required" / file read failed — no client calls).
- `isError` on throw.

**Step 2 — run, expect FAIL.**

**Step 3 — implement** mirroring `group-start-migration.ts` (registration-layer file read; no confirm — read whenever `filePath` is present):
```ts
const SELF_PATH = "/api/users/self";
/** Verbatim multipart field name from Body_update_user_image_api_users__id__image_post. */
const AVATAR_FIELD = "profile";
const DEFAULT_FILENAME = "avatar";
type UploadClient = Pick<MealieClient, "get" | "postMultipart">;
// inputSchema: { filePath: z.string() }
```
Handler `userAvatarUploadHandler(client, args, file?)`: require `file`; `const self = await client.get<User>(SELF_PATH);` build `FormData`, `form.append(AVATAR_FIELD, file, args.filePath.split("/").pop() ?? DEFAULT_FILENAME);` `await client.postMultipart<unknown>(`/api/users/${self.id}/image`, form);` → `jsonResult({ uploaded: true, userId: self.id })`. Registration layer: a `loadAvatar(args)`-style helper reading via `readUploadFile`, surfacing read errors via `errorResult` (copy `loadArchive`'s shape minus the confirm check). `name: "user_avatar_upload"`, `title: "Upload My Avatar"`, `annotations: { readOnlyHint: false, openWorldHint: true }`. Description: "Replace the current user's avatar image. Reads a file on the MCP server (stdio/local only)."

**Step 4 — PASS. Step 5 — register write. Step 6 — gate. Step 7 — commit:**
`git commit -am "feat(users): user_avatar_upload — multipart avatar (FormData field 'profile')"`

---

## Phase 8 — Finalize e2e counts, real-stdio check, README

### Task 8.1: Grow the `server.test.ts` opt-in axis to final counts

**Files:** Modify: `src/server.test.ts`.

**Step 1 — add the arrays + cases:**
```ts
const USERS_READS = ["user_me", "user_ratings_get"]; // 2
const USERS_WRITES = [
  "user_self_update", "user_ratings_write", "user_api_token_write",
  "user_password_write", "user_register", "user_avatar_upload",
]; // 6
```
Add both to `ALL_OPTIN` (default-absence guard). New `describe` block (mirror the groups one):
- `users` only, full → all 8 present, households/automation/groups absent, `toHaveLength(74)` (66 + 2 reads + 6 writes).
- `users` only + read-only → the 2 reads present, the 6 writes absent, `toHaveLength(28)` (26 + 2).
- **Grow the existing composition case** from all-three (91) to **all four** (`households,automation,groups,users`) → `toHaveLength(99)` (38 reads + 61 writes); all `ALL_OPTIN` tools present.
- Default (no toolsets) → still **26/66**, all 8 user tools absent.

**Step 2 — run, expect PASS** (`npx vitest run src/server.test.ts`). A count mismatch means a missing/extra registration in `index.ts` — fix before proceeding.

**Step 3 — full gate. Step 4 — commit:**
`git commit -am "test(server): finalize users opt-in e2e — 74 full / 28 read-only (66/26 default unchanged, 99 all-four)"`

### Task 8.2: Real-stdio subprocess smoke check (throwaway)

**Step 1 —** run the built server over stdio for three configs and diff `tools/list` (reuse the prior PR's throwaway script pattern; no commit):
- default → 66 names, no `user_*`.
- `MEALIE_TOOLSETS=users` → 74, includes the 2 reads + 6 writes.
- `MEALIE_TOOLSETS=users MEALIE_READ_ONLY=true` → 28.

**Step 2 —** confirm `app_get_info` still works against `demo.mealie.io`. **Do NOT live-test user ops:** self/ratings/tokens/avatar are 401 without a token; register/forgot are public but create real accounts / send email (external side effects). Record that real-instance testing is owed (PR body).

### Task 8.3: README — document `MEALIE_TOOLSETS=users`

**Files:** Modify: `README.md`.

**Step 1 —** add `users` to the toolsets table/list (mirror the `groups` row): 8 opt-in tools, self-service user surface (profile, ratings/favorites, passwords, registration, API tokens, avatar). Note: token create shows the token value once; avatar upload reads a server-local file (stdio/local only).

**Step 2 — gate. Step 3 — commit:**
`git commit -am "docs(readme): document MEALIE_TOOLSETS=users (8 opt-in tools)"`

---

## Phase 9 — Review + PR

1. **Adversarial multi-lens code-review workflow** (find → adversarially verify) over the branch diff: lenses = (a) fetch-merge whitelist correctness / silent-reset (UserOut-only keys never PUT), (b) **secrets** — passwords/reset-token/groupToken never echoed or logged anywhere incl. error paths; the api-token value echoed exactly once by design, (c) confirm-gating (unfavorite, token delete) + read-only stripping completeness (all 6 writes), (d) multipart `profile` field serialization, (e) wrapper-vs-envelope read shapes + self-id resolution order (confirm gate BEFORE the self GET), (f) the hard rules (≤25-line methods, ≤2 nesting, no magic numbers, JSDoc on exports, no `any`). Fix confirmed findings (own commits), re-run the gate.
2. **Push** `feature/users`; open a **draft** PR into `develop` (`gh pr create --draft --base develop`). PR body: scope (8 tools / 22 ops — 17 mapped + 5 auth omitted, opt-in), the verified-inventory provenance, the count deltas (8 vs ~9 target; default 26/66 unchanged → 74/28/99), the no-delete-account verified-absence note, and the **owed real-instance testing** caveat.
3. Hand off for the owner's `superpowers:requesting-code-review` + human review before merge.

---

## Done when

- All 8 tools implemented, unit-tested, registered behind the `users` toolset; `npm run build && npm run typecheck && npm run test && npm run lint` exits 0.
- `server.test.ts`: default 26/66 unchanged; users-on 74; read-only-within 28; all-four 99.
- Draft PR open into `develop`; real-instance testing noted as owed.
