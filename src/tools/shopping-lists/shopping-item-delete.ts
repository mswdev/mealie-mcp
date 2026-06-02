import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  itemId: z.string().optional().describe("A single item id to delete (omit when using `itemIds`)"),
  itemIds: z
    .array(z.string())
    .optional()
    .describe("Multiple item ids to delete in bulk (omit when using `itemId`)"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = {
  itemId?: string | undefined;
  itemIds?: string[] | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles shopping_item_delete: delete one item (path) or many (ids query array).
 * Destructive — requires an explicit confirm:true.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (itemId or itemIds, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function shoppingItemDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, "delete shopping item(s)");
  if (unconfirmed) return unconfirmed;
  if (!args.itemId && !args.itemIds) {
    return {
      content: [{ type: "text", text: "shopping_item_delete: provide `itemId` (single) or `itemIds` (bulk)" }],
      isError: true,
    };
  }
  try {
    if (args.itemIds) {
      await client.delete("/api/households/shopping/items", { ids: args.itemIds });
      return jsonResult({ deleted: args.itemIds });
    }
    await client.delete(`/api/households/shopping/items/${args.itemId}`);
    return jsonResult({ deleted: [args.itemId] });
  } catch (error) {
    return errorResult(error, "shopping_item_delete", "Failed to delete shopping item(s)");
  }
}

/**
 * Registers the shopping_item_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingItemDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_item_delete",
    {
      title: "Delete Shopping Item(s)",
      description:
        "Delete shopping item(s): pass `itemId` for one or `itemIds` for many. Destructive — requires confirm:true to proceed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => shoppingItemDeleteHandler(client, args),
  );
}
