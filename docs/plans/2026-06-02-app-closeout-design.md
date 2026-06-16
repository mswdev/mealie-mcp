# PR #6 Design — App Close-out

**Date:** 2026-06-02
**Branch:** feature/app-closeout → develop (PR #6)
**Status:** Approved. Small default-enabled domain that **completes the default tool surface** — after this, PRs #7–#11 are the opt-in domains (households/automation, groups, users, admin, explore).

Applies the conventions in [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1 and finishes the **app** row of §3.2. Endpoint shapes verified inline against the committed `src/types/mealie.ts` (only 4 endpoints — no separate inventory workflow warranted).

---

## 1. Scope

The app domain is 4 endpoints (About + Utils), one of which (`GET /api/app/about`) already ships as `get_about` from PR #1. Consolidates to **2 tools**, both read-only (the domain has no writes):

| Endpoint | Tool |
|---|---|
| `GET /api/app/about` (`AppAbout`) | `app_get_info` (default section) |
| `GET /api/app/about/startup-info` (`AppStartupInfo`) | `app_get_info` (`include: startup_info`) |
| `GET /api/app/about/theme` (`AppTheme`) | `app_get_info` (`include: theme`) |
| `GET /api/utils/download?token=` (file) | `app_download_file` |

This brings the registered surface to **26 reads / 66 full** (net **+1 read**: `app_get_info` replaces `get_about`; `app_download_file` is new; zero writes). Coverage of the app domain: 4/4.

---

## 2. Tools (`src/tools/app/`)

### 2.1 `app_get_info` (read, always-on) — replaces `get_about`

Aggregated-read (§1.1): the headline `about` is always returned; the two secondary sections are opt-in so the common call stays light.

- Always `GET /api/app/about` → `AppAbout`.
- `include?: ('startup_info' | 'theme')[]` → additionally `GET /api/app/about/startup-info` (`AppStartupInfo`) and/or `GET /api/app/about/theme` (`AppTheme`).
- Returns `{ about }`, adding `startup_info` / `theme` keys only when requested.
- Uses the **generic `get<T>`** for all three endpoints (typed `AppAbout` / `AppStartupInfo` / `AppTheme`).
- Annotations: `readOnlyHint: true`, `openWorldHint: true`.

### 2.2 `app_download_file` (read, always-on)

- `app_download_file(token)` → `{ url: "<baseUrl>/api/utils/download?token=<token>" }` built from `client.baseUrl`.
- **No network call, no bytes** — a thin reference builder for the signed tokens that export/backup tools emit, consistent with the project rule "media returns URLs/references, never inline base64" (§1.3). Works identically over stdio and http transports.
- `token` is required (a download URL without a token is meaningless), even though the upstream query param is optional.
- Annotations: `readOnlyHint: true`, `openWorldHint: true`.

---

## 3. Migration & cleanup

- Move `src/tools/about.ts` + `src/tools/about.test.ts` → `src/tools/app/app-get-info.ts` + `app-get-info.test.ts`. Add `src/tools/app/app-download-file.ts` (+ test) and `src/tools/app/index.ts` exporting `registerAppTools(server, client)` (no read-only split needed — both tools are reads).
- `createServer`: `registerAboutTools` → `registerAppTools` (import from `./tools/app/index.js`).
- Remove the now-redundant `MealieClient.getAbout()` convenience method **and its test** — `app_get_info` uses the generic `get<T>`, giving one consistent way to fetch. The `AppAbout` type export in `MealieClient.ts` stays (re-used by `app_get_info`).
- No projection helper: the three responses are already small typed config/info objects; they are returned whole (no `response_format`).

File layout (`src/tools/app/`, 3 source files — well under the 20-cap):
```
src/tools/app/   index.ts, app-get-info.ts, app-download-file.ts  (+ colocated .test.ts)
```

---

## 4. Testing

- **`app_get_info`**: about-only (no `include`) → one GET, `{ about }`; `include: ['startup_info']` → second GET, adds `startup_info`; `['theme']` → adds `theme`; both → all three sections; client throw → `isError`.
- **`app_download_file`**: builds the correct `<baseUrl>/api/utils/download?token=<token>` URL; missing token rejected by the zod schema.
- **`server.test.ts`**: replace `get_about` with `app_get_info`; add `app_get_info` + `app_download_file` to `READ_TOOLS`; bump assertions **read-only 25 → 26, full 65 → 66**.
- **Real-stdio subprocess check**: `app_get_info` 200 against `demo.mealie.io`; `app_download_file` returns a URL; full vs read-only counts (66/26). (Demo `/about` is 200, so this read is genuinely live-tested — no owed-testing gap for this domain.)
- **Quality gate** at each commit: `npm run build && npm run typecheck && npm run test && npm run lint` — exit 0.

---

## 5. Process

- Branch `feature/app-closeout` off `develop`; **draft** PR into `develop`.
- Sequential TDD in the main loop (tiny domain): `app_get_info` (migrate + aggregate) → `app_download_file` → wire + bump `server.test.ts` → real-stdio check.
- **No endpoint-inventory workflow** (4 endpoints, verified inline). An **adversarial review** (scaled to ~3 lenses: correctness/contract, conventions/strict-TS, test-quality) runs as a workflow before hand-off, plus a `superpowers:code-reviewer` pass.

---

## 6. Sources
- Conventions: [`2026-05-31-tool-design-and-coverage-roadmap.md`](./2026-05-31-tool-design-and-coverage-roadmap.md) §1, §3.2 (app row), §1.7 (the noted `about.ts → src/tools/app/` migration).
- Endpoint shapes verified against committed `src/types/mealie.ts` (`AppAbout`, `AppStartupInfo`, `AppTheme`; `/api/utils/download?token=`).
