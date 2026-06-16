# PR #10 Design — Opt-in: Admin

**Date:** 2026-06-06
**Branch:** feature/admin → develop (PR #10)
**Status:** Approved (scope confirmed: **one PR, one `admin` toolset token**; backup restore exposed behind a **double gate** — `confirm: true` + `confirm_file_name` re-typed exact-match).

Applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 (esp. §1.1 read + write-dispatcher, §1.4 writes & safety, §1.6 toolsets) and finishes the **admin** row of §3.2. Every endpoint shape below was inventoried and **adversarially verified against the committed `src/types/mealie.ts`** by an 8-group inventory → independent-skeptic-per-group → reconcile workflow: **38/38 operations confirmed** (about=3, users=7, households=5, groups+ai=9, email=2, backups=6, maintenance=5, debug=1), all 24 `/api/admin/*` paths covered by exactly one group, zero phantom/missed ops, two non-load-bearing line-citation corrections resolved by re-reading.

The admin domain is the **site-operator surface** (`/api/admin/*`): admin CRUD for users/households/groups, backup lifecycle (including the **single most destructive operation in the entire API** — restore), maintenance cleans, AI providers (admin-scoped), instance about/statistics, email test, and the OpenAI debug probe. It is **opt-in** — OFF unless `admin` is named in `MEALIE_TOOLSETS`. The default surface stays exactly at today's **26 reads / 66 full**. This is the highest-blast-radius domain in the roadmap; it ships last among the management domains, gated three ways (opt-in toolset × read-only switch × per-op confirm gates).

---

## 1. Scope

**One PR** (explicit decision, matching #3/#4/#5/#7/#8/#9; the roadmap's single-PR phasing). **One `admin` token** (explicit decision — `MEALIE_READ_ONLY` already provides the safe composition; no `admin_ops` split).

**Coverage:** **38 endpoints → 17 new tools** (7 reads + 10 writes). Opt-in (default OFF). Lands under the roadmap's ~20–27 target — consistent with every prior PR landing under target; no tools invented to hit a number.

| Resource group | Ops | Reads | Writes |
|---|---:|---|---|
| About/statistics/check + email-ready | 4 | `admin_about` (4) | — |
| Manage users | 7 | `admin_user_get` (2) | `admin_user_write` (3) + `admin_user_actions` (2) |
| Manage households | 5 | `admin_household_get` (2) | `admin_household_write` (3) |
| Manage groups | 5 | `admin_group_get` (2) | `admin_group_write` (3) |
| AI providers (admin-scoped) | 4 | `admin_ai_provider_get` (1) | `admin_ai_provider_write` (3) |
| Backups | 6 | `admin_backup_get` (2) | `admin_backup_write` (3) + `admin_backup_restore` (1) |
| Maintenance | 5 | `admin_maintenance_get` (2) | `admin_maintenance_clean` (3) |
| Email test | 1 | — (ready folded into `admin_about`) | `admin_email_test` (1) |
| Debug | 1 | — | `admin_debug_openai` (1) |
| **Total** | **38** | **7 tools / 15 ops** | **10 tools / 23 ops** |

**Boundary notes (already drawn, not re-litigated):** user-by-id GET/DELETE live HERE — PR #9 verified they are absent (`never`) from the self-service `/api/users/{item_id}` surface. The admin AI-provider ops reuse the **exact same component schemas** as PR #8's group-scoped ones (`AIProviderCreate`/`AIProviderUpdate`/`AIProviderOut` — verified by line citation on both path families) and add a `group_id` path param; there is **NO admin ai-provider settings path** (settings exist only group-scoped at `/api/groups/ai-providers/settings`, covered in PR #8).

---

## 2. Reuse the PR #7 toolset switch (no new mechanism — 4th reuse)

1. **`config.ts`** — add `"admin"` to `KNOWN_TOOLSETS` (one line).
2. **`server.ts`** — one conditional after the users registration:
   ```ts
   if (options.toolsets.has("admin")) registerAdminTools(server, client, options);
   ```
3. **`index.ts` / transports** — **no change.**

Composition with `MEALIE_READ_ONLY` is orthogonal and free: `registerAdminTools` applies the same internal read/write split — `MEALIE_TOOLSETS=admin` + read-only exposes the 7 reads and strips the 10 writes.

---

## 3. The 17 tools (`src/tools/admin/`)

### 3.1 Reads (always on within the toolset) — 7

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `admin_about` | `GET /admin/about` · `GET /admin/about/statistics` · `GET /admin/about/check` · `GET /admin/email` | Aggregated read (`app_get_info` precedent): always about; `include: [statistics, check, email_ready]`. `AdminAboutInfo` (20 fields, superset of public AppInfo) — **`dbUrl` is REDACTED unconditionally** (a DB connection string may embed credentials; apiKey-projection precedent). `AppStatistics` = 6 required integer counts (NOT a pagination envelope despite `total*` keys). `CheckAppConfig` = 5 readiness booleans. `email_ready` (`EmailReady {ready}`) is **intentionally redundant** with `CheckAppConfig.emailReady` — folded here so the read maps somewhere sensible rather than minting a one-field tool. Catch path: `secretSafeErrorResult` (defensive — a parse error could embed a dbUrl-bearing body snippet). |
| `admin_user_get` | `GET /admin/users` · `GET /admin/users/{item_id}` | Branch on `item_id`. List = `UserPagination` envelope (snake_case `per_page`/`total_pages` + `next`/`previous`; camelCase **request** params — the standing casing asymmetry) → shared `getPaginated`. Items/entity = `UserOut`. **`cacheKey` redacted from output** (opaque session-ish value); `tokens` (`LongLiveTokenOut[]`) kept — verified metadata-only (name/id/createdAt, no token value). |
| `admin_household_get` | `GET /admin/households` · `GET /admin/households/{item_id}` | `HouseholdPagination` envelope / `HouseholdInDB` (8 fields, incl. nested `group` name, `preferences`, `users`, `webhooks`). |
| `admin_group_get` | `GET /admin/groups` · `GET /admin/groups/{item_id}` | `GroupPagination` envelope / `GroupInDB` (incl. nested `categories`, `webhooks`, `households`, `users`, `preferences`). |
| `admin_ai_provider_get` | `GET /admin/groups/{group_id}/ai-providers/providers/{provider_id}` | Both params required — **there is NO admin provider-list endpoint** (verified). Description cross-references the groups toolset: enumerate providers via `group_ai_provider_get` (group-scoped settings list). `AIProviderOut` (no `apiKey` — never echoed by upstream). |
| `admin_maintenance_get` | `GET /admin/maintenance` · `GET /admin/maintenance/storage` | `view: summary\|storage`. `MaintenanceSummary {dataDirSize: STRING, cleanableImages: number, cleanableDirs: number}`; `MaintenanceStorageDetails` = 5 required **human-readable STRING** sizes (not numbers — do not parse). |
| `admin_backup_get` | `GET /admin/backups` · `GET /admin/backups/{file_name}` | No `file_name` → `AllBackups` **WRAPPER** `{imports: BackupFile[], templates: string[]}` (not an envelope, not a bare array; `BackupFile {name, date, size: STRING}`). With `file_name` → `FileTokenResponse {fileToken}` — a download **token**, not bytes — composed into `<baseUrl>/api/utils/download?token=<encoded>` (the `app_download_file` flow; media-as-URLs convention). **Catch path MUST be `secretSafeErrorResult`** — a JSON.parse failure on the token response would embed the secret in `error.message`. |

### 3.2 Writes (stripped under read-only) — 10

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `admin_user_write` | `POST /admin/users` · `PUT /admin/users/{item_id}` · `DELETE /admin/users/{item_id}` | **`action: create\|update\|delete`.** create = typed `UserIn` (truly-required `username`/`fullName`/`email`/`password`; required-with-@default `authMethod`("Mealie")/`admin`(false)/`advanced`(false)/`showAnnouncements`(true)/`canInvite`(false)/`canManage`(false)/`canManageHousehold`(false)/`canOrganize`(false) supplied in the literal) — **password is a plaintext request secret**: never echoed (echo = concise UserOut projection), never logged, catch = `secretSafeErrorResult`. update = **fetch-merge, straight round-trip**: the PUT body **IS `UserOut`** (the read schema — NO distinct UserUpdate/AdminUserIn exists; grep-verified) → GET by id, shallow-merge freeform `changes`, PUT the full object **including** server-derived `id`/`groupId`/`groupSlug`/`householdId`/`householdSlug`/`cacheKey`/`tokens` (the merge base keeps everything; only model-facing *output* is redacted). **PUT cannot change a password** (UserOut has no password field) — description points at `admin_user_actions(password_reset_token)`. delete = confirm-gated; 200 echoes the deleted `UserOut` → synthesize `{deleted: item_id}`. |
| `admin_user_actions` | `POST /admin/users/unlock` · `POST /admin/users/password-reset-token` | **`action: unlock\|password_reset_token`** (account-recovery pairing). unlock: optional `force` boolean **query** flag (passed through); 200 `UnlockResults {unlocked}` → echo count. password_reset_token: body `ForgotPassword {email}`; **201 `PasswordResetToken {token}` — the RESPONSE carries the reset secret** → **write-once deliberate surfacing** (`user_api_token_write` precedent): shown exactly once with a "deliver out-of-band; never retrievable again" note; never logged; catch = `secretSafeErrorResult`. |
| `admin_household_write` | `POST /admin/households` · `PUT /admin/households/{item_id}` · `DELETE /admin/households/{item_id}` | **`action: create\|update\|delete`.** create = `HouseholdCreate {name (req), groupId? (plain string, no uuid format — do not uuid-validate)}`. update = **whitelist-projection fetch-merge** onto the DISTINCT-but-narrower `UpdateHouseholdAdmin {id (uuid4, REQUIRED IN BODY — duplicated from the path param), groupId (uuid4, req), name (req), preferences?}`: project the fetched `HouseholdInDB` onto exactly those fields (read-side `slug`/`group`-name/`users`/`webhooks` are NOT in the PUT schema); nested `preferences` projected from `ReadHouseholdPreferences` onto the `UpdateHouseholdPreferences` field set (the PR #7 full-replace trap, applied at one remove) and **omitted unless present/changed** so a flat merge can't blank it. delete = confirm-gated; **200 (not 204)** echoes the deleted `HouseholdInDB` → `{deleted: item_id}`. |
| `admin_group_write` | `POST /admin/groups` · `PUT /admin/groups/{item_id}` · `DELETE /admin/groups/{item_id}` | **`action: create\|update\|delete`.** create = `GroupBase {name}` — one field only. update = whitelist-projection fetch-merge onto `GroupAdminUpdate {id (uuid4, req in body), name (req), preferences? (UpdateGroupPreferences — the PR #8 strip-groupId/id lesson), aiProviderSettings? (AIProviderSettingsUpdate)}`: read-side `slug`/`categories`/`webhooks`/`households`/`users` are NOT in the PUT schema; **`aiProviderSettings` is write-only (absent from `GroupInDB`) → omitted entirely unless the caller supplies it** (cannot be fetch-merged; PR #8's settings pointers semantics apply if set). delete = confirm-gated; 200 echoes `GroupInDB` → `{deleted: item_id}`. |
| `admin_ai_provider_write` | `POST /admin/groups/{group_id}/ai-providers/providers` · `PUT .../{provider_id}` · `DELETE .../{provider_id}` | **`action: create\|update\|delete`**, `group_id` required on all three. Same schemas as PR #8: create = `AIProviderCreate` (**`apiKey` write-only request secret**, @default ""; required-with-default `timeout`(300)/`requestHeaders`({})/`requestParams`({})); **create returns 200, not 201** (the one non-201 create). update = `AIProviderUpdate` (field-identical to Create, no id) — **fetch-merge CANNOT recover `apiKey`** (`AIProviderOut` omits it): **caller MUST re-supply `apiKey` on every update or it resets to empty** (PR #8 fact verbatim; stated in the description). delete = confirm-gated; 200 echoes `AIProviderOut` → `{deleted: provider_id}`. `apiKey` never echoed (projection drops it defensively); catch = `secretSafeErrorResult`. |
| `admin_backup_write` | `POST /admin/backups` · `POST /admin/backups/upload` · `DELETE /admin/backups/{file_name}` | **`action: create\|upload\|delete`.** create = **no body**; **201** `SuccessResponse`. upload = **multipart** `Body_upload_one_api_admin_backups_upload_post`, single required field verbatim **`archive`** — `readUploadFile` + `postMultipart`, **registration-layer file read** (recipe-import/group-migration precedent; handler stays fs-free). delete = confirm-gated (`file_name`); 200 `SuccessResponse`. **All `SuccessResponse` results check `error: true` on a 200 = failure** (group_seed precedent) → surface `message` via `errorResult`. |
| `admin_backup_restore` | `POST /admin/backups/{file_name}/restore` | **Standalone tool — the most destructive op in the entire API** (overwrites the whole instance database). **Double gate (explicit decision):** `requireConfirmation(confirm, …)` **AND** `confirm_file_name` must `===` `file_name` exactly — both checked **before the try and before any client call**. No request body upstream (target = path param only). `destructiveHint`; description warns in caps that it OVERWRITES the instance and that Mealie restarts/invalidates sessions. 200 `SuccessResponse` (error-flag check) → `{restored: file_name}`. |
| `admin_maintenance_clean` | `POST /admin/maintenance/clean/images` · `…/clean/temp` · `…/clean/recipe-folders` | **`target: images\|temp\|recipe_folders`**, **confirm-gated** (upstream has NO confirmation flag — these delete files irreversibly: non-.webp images / temp dir / recipe folders with non-UUID names). No bodies. 200 `SuccessResponse` (error-flag check) → `{cleaned: target, message}`. |
| `admin_email_test` | `POST /admin/email` | Body `EmailTest {email}` (JSON, not multipart). Side-effecting non-destructive write (sends a real email) — registered as a WRITE, no confirm (PR #7 action-verb precedent). **Positive-success semantics:** 200 + `EmailSuccess {success: false, error: "<message>"}` = failure → `errorResult` surfacing the message (NOT `SuccessResponse`'s boolean-error convention — the two differ). |
| `admin_debug_openai` | `POST /admin/debug/openai/{provider_id}` | **Optional multipart**: `Body_debug_openai_…_post` with single optional+nullable field verbatim **`image`**; the whole body is optional → no `image_path` ⇒ POST with no body, with ⇒ registration-layer file read → `postMultipart`. Write (fires a real call against the configured AI provider). 200 `DebugResponse {success, response?}` → surface both (response is a free-form opaque string — never parsed). |

`accept-language` (optional header on every op) is intentionally omitted — matches every prior domain.

---

## 4. Cross-Cutting

### 4.1 Foundation reused (no new `MealieClient` methods)

Generic verbs `get`/`getPaginated`/`post`/`put`/`delete` + `postMultipart` + `readUploadFile` + `jsonResult`/`errorResult`/`secretSafeErrorResult` + `requireConfirmation`. Consolidation lives entirely in the tool layer.

### 4.2 Secret inventory (the never-echo / `secretSafeErrorResult` checklist)

**Five hard secrets** (adversarially verified, with line evidence):
1. `UserIn.password` — request, admin user create (plaintext).
2. `PasswordResetToken.token` — **response**, write-once → deliberate show-once surfacing.
3. `AIProviderCreate.apiKey` — request, write-only.
4. `AIProviderUpdate.apiKey` — request, write-only (absent from every read shape).
5. `FileTokenResponse.fileToken` — **response**; surfaced deliberately as the download URL (that is the endpoint's purpose), but the **error path** must not leak it.

**Two borderline values redacted from read outputs** (defensive, apiKey-projection precedent): `UserOut.cacheKey`, `AdminAboutInfo.dbUrl`. Redaction applies to **model-facing output only** — internal fetch-merge bases keep the full object (the user PUT round-trips `cacheKey`/`tokens`).

**`secretSafeErrorResult` (HTTP status only; never `error.message`) on:** `admin_user_write`, `admin_user_actions`, `admin_ai_provider_write`, `admin_backup_get`, `admin_about`. Rationale (PR #9 foundation): Mealie 422 bodies echo rejected **request** input (Pydantic `ValidationError.input`) and parse errors embed **response** snippets — secrets ride in both directions here. Negative result (verified): `LongLiveTokenOut` (`UserOut.tokens`) is metadata-only — NOT a secret; must not drift into the redaction list.

### 4.3 The carried-forward gotchas, instantiated for this PR

1. **Three different PUT/update archetypes in one domain:** users = reuse-the-read-schema (`UserOut` → straight merge round-trip); households/groups = DISTINCT-but-narrower Update schemas → **whitelist-projection** (UserBase precedent), with **`id` required IN THE BODY** (duplicated from the path param) on both; ai-providers = distinct-but-field-identical Update with an unrecoverable write-only secret (re-supply `apiKey`).
2. **No uuid validation on ANY admin path param** — `item_id`/`group_id`/`provider_id`/`file_name` are all plain `string` upstream (no `Format: uuid4` at the param level); `file_name` is a filename. Plain `z.string()` everywhere.
3. **Create status codes are NOT uniform** (201 for user/household/group/backup-create; **200 for ai-provider create** and every other POST) — irrelevant to `MealieClient` (parses any 2xx body) but documented so nobody "fixes" it.
4. **List shapes: zero bare arrays here** — three snake_case pagination envelopes (`UserPagination`/`HouseholdPagination`/`GroupPagination` → shared `getPaginated`) + one wrapper (`AllBackups {imports, templates}` → `{imports, templates}` projection, NOT `{items, count}`).
5. **Two distinct error-on-200 conventions:** `SuccessResponse {message, error: boolean @default false}` (backups, cleans, restore) vs `EmailSuccess {success: boolean, error?: string|null}` (email test — positive flag + message string). Both checked in handlers.
6. **Size fields are STRINGS** (`MaintenanceSummary.dataDirSize`, all 5 `MaintenanceStorageDetails` fields, `BackupFile.size`) — human-readable; passed through, never parsed.
7. **Required-with-default fields supplied in typed literals:** `UserIn` (8 defaults, §3.2), `AIProviderCreate` (`timeout` 300, `requestHeaders`/`requestParams` {}).
8. **Response opacity** — restore/cleans/backup-create/upload/delete return `SuccessResponse`; debug returns an opaque `response` string → synthesized concise echoes, never parsed.

### 4.4 Typed vs freeform bodies

Typed `components["schemas"][…]` literals: `UserIn`, `ForgotPassword`, `HouseholdCreate`, `GroupBase`, `AIProviderCreate`, `EmailTest`. Freeform `z.record(z.unknown())` untyped `changes`, fetch-merged, for the three updates (`admin_user_write`, `admin_household_write`, `admin_group_write`); `admin_ai_provider_write(update)` takes typed-ish named fields (apiKey re-supply semantics need explicit args, PR #8 shape).

### 4.5 Annotations

`readOnlyHint` on the 7 reads. `destructiveHint` on `admin_user_write`/`admin_household_write`/`admin_group_write`/`admin_ai_provider_write`/`admin_backup_write` (delete inside, confirm-gated in the branch), `admin_maintenance_clean`, `admin_backup_restore`. No confirm on: creates, upload, unlock, password-reset-token, email-test, debug (side-effecting non-destructive = plain writes, PR #7 precedent). `openWorldHint: true` globally. **Triple gate on the worst op:** opt-in toolset × read-only switch × confirm+`confirm_file_name` exact-match (restore).

---

## 5. File Organization — subdirs (decided)

Flat would be 19 source files — one under the hard 20-cap in the biggest domain yet; the file-org rule says subdivide when approaching the cap. Grouped by concern:

```
src/tools/admin/
  index.ts                 registerAdminTools(server, client, { readOnly }) — read/write split
  admin-projection.ts      shared concise projections (user/household/group/provider/about/backup)
  manage/                  (9) admin-user-get.ts, admin-user-write.ts, admin-user-actions.ts,
                               admin-household-get.ts, admin-household-write.ts,
                               admin-group-get.ts, admin-group-write.ts,
                               admin-ai-provider-get.ts, admin-ai-provider-write.ts
  site/                    (8) admin-about.ts, admin-backup-get.ts, admin-backup-write.ts,
                               admin-backup-restore.ts, admin-maintenance-get.ts,
                               admin-maintenance-clean.ts, admin-email-test.ts, admin-debug-openai.ts
```

Tests colocated with sources. `admin-projection.ts` sits at the common ancestor (recipes `recipe-projection.ts` precedent) — children import upward-shared code downward only; no sibling cross-imports. `index.ts` imports the 17 per-tool register functions directly.

---

## 6. Testing

- **Per-handler unit tests** with hand-written generic fakes (`async <T>(): Promise<T>`). Cover: every `action`/`view`/`target` branch; **the three update archetypes** (UserOut straight round-trip preserves `cacheKey`/`tokens` in the PUT body; household/group whitelist-projection sends ONLY the Update-schema fields with `id` duplicated into the body, omits unset nested write-only fields; apiKey re-supply vs blank); **secrets never escape** (password/reset-token/apiKey/fileToken absent from every result except the two deliberate surfacings; adversarial-injection tests prove projections drop `apiKey`/`dbUrl`/`cacheKey`); **`secretSafeErrorResult` on the five listed tools** (thrown `MealieApiError` with a secret-bearing detail surfaces status only); confirm gates fire **before any client call** (incl. fetch-merge GETs); **the restore double gate** (no confirm → isError; confirm but mismatched `confirm_file_name` → isError naming the mismatch; both correct → POST fires); multipart assembly (verbatim `archive` / optional `image`); error-on-200 for both conventions; the `AllBackups` wrapper + download-URL composition; pagination passthrough on the three envelopes.
- **`config.test.ts`:** `admin` token enables admin; unknown token still warns + is ignored.
- **`server.test.ts` — grow the opt-in axis** (`ADMIN_READS` = 7, `ADMIN_WRITES` = 10; grown per-resource as they land):
  - **Default (no toolsets) stays 26/66** — all 17 admin tools asserted absent (regression guard).
  - **`admin` enabled, full → 83** (33 reads + 50 writes); other opt-ins absent.
  - **`admin` + read-only → 33 reads** (the 7 appear; the 10 writes stripped).
  - **All FIVE toolsets, full → 116** (45 reads + 71 writes) — the composition case grows from all-four/99.
  - Existing users-on 74/28 cases stay green untouched.
- **Real-stdio subprocess check:** tools/list for (a) default ⇒ 66/26 with no `admin_*`, (b) `MEALIE_TOOLSETS=admin` ⇒ 83, (c) + read-only ⇒ 33.
- **Live testing: NO.** All `/api/admin/*` is 401/403 without an admin token on demo.mealie.io — and admin ops are too dangerous to live-test against ANY real instance (**never** live-test restore/delete/cleans/email). Unit fakes only; **real-instance testing owed**, flagged in the PR body.
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` (`npx biome check --write src/` to auto-fix).

---

## 7. Process

- Branch `feature/admin` off `develop` (verified @ 26/66 with PR #9 merged, HEAD `fd9f761`); **draft** PR into `develop`.
- **Sequential TDD in the main loop** (shared `config.ts`/`server.ts`/`server.test.ts`/`index.ts` + per-step gate make parallelism unsafe). Foundation/archetype-first:
  1. **Toolset wiring + `admin_about`** — `admin` in `KNOWN_TOOLSETS` + `createServer` conditional + `registerAdminTools` with the first tool folded in (Biome bans an empty registrar); dbUrl redaction; default-26/66 guard.
  2. **`admin_user_get`** — paginated list + by-id read archetype; cacheKey redaction.
  3. **`admin_user_write`** — the UserOut straight-round-trip merge + password secret + `secretSafeErrorResult`.
  4. **`admin_user_actions`** — unlock + the write-once reset token.
  5. **`admin_household_get` + `admin_household_write`** — the whitelist-projection archetype (id-in-body).
  6. **`admin_group_get` + `admin_group_write`** — second whitelist-projection + write-only nested `aiProviderSettings`.
  7. **`admin_ai_provider_get` + `admin_ai_provider_write`** — apiKey re-supply semantics.
  8. **`admin_backup_get` + `admin_backup_write`** — wrapper shape, download-URL, multipart upload.
  9. **`admin_backup_restore`** — the double gate.
  10. **`admin_maintenance_get` + `admin_maintenance_clean`**.
  11. **`admin_email_test`** — positive-success semantics.
  12. **`admin_debug_openai`** — optional multipart.
  13. Final counts (83/33/116), real-stdio check, README `MEALIE_TOOLSETS=admin`.
- **Adversarial multi-lens code review** (workflow) before hand-off; then `superpowers:requesting-code-review`.

---

## 8. Sources

- Adversarially-verified endpoint inventory: 8-group inventory → independent skeptic per group → reconcile workflow against committed `src/types/mealie.ts` — **38/38 operations confirmed**, all 24 admin paths covered, 2 line-citation corrections resolved by re-reading (UserIn.id plain-string; AIProviderSettingsOut citation). Highest-stakes facts (UserOut-as-PUT-body with no Update schema; `PasswordResetToken.token` response secret; verbatim multipart fields `archive`/`image`; the no-body restore; `AllBackups` wrapper; admin/group AI-provider schema identity + admin-only `group_id`; no admin provider list or settings path; plain-string path params) verified with exact line evidence.
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1, §3.2 (admin row), §3.3 (PR #10).
- Freshest archetype precedent: [`2026-06-06-users-design.md`](./2026-06-06-users-design.md) (toolset reuse; write-once secret surfacing; whitelist-projection fetch-merge; `secretSafeErrorResult` foundation; registration-layer multipart). Also [`2026-06-02-groups-design.md`](./2026-06-02-groups-design.md) (write-only apiKey; settings-pointer semantics; multipart-in-opt-in).
