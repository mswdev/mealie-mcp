# App Close-out Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Execution mode (overrides the writing-plans handoff menu):** build **sequentially in the main loop** (shared `index.ts`/`server.ts`/`server.test.ts` edits make subagent parallelism unsafe). No worktree; work on branch `feature/app-closeout` (already created off `develop`).

**Goal:** Add the `app` toolset — `app_get_info` (aggregated about/startup-info/theme, replacing `get_about`) + `app_download_file` (token→URL) — completing the default-enabled tool surface.

**Architecture:** New `src/tools/app/` dir. `app_get_info` migrates `about.ts`, returns `about` always and bundles `startup_info`/`theme` via an `include` array, using the generic `get<T>`. `app_download_file` builds a download URL from `client.baseUrl` (no bytes). The redundant `MealieClient.getAbout()` is removed.

**Tech Stack:** TypeScript (strict), `@modelcontextprotocol/sdk`, zod, Vitest (hand-written fakes), Biome.

**Design:** [`2026-06-02-app-closeout-design.md`](./2026-06-02-app-closeout-design.md).

---

## Conventions (every task)

- **Gate before each commit:** `npm run build && npm run typecheck && npm run test && npm run lint` (exit 0; empty lint output). Auto-fix order with `npx biome check --write src/`.
- `.js` import extensions (ESM). Pattern source: `src/tools/result.ts`, `src/tools/cookbooks/cookbook-get.ts`, the existing `src/tools/about.ts`.
- Tools never throw → `errorResult` on failure.

---

### Task 1: `app_get_info` (migrate `about` + aggregate)

**Files:** Create `src/tools/app/app-get-info.ts` + `app-get-info.test.ts`. (Old `src/tools/about.{ts,test.ts}` stay until Task 3.)

**Implementation** (`app-get-info.ts`):
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { AppAbout, MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

type AppStartupInfo = components["schemas"]["AppStartupInfo"];
type AppTheme = components["schemas"]["AppTheme"];
/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

/** Optional secondary sections bundled into the about response. */
const SECTIONS = ["startup_info", "theme"] as const;

const inputSchema = {
  include: z
    .array(z.enum(SECTIONS))
    .optional()
    .describe("Extra sections to bundle alongside about: startup_info, theme"),
};

type GetArgs = { include?: ("startup_info" | "theme")[] | undefined };

/**
 * Handles app_get_info: returns the Mealie instance's about info, optionally
 * bundling startup-info and/or theme (aggregated-read).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (optional include sections)
 * @returns An MCP result with { about, startup_info?, theme? }, or an error result
 */
export async function appGetInfoHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const include = new Set(args.include ?? []);
    const result: Record<string, unknown> = {
      about: await client.get<AppAbout>("/api/app/about"),
    };
    if (include.has("startup_info")) {
      result.startup_info = await client.get<AppStartupInfo>("/api/app/about/startup-info");
    }
    if (include.has("theme")) {
      result.theme = await client.get<AppTheme>("/api/app/about/theme");
    }
    return jsonResult(result);
  } catch (error) {
    return errorResult(error, "app_get_info", "Failed to get Mealie info");
  }
}

/**
 * Registers the app_get_info tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAppGetInfo(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "app_get_info",
    {
      title: "Get Mealie Info",
      description:
        "Returns the connected Mealie instance's info: version, configuration, and feature flags. Pass include: [startup_info, theme] to also bundle startup diagnostics and the UI theme.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => appGetInfoHandler(client, args),
  );
}
```

**Test** (`app-get-info.test.ts`): fake `get` records paths and returns a tagged object per path.
```ts
import { describe, expect, it } from "vitest";
import { appGetInfoHandler } from "./app-get-info.js";

function fakeClient(paths: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      if (path.endsWith("/startup-info")) return { isFirstLogin: false } as T;
      if (path.endsWith("/theme")) return { lightPrimary: "#fff" } as T;
      return { production: true, version: "v1.12.0" } as T;
    },
  };
}

describe("appGetInfoHandler", () => {
  it("returns about only when no include is given", async () => {
    const paths: string[] = [];
    const result = await appGetInfoHandler(fakeClient(paths), {});
    expect(paths).toEqual(["/api/app/about"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.about).toMatchObject({ version: "v1.12.0" });
    expect(body.startup_info).toBeUndefined();
    expect(body.theme).toBeUndefined();
  });

  it("bundles startup_info and theme when included", async () => {
    const paths: string[] = [];
    const result = await appGetInfoHandler(fakeClient(paths), {
      include: ["startup_info", "theme"],
    });
    expect(paths).toEqual([
      "/api/app/about",
      "/api/app/about/startup-info",
      "/api/app/about/theme",
    ]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.startup_info).toBeDefined();
    expect(body.theme).toBeDefined();
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("connection refused");
      },
    };
    const result = await appGetInfoHandler(client, {});
    expect(result.isError).toBe(true);
  });
});
```
Run `npx vitest run src/tools/app/app-get-info.test.ts` (PASS). Gate. Commit: `feat(app): add app_get_info (aggregated about/startup-info/theme)`.

---

### Task 2: `app_download_file` (token → URL)

**Files:** Create `src/tools/app/app-download-file.ts` + `.test.ts`.

**Implementation:**
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DownloadClient = Pick<MealieClient, "baseUrl">;

const inputSchema = {
  token: z.string().min(1).describe("Signed download token (e.g. from a backup/export tool)"),
};

type DownloadArgs = { token: string };

/**
 * Handles app_download_file: resolves a signed token to the Mealie file-download
 * URL. Returns a reference URL (never the bytes), per the media-as-URLs convention.
 *
 * @param client - A MealieClient (or compatible fake exposing baseUrl)
 * @param args - Validated arguments (token)
 * @returns An MCP result with the download URL
 */
export function appDownloadFileHandler(client: DownloadClient, args: DownloadArgs): CallToolResult {
  const url = `${client.baseUrl}/api/utils/download?token=${encodeURIComponent(args.token)}`;
  return jsonResult({ url });
}

/**
 * Registers the app_download_file tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAppDownloadFile(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "app_download_file",
    {
      title: "Resolve Download URL",
      description:
        "Resolves a signed download token to the Mealie file-download URL (e.g. for backups/exports). Returns a URL reference, not the file bytes.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => appDownloadFileHandler(client, args),
  );
}
```
> `appDownloadFileHandler` is synchronous (pure URL build, nothing to await/throw) — return the `CallToolResult` directly; the SDK accepts sync handlers.

**Test:**
```ts
import { describe, expect, it } from "vitest";
import { appDownloadFileHandler } from "./app-download-file.js";

describe("appDownloadFileHandler", () => {
  it("builds the download URL from baseUrl + token", () => {
    const result = appDownloadFileHandler({ baseUrl: "https://m.test" }, { token: "abc123" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ url: "https://m.test/api/utils/download?token=abc123" });
  });

  it("url-encodes the token", () => {
    const result = appDownloadFileHandler({ baseUrl: "https://m.test" }, { token: "a/b+c=" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.url).toBe("https://m.test/api/utils/download?token=a%2Fb%2Bc%3D");
  });
});
```
Run, gate, commit: `feat(app): add app_download_file (token → download URL)`.

---

### Task 3: Wire `registerAppTools`, retire `get_about`, bump e2e

**Files:**
- Create `src/tools/app/index.ts`
- Modify `src/server.ts` (swap `registerAboutTools` → `registerAppTools`)
- Modify `src/client/MealieClient.ts` (remove `getAbout()` method, lines ~202-210; keep the `AppAbout` type export)
- Delete `src/tools/about.ts` + `src/tools/about.test.ts`
- Modify `src/server.test.ts` (rename `get_about` → `app_get_info`, add tools, bump counts)

**index.ts:**
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerAppDownloadFile } from "./app-download-file.js";
import { registerAppGetInfo } from "./app-get-info.js";

/**
 * Registers the app toolset (instance info + file-download URL resolver).
 * Both tools are reads — there is no read-only split.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerAppTools(server: McpServer, client: MealieClient): void {
  registerAppGetInfo(server, client);
  registerAppDownloadFile(server, client);
}
```

**server.ts:** replace the about import/call:
```ts
import { registerAppTools } from "./tools/app/index.js";   // was: ./tools/about.js
// ...
registerAppTools(server, client);                           // was: registerAboutTools(server, client);
```

**MealieClient.ts:** delete the `getAbout()` method (the `AppAbout` type at the top stays — `app_get_info` imports it).

**Delete** `src/tools/about.ts` and `src/tools/about.test.ts` (`git rm`).

**server.test.ts:** the read-only test currently expects `get_about` present + length 25; full length 65. Changes:
- In `READ_TOOLS`, add `app_get_info` and `app_download_file` (these now appear in both lists). Remove any `get_about` reference.
- Read-only assertion: `25` → **`26`**; comment "get_about + 24 reads" → "26 reads (incl. app_get_info + app_download_file)".
- Full assertion: `65` → **`66`**.

Run full gate. Confirm `npx vitest run src/server.test.ts` PASS (26/66). Commit: `feat(app): wire app toolset, retire get_about (e2e 26/66)`.

---

### Task 4: Real-stdio check + README

**Step 1 — stdio smoke (throwaway, not committed):** build, then via the SDK stdio client (MEALIE_URL=https://demo.mealie.io, dummy token): list tools full (66) vs `MEALIE_READ_ONLY=1` (26); call `app_get_info` (expect 200 — demo `/about` is public) and `app_get_info` with `include:[startup_info,theme]`; call `app_download_file` (expect a URL string). Delete the script after.

**Step 2 — README:** in the tool sections, replace the `get_about` mention with the new `## App Tools` section: `app_get_info` (about; `include: [startup_info, theme]`) + `app_download_file` (token → download URL). Note the app domain completes the default surface. Commit: `docs(readme): document app tools (app_get_info, app_download_file)`.

---

## PHASE E — review + PR

- **Adversarial review workflow** (scaled ~3 lenses: contract/correctness, conventions+strict-TS/biome, test-quality) over the diff vs develop; fix confirmed findings; re-gate. Then a `superpowers:code-reviewer` pass.
- **Draft PR** `feature/app-closeout` → `develop`: scope (2 tools, completes default surface), the `get_about` → `app_get_info` rename (breaking, pre-1.0), e2e 25/65 → 26/66. Note: `app_get_info` is live-tested against demo (no owed-write gap — app domain is read-only).

---

## Done when
- `src/tools/app/` has `app_get_info` + `app_download_file` (tested); `about.ts` gone; `getAbout()` removed.
- `server.test.ts` green at **26 read-only / 66 full**.
- Full gate exit 0; real-stdio check documented; draft PR open into `develop`.
