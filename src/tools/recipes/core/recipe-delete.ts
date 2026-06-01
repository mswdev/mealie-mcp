import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  slug: z.string().describe("The recipe slug to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = { slug: string; confirm?: boolean | undefined };

/**
 * Handles recipe_delete: permanently deletes a recipe. Requires an explicit
 * confirm:true (handler-enforced, on top of the read-only switch).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function recipeDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete recipe "${args.slug}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/recipes/${args.slug}`);
    return jsonResult({ deleted: args.slug });
  } catch (error) {
    return errorResult(error, "recipe_delete", "Failed to delete recipe");
  }
}

/**
 * Registers the recipe_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_delete",
    {
      title: "Delete Recipe",
      description:
        "Permanently delete a recipe by slug. Destructive — requires confirm:true to proceed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => recipeDeleteHandler(client, args),
  );
}
