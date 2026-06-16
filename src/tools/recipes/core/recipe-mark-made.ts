import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type MarkMadeClient = Pick<MealieClient, "patch">;

const inputSchema = {
  slug: z.string().describe("The recipe slug that was made"),
  timestamp: z
    .string()
    .describe("ISO 8601 datetime the recipe was last made (e.g. 2026-06-01T18:30:00Z)"),
};

type MarkMadeArgs = { slug: string; timestamp: string };

/**
 * Handles recipe_mark_made: records that a recipe was made at a given time.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, timestamp)
 * @returns An MCP result confirming the update, or an error result
 */
export async function recipeMarkMadeHandler(
  client: MarkMadeClient,
  args: MarkMadeArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["RecipeLastMade"] = { timestamp: args.timestamp };
    await client.patch(`/api/recipes/${args.slug}/last-made`, body);
    return jsonResult({ slug: args.slug, lastMade: args.timestamp });
  } catch (error) {
    return errorResult(error, "recipe_mark_made", "Failed to mark recipe as made");
  }
}

/**
 * Registers the recipe_mark_made tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeMarkMade(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_mark_made",
    {
      title: "Mark Recipe Made",
      description:
        "Record that a recipe was made at a given timestamp (updates its last-made date).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => recipeMarkMadeHandler(client, args),
  );
}
