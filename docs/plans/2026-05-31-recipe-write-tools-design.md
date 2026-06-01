# PR #3 Design — Recipes Domain: Writes + Remaining Reads

**Date:** 2026-05-31
**Branch:** feature/recipe-write-tools → develop (PR #3)
**Status:** Approved. Implements the cross-cutting write foundation + the complete Recipes domain (all writes + remaining reads). Builds on PR #2 (foundation + `recipe_search`/`recipe_get`).

This document is durable across PRs. It captures (1) the **final calibrated recipes tool set**, (2) the **cross-cutting write conventions** introduced here and reused by every future domain, and (3) the **research that settled the security-sensitive `recipe_import` design**. It applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 and finishes the recipes row of §3.2.

---

## 1. Scope

Complete the flagship recipes domain in a single PR (explicit scope decision): all recipe writes + the remaining reads, plus the reusable write infrastructure (`MealieClient` write verbs + multipart upload, the `confirm: true` convention, the server-side read-only switch, and `destructiveHint` annotations).

**Coverage:** 56 recipe-domain operations in scope → **21 new tools** (23 total incl. PR #2's `recipe_search`/`recipe_get`).

### 1.1 The 56-vs-58 reconciliation
The roadmap §3.1 lists recipes as **58 ops**. Under the literal recipe-domain prefixes (`/api/recipes`, `/api/parser`, `/api/comments`, `/api/shared/recipes`, `/api/media/recipes`) there are exactly **56 operations across 39 paths**. The remaining 2 are recipe-*adjacent* but tagged `users` (e.g. `GET /api/users/self/ratings`, `.../self/favorites`, `POST /api/users/{id}/ratings/{slug}`, `.../favorites/{slug}`). They belong to **`users_auth` / PR #9** and are intentionally not covered here. The 259/259 accounting stays honest: these ops are counted under `users_auth`, not double-counted.

---

## 2. Final Calibrated Tool Set — 21 new (23 total)

**Decision (granularity):** the 4 sub-resources that carry both reads and writes (comments, timeline, share tokens, exports) are **split into a read tool + a write-dispatcher tool**, rather than one combined tool. Rationale: the read-only switch then strips every write tool *entirely* (zero residual mutating actions advertised in any schema), and it matches the §1.1 "read tool + write-dispatcher" wording literally. The cost is ~4 extra tool descriptions in default context — small.

Reads are **always registered**; writes are **stripped when `MEALIE_READ_ONLY=true`**.

### 2.1 Reads (always on) — 7 new + 2 shipped

| Tool | Endpoint(s) | Notes |
|---|---|---|
| `recipe_search` ✓ | `GET /api/recipes` | shipped (PR #2) |
| `recipe_get` ✓ | `GET /api/recipes/{slug}` | shipped (PR #2) |
| `recipe_suggestions` | `GET /api/recipes/suggestions` | "what can I make from these foods/tools"; distinct from `/api/explore` |
| `recipe_media` | `GET /api/media/recipes/{id}/images/{file}`, `.../images/timeline/{event}/{file}`, `.../assets/{file}` | returns **reference URLs, never bytes** (`{file}` is the `ImageType` enum) |
| `recipe_comments` | `GET /api/recipes/{slug}/comments`, `GET /api/comments`, `GET /api/comments/{id}` | read only |
| `recipe_timeline` | `GET /api/recipes/timeline/events`, `GET /api/recipes/timeline/events/{id}` | **top-level** resource; filter to a recipe via query param |
| `recipe_share` | `GET /api/shared/recipes`, `GET /api/shared/recipes/{id}`, `GET /api/recipes/shared/{token}`, `.../zip` | token list/get + public view (spans two prefixes) |
| `recipe_parse_ingredients` | `POST /api/parser/ingredient`, `POST /api/parser/ingredients` | stateless transform (no DB write) → `readOnlyHint:true`, always on; single+bulk variant-collapse |

### 2.2 Writes (stripped under read-only) — 14 new

| Tool | Endpoint(s) | Destructive |
|---|---|---|
| `recipe_create` | `POST /api/recipes` | — — returns **bare slug string** → re-fetch |
| `recipe_update` | `PUT` + `PATCH /api/recipes/{slug}` | — `idempotentHint` (PUT+PATCH collapse; both take full `Recipe-Input`) |
| `recipe_delete` | `DELETE /api/recipes/{slug}` | ✅ `confirm` |
| `recipe_update_many` | `PUT` + `PATCH /api/recipes` | — bulk update (`Recipe-Input[]`); **no bulk-create exists** |
| `recipe_import` | `create/url`, `create/url/bulk`, `create/html-or-json`, `create/zip`\*, `create/image`\*, `test-scrape-url` (preview) | — `openWorldHint:true` |
| `recipe_bulk_actions` | `bulk-actions/{tag,categorize,settings,delete}` | ✅ `confirm` on `delete` action |
| `recipe_image` | `PUT {slug}/image`\* (upload), `POST {slug}/image` (set-by-URL, JSON), `DELETE {slug}/image` | ✅ `confirm` on `delete` |
| `recipe_assets` | `POST {slug}/assets`\* | — (read via `recipe_media`) |
| `recipe_duplicate` | `POST {slug}/duplicate` | — returns `Recipe-Output` |
| `recipe_mark_made` | `PATCH {slug}/last-made` | — |
| `recipe_comment_write` | `POST` / `PUT` / `DELETE /api/comments` | ✅ `confirm` on `delete` |
| `recipe_timeline_write` | `POST` / `PUT` / `DELETE /api/recipes/timeline/events`, `PUT .../{id}/image`\* | ✅ `confirm` on `delete` |
| `recipe_share_write` | `POST` / `DELETE /api/shared/recipes` | ✅ `confirm` on `revoke` (delete) |
| `recipe_export_run` | `POST /api/recipes/bulk-actions/export` (start job), `DELETE .../export/purge` | ✅ `confirm` on `purge` |

`*` = multipart file-path upload (see §5).

### 2.3 Deliberately omitted
- **SSE `/stream` variants** (`create/url/stream`, `create/html-or-json/stream`) — return `text/event-stream`; MCP cannot consume server-sent events. The non-stream endpoints cover the same capability.
- **`create/debug`** — a dev-only endpoint that triggers an outbound scrape and returns raw debug output; no production value and extra abuse surface.

### 2.4 Endpoint shape surprises (verified against `src/types/mealie.ts`)
- `POST /api/recipes` returns a **bare slug string** on 201, not a recipe object → handler must re-fetch (see §4.1).
- `PATCH /api/recipes/{slug}` takes the **full `Recipe-Input`** (not a partial schema) → the PUT+PATCH collapse into `recipe_update` is sound.
- **Comments** live in two places: group-level `/api/comments` (full CRUD, paginated) and recipe-scoped `GET /api/recipes/{slug}/comments` (read-only). Writes go through `/api/comments` with a `recipeId` in the body.
- **Share** spans two prefixes: token CRUD at `/api/shared/recipes`, public consumption at `/api/recipes/shared/{token}`. There is **no** `/api/recipes/{slug}/share-tokens` path.
- **Timeline** is a top-level resource at `/api/recipes/timeline/events`, not nested under `{slug}`.
- **5 multipart endpoints**: `create/zip`, `create/image`, `PUT {slug}/image`, `POST {slug}/assets`, `PUT timeline/events/{id}/image`.
- **Async/202 shapes**: `create/url/bulk` and `bulk-actions/export` return `202 Accepted` (job kickoff). Export download is token-gated.
- Many write endpoints return `unknown` (untyped) 2xx bodies; handlers must not assume a typed body (re-fetch or return a synthesized confirmation — see §4.1).

---

## 3. Write Foundation — `MealieClient`

The client stays **strictly 1:1 with endpoints** (no consolidation logic; all dispatching/variant-collapse lives in the tool layer). Add **generic HTTP-verb primitives**, matching PR #2's `get`/`getPaginated` style:

- `post<T>(path, body, query?): Promise<T>`
- `put<T>(path, body, query?): Promise<T>`
- `patch<T>(path, body, query?): Promise<T>`
- `delete<T>(path, query?): Promise<T>` (no destructive endpoint in scope requires a request body)
- `postMultipart<T>(path, formData: FormData, query?): Promise<T>`

All reuse `MealieApiError` (throw on non-2xx) and `buildQueryString`.

### 3.1 The multipart headers pitfall
The constructor currently hardcodes `Content-Type: application/json` in a shared `#headers` object. Multipart requests **must not** carry a manual `Content-Type` — `fetch` derives `multipart/form-data; boundary=...` from the `FormData` instance. Refactor: store the bearer token (or an auth-only header) so the JSON path and the multipart path each compose their own headers:
- JSON verbs → `Authorization` + `Content-Type: application/json` + `Accept`.
- `postMultipart` → `Authorization` + `Accept` **only**.

Node ≥20 provides global `FormData`/`Blob`/`fetch` — no new dependencies.

---

## 4. Cross-Cutting Conventions (locked here; propagate to all future domains)

### 4.1 Writes echo the affected resource, concise
- Endpoints returning a **bare slug** (`create`, `import url`, `import html-or-json`) → re-fetch via `GET /api/recipes/{slug}` → return the **concise projection**.
- Endpoints returning the object (`duplicate` → `Recipe-Output`) → project concise directly.
- `update` (untyped 2xx) → re-fetch the recipe → concise.
- `delete` → return a synthesized `{ deleted: <slug> }` confirmation (nothing to re-fetch).
- Bulk/async ops → return a concise summary of what was requested (and the job acknowledgement for 202s).

### 4.2 `confirm: true` — required and handler-enforced
Every destructive action declares `confirm: z.boolean().optional().describe("Must be true to perform this destructive action")`. The **handler** guards: if `confirm` is not `true`, return `{ isError: true }` with a clear message naming the action and how to proceed. This is real server-side gating (defense-in-depth) on top of the read-only switch — `destructiveHint` annotations are UX hints and are **never trusted for security**. A shared `requireConfirmation(confirm)` helper returns the error result or `null`.

### 4.3 Shared recipe projection
Extract `CONCISE_FIELDS` + the `project()` logic from `recipe-get.ts` into `recipes/recipe-projection.ts`, reused by get/create/update/duplicate/import (DRY).

### 4.4 Annotations
`readOnlyHint` on reads (incl. `recipe_parse_ingredients`); `destructiveHint:true` + `confirm` on destructive; `idempotentHint:true` on `recipe_update`; `openWorldHint:true` globally, called out explicitly on `recipe_import`.

---

## 5. File Uploads (decision: server-readable file paths)

MCP tool args are JSON. Binary uploads use a **server-readable file path** argument; the tool layer reads the file into a `Blob`, builds `FormData`, and calls `postMultipart`. Also ship `recipe_image` set-by-URL (`POST {slug}/image`, JSON — Mealie fetches the image; no file handling) for the common case.

- **Documented limitation:** file-path uploads require the MCP server's local filesystem, so they work under **stdio/local** but not **remote/http**. Documented in the README and tool descriptions.
- **Testability:** the registered tool callback reads the path → `Blob`; the **handler** receives the `Blob` + metadata and builds `FormData`. Tests pass a `Blob` directly to the handler (no filesystem, no network). The file-read at the registration boundary is thin I/O (not unit-tested per the testing rules).

---

## 6. Read-Only Switch

- `config.ts`: add `MEALIE_READ_ONLY`, parsed by a **safe** env-boolean helper (a named set of truthy strings such as `true`/`1`/`yes`/`on`; everything else, including `"false"` and `""`, is `false`). **Do not** use `z.coerce.boolean()` — it coerces the string `"false"` to `true`. Default `false`.
- `createServer(client, { readOnly })` threads the flag. Each `register<Domain>Tools(server, client, { readOnly })` registers reads unconditionally and writes only when `!readOnly`. Within `recipes/`, the subdir `index.ts` files expose separate read/write register functions and `recipes/index.ts` applies the split.

---

## 7. `recipe_import` Safety (settled by research)

**Finding (primary sources):** the Mealie **backend** performs the actual fetch of the user-supplied recipe URL — `safe_scrape_html` builds an `httpx.AsyncClient(transport=AsyncSafeTransport(...), follow_redirects=True)` and Mealie runs `recipe_scrapers` over the result. The API caller (this MCP server) only POSTs `{url, includeTags, includeCategories}` as JSON; it never resolves or fetches the URL. **The SSRF surface lives entirely in Mealie.**

**Mealie's mitigation:** `mealie/pkgs/safehttp/transport.py` `AsyncSafeTransport` resolves the host and raises `InvalidDomainError` when the IP `is_private` (RFC1918 / loopback / link-local), re-checking on each redirect hop. This was the fix for **CVE-2024-31991..31994** (SSRF/DoS in the recipe and image URL importers), shipped in **Mealie 1.4.0**.

**MCP-layer policy — thin pass-through:**
- Validate the input shape with zod: require a syntactically valid `http`/`https` URL string — **lexical only, no DNS/IP resolution**.
- **Never** fetch, resolve, HEAD-check, or IP-inspect the URL inside the MCP process. Doing so to "vet" it *is* the SSRF vulnerability and would create an egress surface where none exists today (the only outbound target is the configured `MEALIE_URL`). This invariant is the primary control the MCP layer actually owns.
- `openWorldHint:true`; gated by the read-only switch (mutating). Surface Mealie's `InvalidDomainError`/4xx verbatim via `{ isError: true }` — never swallow it.
- **Document the Mealie ≥1.4.0 expectation** (README + this doc): the SSRF guarantee lives upstream and cannot be compensated for in-process. Mealie's check is also not airtight (TOCTOU/DNS-rebinding window, CGNAT/IPv6 edge cases) — do not advertise it as such; it is Mealie's to own.

**Anti-patterns to avoid:** reimplementing a private-IP blocklist (redundant + same residual gaps, can't stop Mealie connecting); client-side URL pre-fetch/validation; an allowlist that does DNS/IP resolution.

**Deferred (YAGNI):** an optional operator-configured `MEALIE_MCP_IMPORT_HOST_ALLOWLIST` env var — defensible only as a **lexical** abuse/scope limiter (not SSRF protection, since redirects can leave the allowlisted host server-side). Noted as a possible future knob; not built in PR #3.

---

## 8. File Organization

The `src/tools/recipes/` directory hits the 20-source-file cap (3 existing + 21 new = 24), so it is subdivided by feature (each subdir well under the cap), one tool per file + colocated tests, each with an `index.ts` exposing read/write register functions:

- `recipes/core/` — search, get, create, update, delete, update-many, duplicate, mark-made, suggestions (shipped `recipe-search`/`recipe-get` **move here**; `recipe-projection.ts` lives here or one level up).
- `recipes/import/` — import, parse-ingredients.
- `recipes/images/` — image, assets, media.
- `recipes/batch/` — bulk-actions, export (read), export-run.
- `recipes/social/` — comments, comment-write, timeline, timeline-write, share, share-write.

`recipes/index.ts` composes the subdir register functions and applies the read/write split. Shared write helpers (`requireConfirmation`, projection) live at the nearest common ancestor; imports flow downward only.

---

## 9. Testing

- **`MealieClient.test.ts`** (new): stub global `fetch` (not a network call) — assert each verb builds the correct URL/body/headers and throws `MealieApiError` on non-2xx, and that `postMultipart` sends **no** `Content-Type` and forwards the `FormData` intact (guards the §3.1 pitfall).
- **Each handler**: hand-written fakes with generic methods typed `async <T>(): Promise<T>` (strict TS) — cover path/body mapping, dispatcher action routing, the **confirm gate** (missing → `isError`; present → proceeds), **bare-slug re-fetch**, concise projection, and `isError` on client throw.
- **Read-only e2e**: spin up the real MCP SDK client over stdio with `MEALIE_READ_ONLY=true` and assert the 14 write tools are **absent** while reads remain (and the inverse without the flag). This is verified end-to-end, not only unit-mocked.
- **Quality gate at every checkpoint:** `npm run build && npm run typecheck && npm run test && npm run lint` — confirm exit code 0 (empty lint output ≠ pass).

---

## 10. Process

- Branch `feature/recipe-write-tools` off `develop`; **draft** PR into `develop`.
- Large PR (~46 files) by the explicit "finish the domain in one PR" decision. Built foundation-first via TDD: `MealieClient` verbs + multipart → `config` read-only + `requireConfirmation` + projection helpers + registration plumbing → tool groups (core → import → images → batch → social), each behind the quality gate.
- An adversarial multi-lens code-review pass before hand-off for human review.

---

## 11. Sources
- Research workflow (3 agents, adversarially structured) against primary sources:
  - Mealie source: `pkgs/safehttp/transport.py` (`AsyncSafeTransport`), `services/scraper/scraper_strategies.py` (`safe_scrape_html`), `services/recipe/recipe_data_service.py` (`scrape_image`), `routes/recipe/recipe_crud_routes.py`.
  - [GHSL-2023-225/226 — CVE-2024-31991..31994](https://securitylab.github.com/advisories/GHSL-2023-225_GHSL-2023-226_Mealie/) (SSRF/DoS; fixed Mealie 1.4.0).
  - `https://demo.mealie.io/openapi.json` and the committed `src/types/mealie.ts` (endpoint inventory + request/response schemas).
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1, §3.2.
