# Live Verification Pass — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Design: `docs/plans/2026-06-15-live-verification-design.md` (approved 2026-06-15).

**Goal:** Pay every "OWED real-instance testing" note from PRs #2–#11 by running the owed checklist live against a disposable local Mealie (`v3.19.2`), driven through the real stdio MCP server, via a committed repeatable harness (`npm run verify:live`) — and TDD-fix any bug found.

**Architecture:** A tsx orchestrator (`scripts/verify-live/`) that (1) `docker compose up --wait` a throwaway Mealie pinned to a fixed local port, (2) bootstraps an API token + public-explore prefs via REST, (3) spawns the built `dist/index.js` as a stdio MCP subprocess with all toolsets + writes enabled, (4) runs assertion-shaped checks (non-destructive → explore → destructive-last), (5) writes a Markdown report, (6) `docker compose down -v` in `finally`. A check passes only if it would FAIL with its guarded bug present (re-fetch + assert survival, not "got 200").

**Tech Stack:** TypeScript (tsx, no build step for the harness), `@modelcontextprotocol/sdk` client + StdioClientTransport, Docker Compose v2, vitest (drift-guard + any bug-fix unit tests), Biome.

**Load-bearing facts (research-verified 2026-06-15, see design §1):**
- Image `ghcr.io/mealie-recipes/mealie:v3.19.2`; API on container `9000`; healthcheck built-in (`/api/app/about`).
- Default admin `changeme@example.com` / `MyPassword`; **no API forced-password-change**; seeds only on zero-user DB (fresh volume).
- Mint: `POST /api/auth/token` (form `username`+`password`) → `{access_token}`; then `POST /api/users/api-tokens` (JSON `{name}`) → `{token}` once; delete `DELETE /api/users/api-tokens/{int id}` → `{tokenDelete}`.
- **Public explore = 3 tiers**: `PUT /api/groups/preferences {privateGroup:false}` + `PUT /api/households/preferences {privateHousehold:false, recipePublic:true}` + per-recipe `settings.public:true`. **Ordering trap:** `recipePublic` only defaults `settings.public` at recipe *creation* — set prefs BEFORE creating, else `200`+empty (not 404). 404 identical for private vs nonexistent.

**Quality gate before EVERY commit:** `npm run build && npm run typecheck && npm run test && npm run lint`. (The harness is excluded from the gate — it needs Docker; but `tsc --noEmit` must still pass on it, so the harness is strict-TS clean.)

**Safety:** the orchestrator hardcodes its target to `127.0.0.1:9925` (its own compose project) — it never reads an ambient `MEALIE_URL`, so it cannot hit a real instance. Teardown is unconditional.

---

## Phase A — Harness scaffolding

### Task A1: `docker-compose.yml` (throwaway Mealie)

**Files:** Create `docker-compose.yml` (repo root).

**Step 1: Write the compose file**

```yaml
# Disposable local Mealie for live verification (PR #12). NOT for production.
# Pinned, SQLite, ephemeral (no named volume), bound to localhost on a non-standard port.
# Teardown wipes everything:  docker compose down -v
services:
  mealie:
    image: ghcr.io/mealie-recipes/mealie:v3.19.2
    container_name: mealie-verify-live
    restart: "no"
    ports:
      - "127.0.0.1:9925:9000" # host 127.0.0.1:9925 -> container API_PORT 9000 (do NOT change container side)
    environment:
      ALLOW_SIGNUP: "true" # enables user_register live-test (still needs a group invite token)
      BASE_URL: "http://localhost:9925"
      TZ: "UTC"
      LOG_LEVEL: "info"
    # No volumes: -> image's VOLUME /app/data uses an auto-created anonymous volume; down -v wipes it -> fresh DB re-seeds the default admin.
    # The image ships a HEALTHCHECK (probes 127.0.0.1:9000/api/app/about) -> `up --wait` works out of the box.
```

**Step 2: Smoke it manually (one-off, not committed as a step)**

Run: `docker compose up -d --wait && curl -fsS http://127.0.0.1:9925/api/app/about | head -c 200; docker compose down -v`
Expected: JSON with `"version"` and `"production":true`; teardown removes the container + anonymous volume.

**Step 3: Commit** — `git add docker-compose.yml && git commit -m "test(verify-live): disposable Mealie v3.19.2 compose (sqlite, ephemeral, localhost:9925)"`

---

### Task A2: harness constants + `package.json` script

**Files:** Create `scripts/verify-live/config.ts`; modify `package.json` (scripts).

**Step 1: `scripts/verify-live/config.ts`** (the single source of the hardcoded, un-overridable target — the safety boundary)

```typescript
/** Live-verification harness constants. The target is HARDCODED — never read from
 *  the ambient environment — so the harness can only ever hit its own throwaway. */
export const HOST_PORT = 9925;
export const MEALIE_URL = `http://127.0.0.1:${HOST_PORT}`;
export const COMPOSE_PROJECT = "mealie-verify-live";
export const PINNED_IMAGE_TAG = "v3.19.2";
export const DEFAULT_ADMIN = { username: "changeme@example.com", password: "MyPassword" } as const;
export const TOKEN_NAME = "verify-live";
/** Built entrypoint the MCP stdio subprocess runs (we test dist/, not source). */
export const SERVER_ENTRY = "dist/index.js";
/** Where the report is written. */
export const REPORT_PATH = "docs/plans/2026-06-15-live-verification-report.md";
```

**Step 2: add the npm script** — in `package.json` `scripts`, after `generate`:

```json
    "verify:live": "tsx scripts/verify-live/index.ts",
```

**Step 3: Commit** — `git add scripts/verify-live/config.ts package.json && git commit -m "test(verify-live): harness config + verify:live script"`

---

### Task A3: Docker lifecycle module

**Files:** Create `scripts/verify-live/docker.ts`.

Full code (uses `node:child_process` `execFileSync`; small functions, one responsibility each):

```typescript
import { execFileSync } from "node:child_process";
import { MEALIE_URL, PINNED_IMAGE_TAG } from "./config.js";

/** Runs `docker compose <args>` synchronously, inheriting stdio for visibility. */
function compose(args: string[]): void {
  execFileSync("docker", ["compose", ...args], { stdio: "inherit" });
}

/** Brings up the throwaway Mealie and blocks until the container is healthy. */
export function up(): void {
  compose(["up", "-d", "--wait"]);
}

/** Tears down the container AND its anonymous volume (unconditional disposability). */
export function down(): void {
  compose(["down", "-v"]);
}

/** Reads the actual running version from /api/app/about (tags can mismatch internal version). */
export async function runningVersion(): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/app/about`);
  const body = (await res.json()) as { version?: string };
  return body.version ?? "unknown";
}

/** Logs the pinned tag vs the actual running version so report can record both. */
export async function reportVersion(): Promise<{ pinnedTag: string; runningVersion: string }> {
  return { pinnedTag: PINNED_IMAGE_TAG, runningVersion: await runningVersion() };
}
```

**Commit** — `git add scripts/verify-live/docker.ts && git commit -m "test(verify-live): docker lifecycle (up --wait / down -v / version probe)"`

---

### Task A4: Mealie REST bootstrap module

**Files:** Create `scripts/verify-live/mealie-rest.ts`.

Handles ONLY pure setup with no MCP-tool equivalent: mint the first token (chicken-and-egg before the MCP client connects), and flip the public-explore prefs. Everything else is dogfooded through MCP.

```typescript
import { DEFAULT_ADMIN, MEALIE_URL, TOKEN_NAME } from "./config.js";

/** Logs in with the default admin and returns a short-lived bearer access token. */
export async function login(): Promise<string> {
  const form = new URLSearchParams({
    username: DEFAULT_ADMIN.username,
    password: DEFAULT_ADMIN.password,
  });
  const res = await fetch(`${MEALIE_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Mints a long-lived API token (the value the MCP server runs with). */
export async function mintApiToken(bearer: string): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/users/api-tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: TOKEN_NAME }),
  });
  if (!res.ok) throw new Error(`token mint failed: HTTP ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** PUTs a preferences body to a group/household self-service endpoint. */
async function putPreferences(bearer: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${MEALIE_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: HTTP ${res.status}`);
}

/** Makes the caller's group+household publicly explorable (3-tier; recipe flag set per-recipe later). */
export async function makeExplorable(bearer: string): Promise<void> {
  await putPreferences(bearer, "/api/groups/preferences", { privateGroup: false });
  await putPreferences(bearer, "/api/households/preferences", {
    privateHousehold: false,
    recipePublic: true,
  });
}

/** Flips the group back to private (to confirm the explore 404 path). */
export async function makePrivate(bearer: string): Promise<void> {
  await putPreferences(bearer, "/api/groups/preferences", { privateGroup: true });
}

/** Reads the caller's group slug (the explore group_slug; no public discovery endpoint exists). */
export async function groupSlug(bearer: string): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/groups/self`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const body = (await res.json()) as { slug: string };
  return body.slug;
}
```

**Commit** — `git add scripts/verify-live/mealie-rest.ts && git commit -m "test(verify-live): REST bootstrap (token mint + 3-tier public-explore prefs + slug)"`

---

### Task A5: MCP stdio client wrapper

**Files:** Create `scripts/verify-live/mcp.ts`.

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MEALIE_URL, SERVER_ENTRY } from "./config.js";

/** All opt-in toolsets, so one client can reach every tool under test. */
const ALL_TOOLSETS = "households,automation,groups,users,admin,explore";

/** A normalized tool-call outcome the checks assert against. */
export type ToolOutcome = { isError: boolean; text: string; json: unknown };

/** A connected MCP client over a real stdio subprocess pointed at the throwaway. */
export type McpHandle = {
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  listToolNames(): Promise<string[]>;
  close(): Promise<void>;
};

/** Spawns dist/index.js as a stdio MCP server and returns a connected client. */
export async function connect(token: string, extraEnv: Record<string, string> = {}): Promise<McpHandle> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      MEALIE_URL,
      MEALIE_API_TOKEN: token,
      MEALIE_TOOLSETS: ALL_TOOLSETS,
      ...extraEnv,
    },
  });
  const client = new Client({ name: "verify-live", version: "0" });
  await client.connect(transport);
  return {
    async call(name, args) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find((c) => c.type === "text")?.text ?? "";
      let json: unknown = undefined;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined; // error results carry plain prose, not JSON
      }
      return { isError: result.isError === true, text, json };
    },
    async listToolNames() {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name);
    },
    async close() {
      await client.close();
    },
  };
}
```

**Commit** — `git add scripts/verify-live/mcp.ts && git commit -m "test(verify-live): stdio MCP client wrapper (dist/, all toolsets, normalized outcome)"`

---

### Task A6: Assertion + check-registry module

**Files:** Create `scripts/verify-live/assert.ts`.

The check registry collects `{id, owedPr, title, status, detail}` so the report is generated from data, and **a thrown assertion is a FAIL, never an uncaught crash** that loses prior results.

```typescript
/** One verification check's outcome for the report. */
export type CheckResult = {
  id: string;
  owedPr: string;
  title: string;
  status: "pass" | "fail" | "diverge" | "skip";
  detail: string; // human note + the actual response snippet (the evidence)
};

const results: CheckResult[] = [];

/** Returns all collected results (for the report writer). */
export function allResults(): CheckResult[] {
  return results;
}

/** Throws when the condition is false — caught by runCheck and recorded as a FAIL. */
export function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Truncates a value to a short evidence snippet for the report. */
export function snippet(value: unknown, max = 600): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Runs one check; records pass/fail/diverge and never throws out of the suite. */
export async function runCheck(
  meta: { id: string; owedPr: string; title: string },
  body: () => Promise<string>,
): Promise<void> {
  try {
    const detail = await body();
    results.push({ ...meta, status: "pass", detail });
    process.stdout.write(`  ✓ ${meta.id} ${meta.title}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("DIVERGE:") ? "diverge" : "fail";
    results.push({ ...meta, status, detail: message });
    process.stdout.write(`  ✗ ${meta.id} ${meta.title} — ${message}\n`);
  }
}

/** Records a deliberately skipped check (e.g. no SMTP) with a reason. */
export function recordSkip(meta: { id: string; owedPr: string; title: string }, reason: string): void {
  results.push({ ...meta, status: "skip", detail: reason });
}
```

**Commit** — `git add scripts/verify-live/assert.ts && git commit -m "test(verify-live): check registry + assertion helpers (fail-not-crash, evidence snippets)"`

---

### Task A7: Report writer (skeleton-first)

**Files:** Create `scripts/verify-live/report.ts`.

Writes the skeleton up front (durable against mid-run death), then fills it from `allResults()`.

```typescript
import { writeFileSync } from "node:fs";
import { REPORT_PATH } from "./config.js";
import { type CheckResult, allResults } from "./assert.js";

const ICON = { pass: "✅", fail: "❌", diverge: "⚠️", skip: "⏭️" } as const;

/** Writes the report header + a placeholder, before any check runs. */
export function writeSkeleton(): void {
  const header = [
    "# PR #12 — Live Verification Report",
    "",
    "> Generated by `npm run verify:live` against a disposable Mealie. Re-run before every release.",
    "",
    "_Run in progress — results will be filled in on completion._",
    "",
  ].join("\n");
  writeFileSync(REPORT_PATH, header);
}

/** Renders one result row. */
function row(r: CheckResult): string {
  return `| ${ICON[r.status]} | ${r.id} | ${r.owedPr} | ${r.title} | ${r.detail.replace(/\n/g, " ")} |`;
}

/** Writes the final report from collected results + run metadata. */
export function writeReport(meta: { pinnedTag: string; runningVersion: string; specParity: string }): void {
  const rows = allResults();
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# PR #12 — Live Verification Report",
    "",
    `**Image:** \`ghcr.io/mealie-recipes/mealie:${meta.pinnedTag}\` · **Running version:** \`${meta.runningVersion}\``,
    `**Spec parity:** ${meta.specParity}`,
    `**Tally:** ${counts.pass ?? 0} pass · ${counts.fail ?? 0} fail · ${counts.diverge ?? 0} diverge · ${counts.skip ?? 0} skip`,
    "",
    "| | ID | Owed PR | Check | Evidence / detail |",
    "|---|---|---|---|---|",
    ...rows.map(row),
    "",
    "## Teardown",
    "",
    "`docker compose down -v` (run automatically in the harness `finally`). The container is disposable — never aimed at a real instance.",
    "",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n"));
}
```

**Commit** — `git add scripts/verify-live/report.ts && git commit -m "test(verify-live): report writer (skeleton-first, evidence table, version + parity)"`

---

### Task A8: Spec-parity preflight

**Files:** Create `scripts/verify-live/preflight.ts`.

Compares the container's live `/openapi.json` operation count against the committed `259`, so a later check failure reads as *real bug* vs *version drift*.

```typescript
import { MEALIE_URL } from "./config.js";

/** Committed types provenance (src/types/mealie.ts): 259 operations. */
const COMMITTED_OP_COUNT = 259;

/** Fetches the container's OpenAPI and counts operations across all paths. */
async function liveOpCount(): Promise<number> {
  const res = await fetch(`${MEALIE_URL}/openapi.json`);
  const spec = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  let count = 0;
  for (const item of Object.values(spec.paths)) {
    for (const method of Object.keys(item)) if (methods.has(method)) count += 1;
  }
  return count;
}

/** Returns a one-line parity verdict for the report header. */
export async function specParity(): Promise<string> {
  const live = await liveOpCount();
  const delta = live - COMMITTED_OP_COUNT;
  if (delta === 0) return `MATCH (live ${live} ops = committed ${COMMITTED_OP_COUNT})`;
  return `SKEW (live ${live} vs committed ${COMMITTED_OP_COUNT}, Δ${delta > 0 ? "+" : ""}${delta}) — interpret check failures with this in mind`;
}
```

**Commit** — `git add scripts/verify-live/preflight.ts && git commit -m "test(verify-live): spec-parity preflight (live openapi op-count vs committed 259)"`

---

## Phase B — The checks (assertion-shaped, owed-driven)

Each check module exports `run(mcp, ctx)` where `ctx` carries the bearer, group slug, and fixture paths. **Every check re-fetches and asserts survival/absence/state-change — never "got 200".** Organize one module per owed area under `scripts/verify-live/checks/`. The worked example below is the template for ALL fetch-merge checks; the remaining checks follow it.

### Task B1: shared check context + fixtures

**Files:** Create `scripts/verify-live/checks/context.ts`; create `scripts/verify-live/fixtures/` with `recipe.jpg` (any small jpeg), `asset.txt`, and a `recipe.zip` will be produced at runtime by `recipe_export`.

```typescript
import type { McpHandle } from "../mcp.js";

/** Shared state threaded through the check modules. */
export type CheckContext = {
  mcp: McpHandle;
  bearer: string;
  groupSlug: string;
  fixturesDir: string; // absolute path to scripts/verify-live/fixtures
  /** Names of throwaway entities created during the run (for the explore/public checks). */
  scratch: Record<string, string>;
};
```

Generate the jpeg fixture deterministically (no binary committed if avoidable) — a 1×1 pixel is fine; commit a tiny real `.jpg` and `.txt`.

**Commit** — `git add scripts/verify-live/checks/context.ts scripts/verify-live/fixtures && git commit -m "test(verify-live): check context + multipart fixtures"`

### Task B2: WORKED EXAMPLE — catalog fetch-merge survival (`food_update`, PR #5)

This is the canonical assertion shape. **Files:** Create `scripts/verify-live/checks/catalog.ts`.

```typescript
import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #5 owed: food_update fetch-merge must preserve aliases/labelId across a rename. */
export async function run(ctx: CheckContext): Promise<void> {
  await runCheck({ id: "C-FOOD-MERGE", owedPr: "#5", title: "food_update preserves aliases across rename" }, async () => {
    // create with a distinctive SECONDARY field (aliases) + a primary (name)
    const created = await ctx.mcp.call("food_create", { name: "VerifyLeek", aliases: ["scallion-ish"] });
    expect(!created.isError, `create failed: ${created.text}`);
    const id = (created.json as { id: string }).id;

    // update ONLY the primary field (rename)
    const renamed = await ctx.mcp.call("food_update", { id, name: "VerifyLeekRenamed" });
    expect(!renamed.isError, `update failed (422?): ${renamed.text}`); // superset-body acceptance proof

    // re-fetch and assert the SECONDARY field survived (the actual bug guard)
    const after = await ctx.mcp.call("food_get", { id, response_format: "detailed" });
    const aliases = (after.json as { aliases?: Array<{ name: string }> }).aliases ?? [];
    expect(aliases.some((a) => a.name === "scallion-ish"), `aliases LOST on rename: ${snippet(after.json)}`);

    return `renamed ok, aliases survived: ${snippet(after.json)}`;
  });
}
```

**Commit** — `git add scripts/verify-live/checks/catalog.ts && git commit -m "test(verify-live): catalog fetch-merge check (food_update aliases survive rename)"`

### Task B3..Bn: the remaining checks (same shape, named owed fields)

Write one `runCheck` per row below, each re-fetching to assert the named behavior. Group into modules: `recipes.ts`, `cooking-loop.ts`, `catalog.ts`, `households-automation.ts`, `groups.ts`, `users.ts`, `admin.ts`, `explore.ts`, `app.ts`. **P0 = the named owed behavior (must assert state); P1 = smoke (call + non-error).**

| ID | Owed PR | Tool(s) | Assertion (would FAIL if bug present) | Shape |
|---|---|---|---|---|
| C-RECIPE-RW | #2 | recipe_search/get | seed a recipe → search returns it; get concise omits ingredients, detailed includes, `include:[nutrition]` adds it | read projection |
| C-RECIPE-CREATE | #3 | recipe_create | create by name → result echoes a full object with a slug (bare-slug re-fetch quirk) | bare-slug |
| C-RECIPE-UPDATE | #3 | recipe_update | create w/ `recipeYield` → update only `name` → re-fetch → `recipeYield` survives; no 422 | fetch-merge + superset |
| C-RECIPE-DELETE | #3 | recipe_delete | `confirm:false`→still fetchable; `confirm:true`→`{deleted}` + 404 on re-fetch | confirm |
| C-RECIPE-IMAGE | #3 | recipe_image | upload fixture jpeg (multipart) → recipe `image` populated on re-fetch | multipart |
| C-RECIPE-ASSET | #3 | recipe_assets | upload fixture asset → asset listed on re-fetch | multipart |
| C-RECIPE-ZIP | #3 | recipe_export→recipe_import | export a recipe to zip → import the zip → new recipe exists | multipart |
| C-RECIPE-IMPORT | #3 | recipe_import | import from html/json source (hermetic) → recipe created | import |
| C-MEALPLAN | #4 | mealplan_create/get/update | create entry (integer id quirk) → update → re-fetch survives untouched fields | fetch-merge + int id |
| C-SHOPLIST-UPDATE | #4 | shopping_list_create/update | create list w/ extra field → update name → re-fetch preserves; Output-variant `listItems` round-trips with no 422 | fetch-merge + superset |
| C-SHOPITEM | #4 | shopping_item_create/update | single + bulk create; update preserves untouched | fetch-merge |
| C-COOKBOOK | #4 | cookbook_create/update | create → rename → re-fetch preserves filter fields | fetch-merge |
| C-ORG-MERGE | #5 | organizer_update | tool create w/ `householdsWithTool` → rename → survives | fetch-merge |
| C-ORG-EMPTY | #5 | organizer_search | `empty_only` on a category returns the un-enveloped list | branch |
| C-UNIT-MERGE | #5 | unit_update / unit_merge | unit rename preserves `standardQuantity`; `unit_merge` confirm repoints + removes source | fetch-merge + merge |
| C-FOOD-MERGE | #5 | food_update | (worked example B2) | fetch-merge |
| C-FOOD-DELETE | #5 | food_delete | confirm gate both ways → `{deleted}` + gone | confirm |
| C-HH-PREFS | #7 | household_self_update | flip a pref → re-fetch other prefs survive (fetch-merge) | fetch-merge |
| C-HH-PERMS | #7 | household_self_update target=permissions | elevate a member flag → other flags unchanged (no silent downgrade); unknown member → error | merge + guard |
| C-WEBHOOK | #7 | webhook_write/get | create → update only one field → re-fetch others survive | fetch-merge |
| C-NOTIFY | #7 | event_notification_write | create → update → survives; delete synthesizes `{deleted}` from 204 | fetch-merge + delete-shape |
| C-INVITE | #7 | household_invite | create invite → `EmailInitationResponse` typo field present; bare `ReadInviteToken[]` list reads | shape |
| C-GROUP-SELF | #8 | group_self_update | update prefs → re-fetch; read-only `groupId`/`id` not corrupted | fetch-merge |
| C-LABEL | #8 | label_write/get | create → rename → re-fetch 4-field object intact | fetch-merge |
| C-AIPROVIDER | #8 | group_ai_provider_write + settings_update | create w/ apiKey → update w/ re-supply → apiKey absent from every read; settings 3 pointers preserved | secret + fetch-merge |
| C-REPORT | #8 | group_report_get/delete | bare-array list reads; delete synthesizes `{deleted}` | shape |
| C-SEED | #8 | group_seed | seed foods → `SuccessResponse error:false` → maps to non-error; (force error→isError if feasible) | error-on-200 |
| C-MIGRATION | #8 | group_start_migration | upload a migration archive (multipart) confirm-gated → report id echoed | multipart |
| C-USER-ME | #9 | user_me | profile view keeps the `tokens` list (only enumeration) | read |
| C-USER-UPDATE | #9 | user_self_update | update one whitelisted field → others survive; UserOut-only keys not sent (no 422) | fetch-merge |
| C-USER-TOKEN | #9 | user_api_token_write | create → raw `token` present once → re-read via user_me → token value absent; delete (int id) confirm | shown-once + confirm |
| C-USER-RATINGS | #9 | user_ratings_write | rate/favorite → user_me favorites reflects it | round-trip |
| C-USER-PW | #9 | user_password_write | wrong current pw → 422 → result surfaces **status only**, no secret leak (secretSafeErrorResult) | secret-safe |
| C-USER-REG | #9 | user_register | with a group invite token → account created; OR signup-disabled → clean failure | public |
| C-AVATAR | #9 | user_avatar_upload | upload fixture (FormData field `profile`) → no error | multipart |
| C-ADMIN-RW | #10 | admin_user/household/group_write | create throwaway → update → re-fetch survives; `cacheKey` redacted from output | fetch-merge + redact |
| C-ADMIN-ABOUT | #10 | admin_about | `include:statistics` works; `dbUrl` redacted | redact |
| C-ADMIN-ACTIONS | #10 | admin_user_actions | `password_reset_token` shown once; secretSafeError on bad input | shown-once + secret-safe |
| C-ADMIN-AIKEY | #10 | admin_ai_provider_write | apiKey re-supply; never echoed | secret |
| C-EXPLORE-LIST | #11 | explore_list | after public prefs, list cookbooks/categories/foods/households by `type`; foods are `{id,name,labelId}` | public read |
| C-EXPLORE-RECIPE | #11 | explore_recipe_search/get/suggestions | public recipe (settings.public set) appears; get concise/detailed; suggestions | public read |
| C-EXPLORE-404 | #11 | explore_recipe_search | flip group private → identical 404; nonexistent slug → identical 404 | 404-ambiguity |
| C-EXPLORE-HH-GUARD | #11 | explore_list type=household + search | rejected client-side ("not supported") | guard |

**Destructive admin (Phase B-LAST, sequenced after everything else):**

| ID | Owed PR | Tool(s) | Assertion | Shape |
|---|---|---|---|---|
| C-BACKUP-RESTORE | #10 | admin_backup_write + admin_backup_restore | create marker recipe → backup → delete marker → restore (double-gate `confirm`+`confirm_file_name`) → marker returns | restore-moves-state |
| C-BACKUP-DELETE | #10 | admin_backup_write(delete) | delete a backup → gone from list | confirm |
| C-MAINT-CLEAN | #10 | admin_maintenance_clean | clean temp → `SuccessResponse` maps to non-error | error-on-200 |
| C-EMAIL-TEST | #10 | admin_email_test | no SMTP → `EmailSuccess{success:false}` → handler returns **isError** | error-on-200 (skip-success) |
| C-DEBUG-OPENAI | #10 | admin_debug_openai | no provider/key → clean failure path (isError, no crash) | clean-failure |

Each table row = one `runCheck` task: write it, run `npm run verify:live` against the live container, see it pass (or surface a finding). Commit per module: `git commit -m "test(verify-live): <module> checks"`.

---

## Phase C — Orchestrator entrypoint

### Task C1: `scripts/verify-live/index.ts`

```typescript
import { resolve } from "node:path";
import { allResults } from "./assert.js";
import * as catalog from "./checks/catalog.js";
// ...import every check module...
import type { CheckContext } from "./checks/context.js";
import * as docker from "./docker.js";
import { connect } from "./mcp.js";
import { groupSlug, login, makeExplorable, mintApiToken } from "./mealie-rest.js";
import { specParity } from "./preflight.js";
import { writeReport, writeSkeleton } from "./report.js";

/** Runs the full live-verification pass. Teardown is unconditional. */
async function main(): Promise<void> {
  writeSkeleton();
  docker.up();
  try {
    const version = await docker.reportVersion();
    const parity = await specParity();
    const bearer = await login();
    const token = await mintApiToken(bearer);
    await makeExplorable(bearer);
    const mcp = await connect(token);
    const ctx: CheckContext = {
      mcp, bearer, groupSlug: await groupSlug(bearer),
      fixturesDir: resolve("scripts/verify-live/fixtures"), scratch: {},
    };

    // non-destructive → explore → destructive-last
    await catalog.run(ctx);
    // ...recipes, cooking-loop, households-automation, groups, users, admin(non-destructive), explore...
    // ...admin destructive LAST...

    await mcp.close();
    writeReport({ ...version, specParity: parity });
  } finally {
    docker.down();
  }
  const failed = allResults().filter((r) => r.status === "fail").length;
  process.exitCode = failed > 0 ? 1 : 0;
}

await main();
```

**Step: run the full harness** — `npm run build && npm run verify:live`
Expected: container boots, report written, `docker compose down -v` runs, exit 0 if no FAILs.

**Commit** — `git add scripts/verify-live/index.ts && git commit -m "test(verify-live): orchestrator entrypoint (bootstrap → checks → report → unconditional teardown)"`

---

## Phase D — Live run + findings

### Task D1: Run, triage, record
Run `npm run build && npm run verify:live`. For each result:
- **pass** — evidence captured in the report; done.
- **diverge** — a quirks-ledger fact or a version-skew item: record the divergence as a finding in the report (and in the PR body). NEVER hand-edit `src/types/mealie.ts`; if the spec genuinely moved, regenerate via `npm run generate` and surface the decision.
- **fail** — a real bug → Phase E (TDD fix).

Commit the run's report: `git add docs/plans/2026-06-15-live-verification-report.md && git commit -m "docs(verify-live): live verification report (run 1)"`.

---

## Phase E — Per-finding TDD fix (repeat per FAIL, in the main loop)

For each genuine bug the live run surfaced:

**Step 1: Write a failing unit test** in the relevant `src/tools/.../<tool>.test.ts`, using a hand-written fake that returns the exact real response shape that broke. The test asserts the corrected behavior. (@.claude/rules/testing.md)

**Step 2: Run it, confirm it fails** — `npx vitest run <test file>` → FAIL.

**Step 3: Minimal fix** in the handler. Respect hard limits (@.claude/rules/code-style.md: ≤25 lines/method, ≤2 nesting, ≤3 params, no magic numbers, JSDoc).

**Step 4: Confirm green** — `npx vitest run <test file>` → PASS; then the full gate.

**Step 5: Re-run the live harness** to confirm the fix holds against the real instance.

**Step 6: Commit** — `git commit -m "fix(<domain>): <bug> (found by live verification)"`.

---

## Phase F — Drift-guard test (PR #11 leftover)

### Task F1: cross-import drift-guard
**Files:** Create `src/tools/explore/recipe-concise-drift.test.ts`; modify `.claude/rules/file-organization.md` (document the exemption).

**Step 1: Failing test** — import the concise-field list from both `../recipes/recipe-projection.js` and `./explore-projection.js`; assert explore's list ⊇ the recipe list's shared fields (or exact-match per the design intent — confirm the actual relationship first by reading both).

```typescript
import { describe, expect, it } from "vitest";
// test-only sibling cross-import: see .claude/rules/file-organization.md exemption
import { RECIPE_CONCISE_FIELDS } from "../recipes/recipe-projection.js"; // export if not already
import { EXPLORE_RECIPE_CONCISE_FIELDS } from "./explore-projection.js"; // export if not already

describe("explore recipe concise projection", () => {
  it("stays in sync with the recipes/ concise field list (duplicated by design)", () => {
    expect([...EXPLORE_RECIPE_CONCISE_FIELDS].sort()).toEqual([...RECIPE_CONCISE_FIELDS].sort());
  });
});
```

**Step 2:** Run → it will fail to import until both lists are `export`ed (and reveal any real drift). Export the constants if private; fix any genuine drift found.

**Step 3:** Document the exemption in `.claude/rules/file-organization.md` under Dependency Direction: a **test-only** sibling cross-import is permitted solely to assert duplicated constants stay in sync (no runtime coupling).

**Step 4: Gate + commit** — `git commit -m "test(explore): drift-guard for duplicated recipe concise-field list (test-only cross-import exemption)"`.

---

## Phase G — Doc updates (owner chose: in this PR)

### Task G1: roadmap Status + README live-verified note
**Files:** Modify `docs/plans/2026-05-31-tool-design-and-coverage-roadmap.md:5` (Status header + completion note); modify `README.md`.

- Roadmap: append to the **Status** line that all 259 ops are now live-verified against Mealie `vX.Y.Z` (PR #12), with a one-line note. (§3 is a coverage map — no per-row column to flip.)
- README: add a short "Live-verified against Mealie `vX.Y.Z`" note near the toolset docs, with `npm run verify:live` as the repeatable harness.

**Commit** — `git commit -m "docs: record live verification (roadmap status + README note, Mealie vX.Y.Z)"`.

---

## Phase H — Review + draft PR

### Task H1: Adversarial review workflow
Run a multi-lens adversarial review over the branch diff (lenses: harness correctness + safety boundary; assertion rigor [does each check actually guard its bug?]; hard-limit compliance; doc accuracy; secret-handling in the harness). Fix Majors; fix-or-log Minors.

### Task H2: Draft PR into develop
Push; open **draft PR into `develop`**: title `test: live verification pass — disposable Mealie harness, owed debt paid (PR #12)`. Body: what/why, the harness, the owed-checklist results table (pass/diverge/skip counts), every finding + its fix commit, Mealie version, teardown note. Matt reviews + runs `/requesting-code-review`.
