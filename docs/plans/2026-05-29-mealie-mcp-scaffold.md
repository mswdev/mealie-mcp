# Mealie MCP Scaffold Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold the mealie-mcp TypeScript MCP server — project structure, toolchain, agent kit files, type generation, and one proof-of-concept `get_about` tool.

**Architecture:** Standalone TypeScript MCP server distributed via `npx`. Supports stdio (default, for Claude Desktop / Claude Code / Cursor) and HTTP via `StreamableHTTPServerTransport` (for ChatGPT / remote use), selected by `TRANSPORT` env var. Types are generated from Mealie's OpenAPI spec via `openapi-typescript` and committed to the repo.

**Tech Stack:** `@modelcontextprotocol/sdk@^1.29.0`, `zod@^3.25`, `pino@^9`, `openapi-typescript@^7`, `tsup`, `@biomejs/biome`, `vitest`, Node 18+, ESM

---

### Task 1: Create git branches

**Files:** (none — git only)

**Step 1: Create develop branch from main**

```bash
git checkout main
git checkout -b develop
git push -u origin develop
```

**Step 2: Create feature branch from develop**

```bash
git checkout -b feature/scaffold
```

**Step 3: Commit**

No files changed yet — branches are ready.

---

### Task 2: Bring over llm-agent-kit agent config files

**Files:**
- Create: `AGENTS.md`
- Create: `.claude/CLAUDE.md`
- Create: `.claude/rules/code-style.md`
- Create: `.claude/rules/file-organization.md`
- Create: `.claude/rules/security.md`
- Create: `.claude/rules/testing.md`

These files come from `https://github.com/mswdev/llm-agent-kit`. Fetch them via `gh api` and adapt them. The adaptations are described per file below.

**`AGENTS.md`** — fetch from kit verbatim. This is the OpenAI Codex-compatible mirror of CLAUDE.md. Replace the owner/product/repo placeholders.

**`.claude/CLAUDE.md`** — fetch from kit, then apply these changes:
1. Fill in the project header: owner `mswdev`, product `mealie-mcp — a TypeScript MCP server for the Mealie recipe manager`, repo `mealie-mcp (single package, src/ at root)`
2. Remove **Section 6 (Figma-to-Code Workflow)** entirely — not applicable
3. Remove the `@.claude/tailwind-plus-components.md` reference
4. Add an MCP-specific section after Section 5:

```markdown
## 6. MCP Development Rules

- **Tools live in `src/tools/<domain>/`** — one file per domain (e.g. `recipes.ts`, `meal-plans.ts`)
- **All tools are registered via `registerAboutTools(server, client)` pattern** — each tool file exports a `register<Domain>Tools(server, client)` function
- **Tool handlers are exported separately** for testability — `export async function <toolName>Handler(...)` called by the registered handler
- **`pino` logs to stderr only** — NEVER call `console.log` or write to stdout; use `logger.info()`, `logger.error()`, etc.
- **No tool should throw** — return `{ content: [...], isError: true }` on failure instead
- **`MealieClient` methods map 1:1 to Mealie API endpoints** — one method per endpoint, typed with generated OpenAPI types
```

5. Update Section 5 git workflow: branch naming `feature/{short-description}`, PR target is `develop` not `main`.
6. Update Section 4 infrastructure table to reflect this project's services.

**`.claude/rules/code-style.md`** — fetch from kit verbatim. No adaptations needed.

**`.claude/rules/file-organization.md`** — fetch from kit, then change the 10-file directory cap comment:
- Change the hard limit note to: `MAXIMUM 20 source files per directory` (bumped for this project because Mealie has many endpoints per domain)

**`.claude/rules/security.md`** — fetch from kit verbatim.

**`.claude/rules/testing.md`** — fetch from kit verbatim.

**Step 1: Fetch and write all six files** (use `gh api` to get each file's content, base64-decode, adapt as described above, write to disk)

**Step 2: Commit**

```bash
git add AGENTS.md .claude/
git commit -m "feat: add llm-agent-kit agent config files"
```

---

### Task 3: Bring over GitHub Actions files

**Files:**
- Create: `.github/actions/claude-stats/action.yml`
- Create: `.github/prompts/review.md`
- Create: `.github/workflows/claude.yml`
- Create: `.github/workflows/claude-review.yml`

Fetch these from `https://github.com/mswdev/llm-agent-kit` verbatim (no adaptations needed).

**Step 1: Fetch and write all four files**

Use `gh api repos/mswdev/llm-agent-kit/contents/.github/...` for each file.

**Step 2: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions workflows and review automation"
```

---

### Task 4: Create `package.json`

**Files:**
- Create: `package.json`

**Step 1: Write `package.json`**

```json
{
  "name": "mealie-mcp",
  "version": "0.1.0",
  "description": "A full-featured MCP server for the Mealie recipe manager",
  "type": "module",
  "bin": {
    "mealie-mcp": "./dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome format --write .",
    "generate": "tsx scripts/generate-types.ts",
    "prepublishOnly": "npm run build && npm run test && npm run lint"
  },
  "engines": {
    "node": ">=18"
  },
  "keywords": [
    "mealie",
    "mcp",
    "model-context-protocol",
    "recipe-manager",
    "meal-planning"
  ],
  "author": "Matt White <matt@msw.dev>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/mswdev/mealie-mcp"
  },
  "bugs": {
    "url": "https://github.com/mswdev/mealie-mcp/issues"
  },
  "homepage": "https://github.com/mswdev/mealie-mcp#readme",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "pino": "^9.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/node": "^22.0.0",
    "openapi-typescript": "^7.0.0",
    "pino-pretty": "^13.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add package.json"
```

---

### Task 5: Create `tsconfig.json` and `tsup.config.ts`

**Files:**
- Create: `tsconfig.json`
- Create: `tsup.config.ts`

**Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "scripts"]
}
```

**Step 2: Write `tsup.config.ts`**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

**Step 3: Commit**

```bash
git add tsconfig.json tsup.config.ts
git commit -m "feat: add TypeScript and build config"
```

---

### Task 6: Create `biome.json`

**Files:**
- Create: `biome.json`

**Step 1: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "suspicious": {
        "noExplicitAny": "error"
      },
      "style": {
        "useConst": "error",
        "noVar": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "files": {
    "ignore": ["dist", "node_modules", "src/types/mealie.ts"]
  }
}
```

Note: `src/types/mealie.ts` is ignored by biome because it is generated code.

**Step 2: Commit**

```bash
git add biome.json
git commit -m "feat: add Biome lint/format config"
```

---

### Task 7: Install dependencies

**Files:** (none new — modifies `package-lock.json` / `node_modules`)

**Step 1: Install**

```bash
npm install
```

Expected: installs all deps from `package.json`, generates `package-lock.json`.

**Step 2: Verify install succeeded**

```bash
ls node_modules/@modelcontextprotocol/sdk node_modules/zod node_modules/pino node_modules/vitest
```

Expected: four directories exist.

**Step 3: Commit lock file**

```bash
git add package-lock.json
git commit -m "chore: add package-lock.json"
```

---

### Task 8: Create `src/config.ts`

**Files:**
- Create: `src/config.ts`

**Step 1: Write `src/config.ts`**

```typescript
import * as z from "zod";

const configSchema = z.object({
  MEALIE_URL: z.string().url("MEALIE_URL must be a valid URL (e.g. https://mealie.example.com)"),
  MEALIE_API_TOKEN: z.string().min(1, "MEALIE_API_TOKEN is required"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Validates and returns the server configuration from environment variables.
 * Exits the process with a descriptive error if required variables are missing.
 */
export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    process.stderr.write(`Configuration error:\n${errors}\n`);
    process.exit(1);
  }

  return result.data;
}
```

**Step 2: Commit**

```bash
git add src/config.ts
git commit -m "feat: add zod-validated config loader"
```

---

### Task 9: Create `src/logger.ts`

**Files:**
- Create: `src/logger.ts`

**Step 1: Write `src/logger.ts`**

```typescript
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Pino logger configured to write to stderr only.
 * stdout is reserved for MCP JSON-RPC in stdio transport mode.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  },
  pino.destination({ dest: 2, sync: false }), // fd 2 = stderr
);
```

Note: `dest: 2` hard-pins output to file descriptor 2 (stderr). Never use `console.log` anywhere in this project.

**Step 2: Commit**

```bash
git add src/logger.ts
git commit -m "feat: add pino logger (stderr-only)"
```

---

### Task 10: Create the type generation script

**Files:**
- Create: `scripts/generate-types.ts`

**Step 1: Write `scripts/generate-types.ts`**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "../src/types/mealie.ts");

const specUrl = process.env.MEALIE_SPEC_URL ?? process.env.MEALIE_URL
  ? `${process.env.MEALIE_SPEC_URL ?? process.env.MEALIE_URL}/openapi.json`
  : "https://demo.mealie.io/openapi.json";

async function main(): Promise<void> {
  process.stdout.write(`Generating types from: ${specUrl}\n`);

  const ast = await openapiTS(new URL(specUrl));
  const contents = astToString(ast);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, contents, "utf8");

  process.stdout.write(`Types written to: ${OUT_FILE}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Type generation failed: ${String(err)}\n`);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add scripts/generate-types.ts
git commit -m "feat: add openapi-typescript generation script"
```

---

### Task 11: Generate and commit Mealie types

**Files:**
- Create: `src/types/mealie.ts` (generated)

This step generates the TypeScript types from Mealie's live OpenAPI spec.

**Step 1: Run the generator**

If you have a Mealie instance running, set `MEALIE_URL` first. Otherwise it defaults to the public demo instance:

```bash
npm run generate
```

Expected output:
```
Generating types from: https://demo.mealie.io/openapi.json
Types written to: .../src/types/mealie.ts
```

Expected: `src/types/mealie.ts` exists and contains `export interface paths { ... }` and `export interface components { ... }` with Mealie's full API schema.

**Step 2: Verify the about endpoint exists in generated types**

Grep for the app/about path to confirm it was generated:

```bash
grep -n "app/about\|AppAbout\|appAbout" src/types/mealie.ts | head -10
```

Expected: at least one match showing the endpoint path or type name.

**Step 3: Commit**

```bash
git add src/types/mealie.ts
git commit -m "feat: add generated Mealie OpenAPI types"
```

---

### Task 12: Create `src/client/MealieClient.ts`

**Files:**
- Create: `src/client/MealieClient.ts`

**Step 1: Determine the exact type path for the about response**

After generation, find the exact key for the about endpoint:

```bash
grep -n '"/api/app/about"' src/types/mealie.ts | head -5
```

This tells you whether the path is `/api/app/about` or `/app/about` in the generated types.

**Step 2: Write `src/client/MealieClient.ts`**

Use the exact path from Step 1. Assume it is `/api/app/about` (adjust if grep shows otherwise):

```typescript
import type { paths } from "../types/mealie.js";
import { logger } from "../logger.js";

/** The response shape from GET /api/app/about */
export type AppAbout =
  paths["/api/app/about"]["get"]["responses"][200]["content"]["application/json"];

/**
 * Typed HTTP client for the Mealie REST API.
 * All methods correspond 1:1 to a single Mealie API endpoint.
 */
export class MealieClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;

  constructor(baseUrl: string, apiToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Fetches a resource from the Mealie API.
   *
   * @param path - The API path (e.g. "/api/app/about")
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async get<T>(path: string): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    logger.debug({ url }, "GET request");

    const response = await fetch(url, { headers: this.#headers });

    if (!response.ok) {
      throw new MealieApiError(response.status, response.statusText, path);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Returns information about the connected Mealie instance.
   *
   * @see GET /api/app/about
   */
  async getAbout(): Promise<AppAbout> {
    return this.get<AppAbout>("/api/app/about");
  }
}

/** Thrown when the Mealie API responds with a non-2xx status code. */
export class MealieApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly statusText: string,
    readonly path: string,
  ) {
    super(`Mealie API error ${statusCode} (${statusText}) at ${path}`);
    this.name = "MealieApiError";
  }
}
```

**Step 3: Commit**

```bash
git add src/client/MealieClient.ts
git commit -m "feat: add typed MealieClient with getAbout method"
```

---

### Task 13: Write the failing test for `get_about`

**Files:**
- Create: `src/tools/about.test.ts`

Write this test BEFORE implementing the tool. It will fail because `about.ts` does not exist yet.

**Step 1: Write `src/tools/about.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import type { AppAbout } from "../client/MealieClient.js";
import { getAboutHandler } from "./about.js";

const FAKE_ABOUT: AppAbout = {
  production: true,
  version: "v1.12.0",
  versionLatest: "v1.12.0",
  apiDocs: "/api/docs",
  allowSignup: false,
  enableOidc: false,
  enableLdap: false,
} as AppAbout;

const fakeClient = {
  getAbout: async () => FAKE_ABOUT,
};

describe("getAboutHandler", () => {
  it("returns a text content item with JSON-formatted about info", async () => {
    const result = await getAboutHandler(fakeClient);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const text = (result.content[0] as { type: "text"; text: string }).text;
    const parsed = JSON.parse(text) as AppAbout;
    expect(parsed.version).toBe("v1.12.0");
    expect(parsed.production).toBe(true);
  });

  it("returns isError when getAbout throws", async () => {
    const errorClient = {
      getAbout: async () => {
        throw new Error("connection refused");
      },
    };

    const result = await getAboutHandler(errorClient);

    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("connection refused");
  });
});
```

Note: `FAKE_ABOUT` uses `as AppAbout` to cast the partial shape — the real type may have more fields from the generated types. Adjust if TypeScript complains about missing required fields.

**Step 2: Run the test — confirm it fails**

```bash
npm test
```

Expected: FAIL with `Cannot find module './about.js'` or similar.

---

### Task 14: Implement `src/tools/about.ts`

**Files:**
- Create: `src/tools/about.ts`

**Step 1: Write `src/tools/about.ts`**

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppAbout, MealieClient } from "../client/MealieClient.js";

/**
 * Handles the get_about tool call — returns Mealie instance info.
 *
 * @param client - A MealieClient (or compatible fake for testing)
 * @returns MCP tool result with JSON-formatted about info
 */
export async function getAboutHandler(
  client: Pick<MealieClient, "getAbout">,
): Promise<CallToolResult> {
  try {
    const about: AppAbout = await client.getAbout();
    return {
      content: [{ type: "text", text: JSON.stringify(about, null, 2) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to get Mealie info: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Registers all "about" tools on the MCP server.
 *
 * @param server - The McpServer instance to register tools on
 * @param client - The MealieClient to use for API calls
 */
export function registerAboutTools(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "get_about",
    {
      title: "Get Mealie Info",
      description:
        "Returns information about the connected Mealie instance: version, configuration, and feature flags.",
      annotations: { readOnlyHint: true },
    },
    () => getAboutHandler(client),
  );
}
```

**Step 2: Run the tests — confirm they pass**

```bash
npm test
```

Expected:
```
✓ src/tools/about.test.ts (2 tests)
  ✓ returns a text content item with JSON-formatted about info
  ✓ returns isError when getAbout throws

Test Files  1 passed (1)
Tests       2 passed (2)
```

**Step 3: Commit**

```bash
git add src/tools/about.ts src/tools/about.test.ts
git commit -m "feat: add get_about tool with tests (TDD)"
```

---

### Task 15: Create `src/server.ts`

**Files:**
- Create: `src/server.ts`

**Step 1: Write `src/server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "./client/MealieClient.js";
import { registerAboutTools } from "./tools/about.js";

const SERVER_NAME = "mealie-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Creates and configures the MCP server with all registered tools.
 * Called once per process for stdio, or once per HTTP request for stateless HTTP mode.
 *
 * @param client - The MealieClient instance to pass to all tool handlers
 */
export function createServer(client: MealieClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { logging: {} } },
  );

  registerAboutTools(server, client);

  return server;
}
```

**Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: add McpServer factory with tool registration"
```

---

### Task 16: Create `src/index.ts`

**Files:**
- Create: `src/index.ts`

This is the process entry point. It reads config, creates the client, and starts either stdio or HTTP transport.

**Step 1: Write `src/index.ts`**

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { MealieClient } from "./client/MealieClient.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";

const config = loadConfig();
const client = new MealieClient(config.MEALIE_URL, config.MEALIE_API_TOKEN);

if (config.TRANSPORT === "stdio") {
  await startStdio();
} else {
  await startHttp();
}

async function startStdio(): Promise<void> {
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("mealie-mcp running on stdio");
}

async function startHttp(): Promise<void> {
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Expected an initialization request" },
        id: null,
      });
      return;
    }

    const server = createServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    await server.connect(transport);

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "mealie-mcp running on HTTP");
  });
}
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with stdio and HTTP transport selection"
```

---

### Task 17: Update `README.md`

**Files:**
- Modify: `README.md`

Replace the existing README with a proper install and usage guide.

**Step 1: Write `README.md`**

```markdown
# mealie-mcp

A full-featured MCP (Model Context Protocol) server for [Mealie](https://mealie.io) — the self-hosted recipe manager. Connect any MCP-compatible AI assistant to your Mealie instance.

> **Why this one?** Other Mealie MCPs cover a handful of endpoints. This one targets the full Mealie REST API.

## Installation

No install required — run directly via `npx`:

```bash
npx mealie-mcp
```

## Configuration

Set these environment variables before running:

| Variable | Required | Description |
|----------|----------|-------------|
| `MEALIE_URL` | Yes | Your Mealie instance URL (e.g. `https://mealie.example.com`) |
| `MEALIE_API_TOKEN` | Yes | API token from **Mealie → Profile → API Tokens** |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port when using `TRANSPORT=http` (default: `3000`) |

## Usage with MCP Clients

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie-instance.com",
        "MEALIE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Claude Code

Add to `.claude/settings.json` in your project, or `~/.claude/settings.json` globally:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie-instance.com",
        "MEALIE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie-instance.com",
        "MEALIE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### ChatGPT / Remote HTTP Mode

Run the server in HTTP mode and point ChatGPT's MCP connector at it:

```bash
TRANSPORT=http PORT=3000 \
MEALIE_URL=https://your-mealie-instance.com \
MEALIE_API_TOKEN=your-token-here \
npx mealie-mcp
```

## Development

```bash
git clone https://github.com/mswdev/mealie-mcp.git
cd mealie-mcp
npm install

# Generate types from your Mealie instance (or the demo instance)
MEALIE_URL=https://your-mealie-instance.com npm run generate

# Run tests
npm test

# Build
npm run build

# Run locally
MEALIE_URL=https://your-mealie.com MEALIE_API_TOKEN=your-token npm run dev
```

## Regenerating Types

Types are pre-generated from Mealie's OpenAPI spec and committed to the repo. If Mealie releases a new version:

```bash
MEALIE_URL=https://your-mealie-instance.com npm run generate
git add src/types/mealie.ts
git commit -m "chore: regenerate Mealie types for vX.Y.Z"
```

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with install and usage instructions"
```

---

### Task 18: Quality gate

**Step 1: Run build**

```bash
npm run build
```

Expected: `dist/index.js` created, no TypeScript errors.

**Step 2: Run tests**

```bash
npm test
```

Expected:
```
Test Files  1 passed (1)
Tests       2 passed (2)
```

**Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors. Fix any lint issues before proceeding.

**Step 4: Verify the binary runs**

```bash
node dist/index.js
```

Expected: exits with a config error (since env vars aren't set) — something like:
```
Configuration error:
  - MEALIE_URL: MEALIE_URL must be a valid URL
  - MEALIE_API_TOKEN: MEALIE_API_TOKEN is required
```
This confirms the binary is wired up correctly.

**Step 5: Commit any lint fixes**

If biome auto-fixed anything:
```bash
git add -p
git commit -m "style: apply biome auto-fixes"
```

---

### Task 19: Create the PR

**Step 1: Push the feature branch**

```bash
git push -u origin feature/scaffold
```

**Step 2: Create a draft PR targeting develop**

```bash
gh pr create \
  --draft \
  --base develop \
  --title "feat: scaffold TypeScript MCP server with llm-agent-kit" \
  --body "$(cat <<'EOF'
## Summary

- Brings over llm-agent-kit agent config files (CLAUDE.md, rules, GitHub Actions)
- Scaffolds TypeScript MCP server: package.json, tsconfig, tsup, biome, vitest
- Generates Mealie API types from OpenAPI spec via openapi-typescript
- Adds typed MealieClient and proof-of-concept get_about tool
- Supports both stdio (default) and HTTP (TRANSPORT=http) transports
- README with install instructions for Claude Desktop, Claude Code, Cursor, and ChatGPT

## Test plan

- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `npm test` — 2 tests pass for get_about tool
- [ ] `npm run lint` — no biome errors
- [ ] `node dist/index.js` — exits with a clear config error (no env vars set)
- [ ] MCP config snippet from README works in Claude Desktop (manual test)
EOF
)"
```
