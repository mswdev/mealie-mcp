import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

/** Seed targets and their endpoint path segments. */
const TARGETS = ["foods", "labels", "units"] as const;
/** Base path for the group seeders resource. */
const BASE_PATH = "/api/groups/seeders";

/** Mealie's generic success envelope: a 200 with error:true is still a failure. */
type SuccessResponse = components["schemas"]["SuccessResponse"];

/** Minimal client surface the handler needs (eases test fakes). */
type SeedClient = Pick<MealieClient, "post">;

const inputSchema = {
  target: z.enum(TARGETS).describe("What to seed: foods, labels, or units"),
  locale: z.string().describe("Locale code selecting the seed dataset, e.g. en-US"),
};

type SeedArgs = {
  target: (typeof TARGETS)[number];
  locale?: string | undefined;
};

/**
 * Handles group_seed: bulk-seeds the group's foods, labels, or units catalog from
 * a locale dataset. Additive (non-destructive) but side-effecting. Mealie returns
 * a 200 with an error flag, so a truthy error is surfaced as a failure.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (target + locale)
 * @returns An MCP result reporting the seed outcome, or an error result
 */
export async function groupSeedHandler(
  client: SeedClient,
  args: SeedArgs,
): Promise<CallToolResult> {
  if (!args.locale) return missing("requires locale");
  try {
    const body: components["schemas"]["SeederConfig"] = { locale: args.locale };
    const result = await client.post<SuccessResponse>(`${BASE_PATH}/${args.target}`, body);
    if (result.error) return errorResult(new Error(result.message), "group_seed", "Seed failed");
    return jsonResult({ seeded: args.target, message: result.message });
  } catch (error) {
    return errorResult(error, "group_seed", "Failed to seed");
  }
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return { content: [{ type: "text", text: `group_seed: ${requirement}` }], isError: true };
}

/**
 * Registers the group_seed tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupSeed(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_seed",
    {
      title: "Seed Catalog",
      description:
        "Bulk-seed the group's foods, labels, or units from a locale dataset (e.g. en-US). Additive — it appends to the catalog (re-running can add duplicates).",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => groupSeedHandler(client, args),
  );
}
