import { resolve } from "node:path";
import { allResults, expect, runCheck, snippet } from "./assert.js";
import type { CheckContext } from "./checks/context.js";
import * as docker from "./docker.js";
import { connect } from "./mcp.js";
import { groupSlug, login, makeExplorable, mintApiToken } from "./mealie-rest.js";
import { specParity } from "./preflight.js";
import { writeReport, writeSkeleton } from "./report.js";

/** Expected total tool count with all six opt-in toolsets enabled (server.test.ts axis). */
const EXPECTED_ALL_TOOLSETS = 121;

/** Smoke checks proving the bootstrap → MCP → container pipeline is sound. */
async function smoke(ctx: CheckContext): Promise<void> {
  await runCheck({ id: "C-SMOKE-TOOLS", owedPr: "#7-#11", title: "all six toolsets expose 121 tools" }, async () => {
    const names = await ctx.mcp.listToolNames();
    expect(names.length === EXPECTED_ALL_TOOLSETS, `expected ${EXPECTED_ALL_TOOLSETS} tools, got ${names.length}`);
    return `listTools returned ${names.length} tools`;
  });
  await runCheck({ id: "C-SMOKE-SEARCH", owedPr: "#2", title: "recipe_search reaches the live API authed" }, async () => {
    const result = await ctx.mcp.call("recipe_search", { perPage: 5 });
    expect(!result.isError, `recipe_search errored: ${result.text}`);
    const body = result.json as { items?: unknown[]; total?: number };
    expect(Array.isArray(body.items), `no items array: ${snippet(result.json)}`);
    return `total=${body.total}, items=${body.items?.length}`;
  });
}

/** Runs the full live-verification pass. Teardown is unconditional. */
async function main(): Promise<void> {
  writeSkeleton();
  docker.up();
  try {
    const version = await docker.reportVersion();
    const parity = await specParity();
    process.stdout.write(`Mealie ${version.runningVersion} (tag ${version.pinnedTag}) · spec parity: ${parity}\n`);

    const bearer = await login();
    const token = await mintApiToken(bearer);
    await makeExplorable(bearer);
    const mcp = await connect(token);
    const ctx: CheckContext = {
      mcp,
      bearer,
      groupSlug: await groupSlug(bearer),
      fixturesDir: resolve("scripts/verify-live/fixtures"),
      scratch: {},
    };

    await smoke(ctx);

    await mcp.close();
    writeReport({ ...version, specParity: parity });
  } finally {
    docker.down();
  }
  const failed = allResults().filter((r) => r.status === "fail").length;
  process.stdout.write(`\nDone: ${allResults().length} checks, ${failed} failed.\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

await main();
