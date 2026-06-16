import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  listId: z.string().describe("The shopping list id to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = { listId: string; confirm?: boolean | undefined };

/**
 * Handles shopping_list_delete: permanently deletes a shopping list (and its
 * items). Requires an explicit confirm:true (handler-enforced).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (listId, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function shoppingListDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete shopping list "${args.listId}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/households/shopping/lists/${args.listId}`);
    return jsonResult({ deleted: args.listId });
  } catch (error) {
    return errorResult(error, "shopping_list_delete", "Failed to delete shopping list");
  }
}

/**
 * Registers the shopping_list_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingListDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_delete",
    {
      title: "Delete Shopping List",
      description:
        "Permanently delete a shopping list (and its items) by id. Destructive — requires confirm:true to proceed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => shoppingListDeleteHandler(client, args),
  );
}
