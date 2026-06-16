import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateManyClient = Pick<MealieClient, "put" | "patch">;

const inputSchema = {
  recipes: z
    .array(z.record(z.unknown()))
    .min(1)
    .describe(
      "Complete recipe objects to update. Each item must be a FULL recipe (e.g. from recipe_get with response_format=detailed) — Mealie replaces the whole object, so partial items overwrite and wipe omitted fields.",
    ),
  method: z.enum(["put", "patch"]).optional().describe("HTTP method (default put)"),
};

type UpdateManyArgs = {
  recipes: Record<string, unknown>[];
  method?: "put" | "patch" | undefined;
};

/**
 * Handles recipe_update_many: bulk-updates recipes via the collection endpoint.
 * No per-item merge is possible (that would be N fetches), so each item must be a
 * complete recipe object.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (recipes, method)
 * @returns An MCP result summarizing how many were updated, or an error result
 */
export async function recipeUpdateManyHandler(
  client: UpdateManyClient,
  args: UpdateManyArgs,
): Promise<CallToolResult> {
  try {
    const method = args.method ?? "put";
    await client[method]("/api/recipes", args.recipes);
    return jsonResult({ updated: args.recipes.length });
  } catch (error) {
    return errorResult(error, "recipe_update_many", "Failed to update recipes");
  }
}

/**
 * Registers the recipe_update_many tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeUpdateMany(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_update_many",
    {
      title: "Update Many Recipes",
      description:
        "Bulk-update recipes. Each item must be a COMPLETE recipe object (Mealie replaces the whole recipe; partial items lose data).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => recipeUpdateManyHandler(client, args),
  );
}
