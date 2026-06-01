import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ExportRunClient = Pick<MealieClient, "post" | "delete">;

const inputSchema = {
  action: z.enum(["start", "purge"]).describe("start an export job or purge all export data"),
  recipes: z.array(z.string()).optional().describe("Recipe slugs/ids to export (action=start)"),
  confirm: z.boolean().optional().describe("Must be true to purge all export data (action=purge)"),
};

type ExportRunArgs = {
  action: "start" | "purge";
  recipes?: string[] | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_export_run (writes): start an async export job, or purge all
 * export data (destructive, confirm-gated).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result acknowledging the job/purge, or an error result
 */
export async function recipeExportRunHandler(
  client: ExportRunClient,
  args: ExportRunArgs,
): Promise<CallToolResult> {
  if (args.action === "purge") return purge(client, args);
  try {
    if (!args.recipes?.length) {
      return {
        content: [{ type: "text", text: "recipe_export_run: start requires recipes" }],
        isError: true,
      };
    }
    const body: components["schemas"]["ExportRecipes"] = {
      recipes: args.recipes,
      exportType: "json",
    };
    await client.post("/api/recipes/bulk-actions/export", body);
    return jsonResult({ accepted: args.recipes.length });
  } catch (error) {
    return errorResult(error, "recipe_export_run", "Failed to start export");
  }
}

/** DELETE all export data (confirm-gated). */
async function purge(client: ExportRunClient, args: ExportRunArgs): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, "purge all recipe export data");
  if (unconfirmed) return unconfirmed;
  try {
    const result = await client.delete("/api/recipes/bulk-actions/export/purge");
    return jsonResult(result);
  } catch (error) {
    return errorResult(error, "recipe_export_run", "Failed to purge export data");
  }
}

/**
 * Registers the recipe_export_run tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeExportRun(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_export_run",
    {
      title: "Run Recipe Export",
      description:
        "Start a recipe export job, or purge all export data. Purge is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => recipeExportRunHandler(client, args),
  );
}
