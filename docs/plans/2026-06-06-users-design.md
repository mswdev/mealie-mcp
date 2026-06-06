# PR #9 Design — Opt-in: Users (self-service)

**Date:** 2026-06-06
**Branch:** feature/users → develop (PR #9)
**Status:** Approved (scope confirmed: **one PR, self-service only** — admin user CRUD stays PR #10; read shape **A: aggregated `user_me`**; **no confirm on password ops**; permission flags **pass through** to Mealie's authz).

Applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1 read + write-dispatcher / variant-collapse, §1.6 toolsets) and finishes the **users_auth** row of §3.2. Every endpoint shape below was inventoried and **adversarially verified against the committed `src/types/mealie.ts`** by an 8-resource-group inventory → independent skeptic → reconcile workflow: **22/22 operations confirmed, zero load-bearing corrections, zero missing, zero phantom**; the highest-stakes facts (the UserBase full-replace PUT, the write-once token secret, the `profile` multipart field, the `UserRatings_*_` wrapper shape, the absent GET/DELETE on `/api/users/{item_id}`) independently re-checked with exact line evidence.

The users domain is the **current user's self-service surface** (`/api/users/self`, ratings/favorites, passwords, registration, api-tokens, avatar) — NOT admin user management (`/api/admin/users`, PR #10). It is **opt-in** — OFF unless `users` is named in `MEALIE_TOOLSETS`. The default surface stays exactly at today's **26 reads / 66 full**.

---

## 1. Scope

**One PR** (explicit decision, matching #3/#4/#5/#7/#8). Self-service only; the roadmap's "users_auth" row spans the CRUD/Authentication/Ratings/Passwords/Tokens/Registration/Images tags, and the admin boundary is drawn at the URL surface: everything under `/api/users/*` is here, everything under `/api/admin/users/*` is PR #10.

**Coverage:** **22 endpoints** → **8 new tools** (2 reads + 6 writes) covering 17 mapped ops, plus **5 intentionally omitted** auth ops. Opt-in (default OFF).

| Resource group | Ops | Reads | Writes |
|---|---:|---:|---:|
| Self profile (`/self`, `PUT /users/{item_id}`) | 2 | →`user_me` (1 of 4) | →`user_self_update` (1) |
| Self ratings/favorites reads | 3 | →`user_me` (3 of 4) | — |
| Per-user ratings/favorites (by-id reads + writes) | 5 | →`user_ratings_get` (2) | →`user_ratings_write` (3) |
| Passwords (change/forgot/reset) | 3 | — | →`user_password_write` (3) |
| Registration | 1 | — | →`user_register` (1) |
| API tokens (create/delete) | 2 | — | →`user_api_token_write` (2) |
| Avatar image (multipart) | 1 | — | →`user_avatar_upload` (1) |
| Auth (token/logout/refresh/oauth ×2) — **OMITTED** | 5 | — | — |
| **Total** | **22** | **2 tools / 6 ops** | **6 tools / 11 ops** |

**Omission ledger:** the 5 auth ops (`POST /api/auth/token`, `POST /api/auth/logout`, `GET /api/auth/refresh`, `GET /api/auth/oauth`, `GET /api/auth/oauth/callback`) are login/session/OAuth — handled by server config, not agent tools. The inventory confirmed all five are pure session ops (every 200 response is bare `unknown`; the only request body is the form-urlencoded login). **Verified-absent, not forgotten:** `GET` and `DELETE` on `/api/users/{item_id}` are typed `never` — there is **no delete-account or user-by-id read endpoint** in this surface (by-id user reads live under `/api/admin/users`, PR #10).

**Roadmap count delta (flagged):** lands at **8 tools vs the ~9 target** — the password trio and the token pair each collapsed behind one `action` dispatcher. Per the §3 calibration note, counts are TARGETS; no tools invented to hit a number.

---

## 2. Reuse the PR #7 toolset switch (no new mechanism)

1. **`config.ts`** — add `"users"` to `KNOWN_TOOLSETS` (one line). `parseToolsets`, `ToolsetName`, and unknown-token-warns behavior already cover it.
2. **`server.ts`** — one conditional after the groups registration:
   ```ts
   if (options.toolsets.has("users")) registerUserTools(server, client, options);
   ```
3. **`index.ts` / transports** — **no change.**

Composition with `MEALIE_READ_ONLY` is orthogonal and free: `registerUserTools` applies the same internal read/write split, so `MEALIE_TOOLSETS=users` + read-only exposes the 2 reads and strips the 6 writes.

---

## 3. The 8 tools (`src/tools/users/`)

### 3.1 Reads (always on) — 2

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `user_me` | `GET /users/self` · `GET /users/self/ratings` · `GET /users/self/ratings/{recipe_id}` · `GET /users/self/favorites` | **`view` discriminator** (`profile` default \| `ratings` \| `favorites`). `profile` → `UserOut` entity, `response_format: concise\|detailed`; **concise MUST retain `tokens[{id,name,createdAt}]`** — `UserOut.tokens` (`LongLiveTokenOut[]`, never the raw token value) is the **only token-enumeration path** in the entire API (no list endpoint), and `user_api_token_write(delete)` needs the integer `id` from it. `ratings`/`favorites` → **`UserRatings_UserRatingSummary_` wrapper** `{ratings: [...]}` — a **third list shape** (not a pagination envelope, not a bare array) → return `{items, count}`. Optional **`recipe_id`** (with `view: ratings`) → `GET /self/ratings/{recipe_id}` → single `UserRatingSummary` (`{recipeId, rating, isFavorite}`); plain string param (no uuid format upstream). |
| `user_ratings_get` | `GET /users/{id}/ratings` · `GET /users/{id}/favorites` | **`user_id` required** + **`view`** (`ratings` default \| `favorites`). Items are `UserRatingOut` (adds `userId` + `id` vs the self Summary shape); same `UserRatings_UserRatingOut_` wrapper → `{items, count}`. Description states explicitly: **user ids come from the groups toolset's `group_self_get(view: members)`** — this tool is cross-toolset glue for "what does this household member rate?". Both ops 200-only; favorites returns the same wrapper schema as ratings (server filters). |

### 3.2 Writes (stripped under read-only) — 6

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `user_self_update` | `PUT /users/{item_id}` | **Fetch-merge mandatory** — the PUT reuses `mealie__schema__user__user__UserBase` (NO `UserUpdate`/`UserCreate` schema exists; grep-verified), with required `email` + 8 required-with-default booleans (`admin`, `advanced`, `showAnnouncements`, `canInvite`, `canManage`, `canManageHousehold`, `canOrganize`, plus `authMethod` enum `Mealie\|LDAP\|OIDC` @default Mealie). **Whitelist-project, don't strip:** `UserOut` carries `groupId`/`groupSlug`/`householdId`/`householdSlug`/`tokens`/`cacheKey` which are NOT in the UserBase schema — build the PUT body by projecting the fetched `UserOut` onto the UserBase field set (`id`, `username`, `fullName`, `email`, `authMethod`, `admin`, `group`, `household`, `advanced`, `showAnnouncements`, `lastReadAnnouncement`, `canInvite`, `canManage`, `canManageHousehold`, `canOrganize`), then overlay the freeform `changes` record. Self-scoped: GET `/self` supplies both the merge base and the `{item_id}`. **Permission flags pass through** (explicit decision) — Mealie's server-side authz is the real gate; the description notes they require admin rights. `group`/`household` in UserBase are nullable **name strings**, not ids. PUT response is `unknown` → echo the merged body concise. `idempotentHint`. |
| `user_password_write` | `PUT /users/password` · `POST /users/forgot-password` · `POST /users/reset-password` | **`action`** (`change`\|`forgot`\|`reset`). change = `ChangePassword {currentPassword, newPassword}` (both required; currentPassword @default ""); forgot = `ForgotPassword {email}` (sends a reset email — requires instance SMTP; public in practice); reset = `ResetPassword {token, email, password, passwordConfirm}` (all required; the emailed token is the credential — works unauthenticated). **No confirm** (explicit decision: change is self-gated by `currentPassword`, reset by the out-of-band token; confirm = destructive/irreversible only). **Secrets never echoed or logged:** `currentPassword`/`newPassword`/`password`/`passwordConfirm`/`token` appear in no response (all three 200s are `unknown`) → synthesize `{action, success: true}`; the client logs url+method only. |
| `user_register` | `POST /users/register` | Typed `CreateUserRegistration` body: required `email`/`username`/`fullName`/`password`/`passwordConfirm`; required-with-default `advanced`(false)/`private`(false)/`seedData`(false)/`locale`("en-US") — supplied in the typed literal; optional `group`/`household` (name strings) + `groupToken` (invite token — treat as secret, never echo). **Public endpoint** (only an accept-language header upstream; the optional `groupToken` rides in the body) — appropriate as an opt-in tool: it creates a NEW account, the one op here that isn't current-user-scoped; instances with signup disabled return an error → surface Mealie's error body. 201 → `UserOut` → echo concise (id, username, fullName, email, groupId, householdId) — **never** `password`/`passwordConfirm`/`groupToken`. Plain create: no confirm. |
| `user_ratings_write` | `POST /users/{id}/ratings/{slug}` · `POST /users/{id}/favorites/{slug}` · `DELETE /users/{id}/favorites/{slug}` | **`action`** (`rate`\|`favorite`\|`unfavorite`) + **`recipe_slug`**. **Self-scoped: there are NO self write endpoints for ratings/favorites** (inventory-verified — writes exist only on the by-id paths) → the handler resolves its own id via GET `/self` first. `rate` → body `UserRatingUpdate {rating}` (float-capable `number`; body REQUIRED upstream even though its fields are optional). `favorite`/`unfavorite` → no body (identified by path params). `unfavorite` is a DELETE → **`destructiveHint` + handler-enforced `confirm: true`** (house rule; explicitly kept). All three 200s are `unknown` → synthesize `{action, recipeSlug}` echo. |
| `user_api_token_write` | `POST /users/api-tokens` · `DELETE /users/api-tokens/{token_id}` | **`action`** (`create`\|`delete`). create = `LongLiveTokenIn {name (required), integrationId (@default "generic")}` → **201 `LongLiveTokenCreateResponse`** — the response **carries the raw `token` value** (upstream schema doc: "Should ONLY be used when creating a new token, as the token field is sensitive"). **Deliberately surface it once** with an explicit note: *shown only at creation, never retrievable again* (`LongLiveTokenOut` — the read view via `user_me` profile — has no token field). Never logged (client logs url+method only, never bodies). delete = confirm-gated (`destructiveHint` — revokes an integration's credential irrevocably); **`token_id` is an INTEGER** (not uuid; the one integer id in this domain); 200 `DeleteTokenResponse {tokenDelete}` → synthesize `{deleted: token_id}`. |
| `user_avatar_upload` | `POST /users/{id}/image` | **Multipart** (`multipart/form-data`). Reuses `readUploadFile` + `postMultipart` (recipe-import / group_start_migration precedent; file read in the **registration layer** so the handler stays filesystem-free). FormData = **exactly one field named `profile`** (verbatim — NOT `file`, NOT `profile_image`; verified at the `Body_update_user_image_…` schema). Self-scoped via GET `/self` for the `{id}`. 200 `unknown` → synthesize `{uploaded: true}`. Replaces the existing avatar (an update, not a destroy): no confirm. |

`accept-language` (optional header on nearly every op) is **intentionally omitted** across all tools — matches every prior domain; the client uses fixed JSON headers.

---

## 4. Cross-Cutting

### 4.1 Foundation reused (no new `MealieClient` methods)

Every tool uses the existing generic verbs (`get`/`post`/`put`/`delete`, plus `postMultipart` for the avatar). Consolidation lives entirely in the tool layer; the client stays strictly 1:1/thin. Shared `jsonResult`/`errorResult` (surfacing Mealie's error body via `MealieApiError`) and `requireConfirmation(confirm, action)` (handler-enforced, **before the try**).

### 4.2 The carried-forward gotchas, instantiated for this PR

1. **Fetch-merge on the profile PUT** — no Update schema exists; UserBase is a full replace with required `email` + 8 required booleans. **Whitelist-project** the fetched `UserOut` onto the UserBase field set (UserOut's extra `groupId`/slugs/`tokens`/`cacheKey` are not in the PUT schema), overlay `changes`, PUT the complete body.
2. **The write-once secret** — token create is the inverse of PR #8's `apiKey`: the secret appears ONLY in the create response (never in any read), so the tool surfaces it deliberately, exactly once, with a "never retrievable again" note. Passwords/reset-token/`groupToken` are conventional write-only secrets: never echoed, never logged.
3. **Self-id resolution** — `user_self_update`, `user_ratings_write`, `user_avatar_upload` all need the current user's id; each handler GETs `/self` first (no self-scoped write endpoints exist). One extra read per write — acceptable; the update needed the GET anyway for fetch-merge.
4. **List shape asymmetry, third kind** — ratings/favorites reads return the `UserRatings_*_` **wrapper** `{ratings: []}`: not a pagination envelope, not a bare array. Self reads return `UserRatingSummary` items; by-id reads return `UserRatingOut` items (extra `userId`/`id`) — different schemas, same wrapper pattern → uniform `{items, count}`.
5. **Required-with-default fields a typed literal must supply** — register `advanced`/`private`/`seedData`(false) + `locale`("en-US"); token `integrationId`("generic"). Verified against `mealie.ts` `required` sets.
6. **Response-shape opacity** — every password op, the profile PUT, all three rating/favorite writes, and the avatar upload return 200 `unknown` → synthesize concise echoes; never parse the body.
7. **Integer `token_id`** — the api-token delete key is a `number`, unlike every uuid elsewhere; the zod schema uses `z.number().int()`.

### 4.3 Typed vs freeform bodies

Typed `components["schemas"][...]` literals for `CreateUserRegistration`, `LongLiveTokenIn`, `UserRatingUpdate`, `ChangePassword`/`ForgotPassword`/`ResetPassword`. Freeform `z.record(z.unknown())` **untyped** `changes`, fetch-merged, for `user_self_update` (the UserBase projection is built in the handler). Enum validated verbatim: `AuthMethod` (`Mealie|LDAP|OIDC`) — passes through inside `changes`, not separately validated.

### 4.4 Annotations

`readOnlyHint` on the 2 reads. `idempotentHint` on `user_self_update` (PUT). `destructiveHint` + `confirm` on **2** ops: `user_ratings_write(unfavorite)` and `user_api_token_write(delete)`. Password ops, register, rate/favorite, avatar: plain writes (no confirm — explicit decision). `openWorldHint: true` globally; `user_register` and `user_password_write(forgot|reset)` flagged in descriptions as side-effecting/public-surface ops (account creation, email send).

---

## 5. File Organization

Flat `src/tools/users/` dir, one tool per file (+ colocated `.test.ts`), one `index.ts` applying the read/write split, one `user-projection.ts` for concise helpers. **10 source files — under the 20-cap.**

```
src/tools/users/    index.ts, user-projection.ts,
                    user-me.ts, user-ratings-get.ts,
                    user-self-update.ts, user-password-write.ts, user-register.ts,
                    user-ratings-write.ts, user-api-token-write.ts, user-avatar-upload.ts
```

`index.ts` → `registerUserTools(server, client, { readOnly })`; registers the 2 reads always, the 6 writes only when `!readOnly`. `createServer` gains one conditional call. Imports flow downward only; no sibling cross-imports.

---

## 6. Testing

- **Per-handler unit tests** with hand-written `MealieClient` fakes (generic `async <T>(): Promise<T>`, per strict TS). Cover: the `view`/`action` discriminator branches; **fetch-merge whitelist regression** (untouched UserBase fields preserved; `groupId`/`groupSlug`/`householdId`/`householdSlug`/`tokens`/`cacheKey` NEVER sent in the PUT body; `changes` overlay wins); **secrets never echoed** (passwords, reset token, `groupToken` absent from every result payload) + **token-create echoes the raw token exactly once with the shown-once note**; concise `user_me` profile **retains `tokens[{id,name}]`**; the confirm gate (missing → `isError` before any client call; present → proceeds) on `unfavorite` + token delete; **self-id resolution** (writes GET `/self` then hit the by-id path); the wrapper-shape reads (`{ratings: []}` → `{items, count}`) for both Summary and Out variants; **multipart FormData assembly** — the single `profile` field lands in the FormData; **integer `token_id`**; required-with-default register fields present in the typed body; `isError` on client throw surfacing Mealie's error body.
- **`config.test.ts`:** a `users` token enables users; `households,automation,groups,users` enables all four; unknown token still warns + is ignored while `users` survives.
- **`server.test.ts` — grow the opt-in axis** (`USERS_READS` = 2, `USERS_WRITES` = 6; grown per-resource as they land):
  - **Default (no toolsets) stays 26 / 66** — assert all 8 user tools **absent** (regression guard).
  - **`users` enabled, full → 74** (28 reads + 46 writes); households/automation/groups absent.
  - **`users` enabled + read-only → 28 reads** (the 2 reads appear; the 6 writes stripped).
  - **All four toolsets enabled, full → 99** (38 reads + 61 writes) — proves orthogonal composition.
- **Real-stdio subprocess check:** tools/list for (a) default ⇒ 66/26 with no `user_*`, (b) `MEALIE_TOOLSETS=users` ⇒ 74, (c) + read-only ⇒ 28. **demo.mealie.io caveat:** the self/ratings/tokens/avatar ops are **401 without a token**; register/forgot are public but **must not be live-tested** (real account creation / email send are external side effects). Covered by unit fakes; **real-instance testing remains owed** (noted in the PR body).
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` — exit 0 (`npx biome check --write src/` to auto-fix import-order).

---

## 7. Process

- Branch `feature/users` off `develop` (verified @ 26/66 with PR #8 merged, HEAD `74204da`); **draft** PR into `develop`.
- **Sequential TDD in the main loop** (shared `config.ts`, `server.ts`, per-domain `index.ts`, `server.test.ts` + per-step quality gate make parallelism unsafe). Foundation/archetype-first:
  1. **Toolset wiring + `user_me`** — `users` in `KNOWN_TOOLSETS` + `createServer` conditional + `registerUserTools` with the first real tool folded in (Biome bans an empty registrar's unused params); `config.test.ts` + the `server.test.ts` default-26/66-unchanged guard. Proves the switch + the read archetype + the projection helper.
  2. **`user_ratings_get`** — the by-id wrapper reads (Out variant).
  3. **`user_self_update`** — the fetch-merge whitelist archetype.
  4. **`user_ratings_write`** — self-id resolution + the confirm gate.
  5. **`user_api_token_write`** — the write-once secret + integer id.
  6. **`user_password_write`** — the secret-heavy dispatcher.
  7. **`user_register`** — public typed-body create.
  8. **`user_avatar_upload`** — multipart.
  9. Bump `server.test.ts` counts to final (74 full / 28 read-only when `users` on; 99 all-four; 66/26 default unchanged); real-stdio check; README `MEALIE_TOOLSETS=users`.
- **Adversarial multi-lens code review** (workflow) before hand-off; then the author runs `superpowers:requesting-code-review`.

---

## 8. Sources

- Adversarially-verified endpoint inventory: 8-resource-group inventory → independent skeptic per group → reconcile workflow against committed `src/types/mealie.ts` — **22/22 operations confirmed** (17 mapped + 5 omitted), one non-load-bearing correction (an incomplete schema enumeration in a `surprises` note); highest-stakes facts (the `mealie__schema__user__user__UserBase` full-replace PUT with no Update schema; `LongLiveTokenCreateResponse.token` write-once secret + `LongLiveTokenOut` never carrying it + no token list endpoint; the `profile` multipart field name; the `UserRatings_*_` wrapper shapes Summary-vs-Out; GET/DELETE `never` on `/api/users/{item_id}`; the integer `token_id`; register's public-endpoint evidence + required-with-default fields) independently re-checked with exact line evidence.
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1, §1.6), §3.2 (users_auth row), §3.3 (PR #9).
- Freshest archetype precedent: [`2026-06-02-groups-design.md`](./2026-06-02-groups-design.md) (the opt-in toolset reuse; read + write-dispatcher; fetch-merge full-replace PUTs; write-only secret handling; multipart-in-an-opt-in-domain; per-domain read/write split). Multipart precedent: `src/tools/recipes/import/recipe-import.ts` (`readUploadFile` + `postMultipart` + registration-layer file read).
