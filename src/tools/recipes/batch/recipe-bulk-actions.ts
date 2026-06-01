import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type BulkClient = Pick<MealieClient, "post">;

const inputSchema = {
  action: z
    .enum(["tag", "categorize", "settings", "delete"])
    .describe("Bulk operation to apply to the given recipes"),
  recipes: z.array(z.string()).min(1).describe("Recipe slugs or ids to act on"),
  tags: z.array(z.string()).optional().describe("Tag names (action=tag)"),
  categories: z.array(z.string()).optional().describe("Category names (action=categorize)"),
  settings: z.record(z.unknown()).optional().describe("Recipe settings object (action=settings)"),
  confirm: z.boolean().optional().describe("Must be true to bulk-delete (action=delete)"),
};

type BulkArgs = {
  action: "tag" | "categorize" | "settings" | "delete";
  recipes: string[];
  tags?: string[] | undefined;
  categories?: string[] | undefined;
  settings?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_bulk_actions: a dispatcher over Mealie's bulk endpoints
 * (tag/categorize/settings/delete). The delete action is destructive and
 * confirm-gated.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action, recipes + action-specific fields)
 * @returns An MCP result summarizing the action, or an error result
 */
export async function recipeBulkActionsHandler(
  client: BulkClient,
  args: BulkArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return bulkDelete(client, args);
  try {
    return await applyBulkAction(client, args);
  } catch (error) {
    return errorResult(error, "recipe_bulk_actions", "Failed to apply bulk action");
  }
}

/** Routes the non-destructive bulk actions to their endpoints. */
async function applyBulkAction(client: BulkClient, args: BulkArgs): Promise<CallToolResult> {
  if (args.action === "tag") {
    if (!args.tags) return missing("tags");
    return post(client, "tag", { recipes: args.recipes, tags: byName(args.tags) }, args);
  }
  if (args.action === "categorize") {
    if (!args.categories) return missing("categories");
    return post(
      client,
      "categorize",
      { recipes: args.recipes, categories: byName(args.categories) },
      args,
    );
  }
  if (!args.settings) return missing("settings");
  return post(client, "settings", { recipes: args.recipes, settings: args.settings }, args);
}

/** DELETE via the bulk endpoint (confirm-gated). */
async function bulkDelete(client: BulkClient, args: BulkArgs): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(
    args.confirm,
    `bulk-delete ${args.recipes.length} recipes`,
  );
  if (unconfirmed) return unconfirmed;
  try {
    return await post(client, "delete", { recipes: args.recipes }, args);
  } catch (error) {
    return errorResult(error, "recipe_bulk_actions", "Failed to bulk-delete recipes");
  }
}

/** POSTs to a bulk-actions endpoint and returns the action summary. */
async function post(
  client: BulkClient,
  endpoint: string,
  body: Record<string, unknown>,
  args: BulkArgs,
): Promise<CallToolResult> {
  await client.post(`/api/recipes/bulk-actions/${endpoint}`, body);
  return jsonResult({ action: args.action, count: args.recipes.length });
}

/** Maps a list of names to Mealie's {name} objects (TagBase/CategoryBase). */
function byName(names: string[]): { name: string }[] {
  return names.map((name) => ({ name }));
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_bulk_actions: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_bulk_actions tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeBulkActions(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_bulk_actions",
    {
      title: "Bulk Recipe Actions",
      description:
        "Apply a bulk action to many recipes: tag, categorize, change settings, or delete. Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => recipeBulkActionsHandler(client, args),
  );
}
