import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type ShoppingList, projectShoppingList } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  listId: z.string().describe("The shopping list id to update"),
  changes: z
    .record(z.unknown())
    .describe(
      "Fields to change (e.g. name). Merged onto the current list before sending — ShoppingListUpdate requires the full object, so the fetched items are preserved.",
    ),
};

type UpdateArgs = {
  listId: string;
  changes: Record<string, unknown>;
};

/**
 * Handles shopping_list_update: fetches the current list, merges the requested
 * changes, and PUTs the full merged object. Mealie's ShoppingListUpdate requires
 * id/groupId/userId/listItems, so sending the fetched list back preserves items.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (listId, changes)
 * @returns An MCP result with the concise updated list, or an error result
 */
export async function shoppingListUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  try {
    const path = `/api/households/shopping/lists/${args.listId}`;
    const current = await client.get<ShoppingList>(path);
    const merged = { ...(current as Record<string, unknown>), ...args.changes };
    const updated = await client.put<ShoppingList>(path, merged);
    return jsonResult(projectShoppingList(updated, "concise"));
  } catch (error) {
    return errorResult(error, "shopping_list_update", "Failed to update shopping list");
  }
}

/**
 * Registers the shopping_list_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingListUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_update",
    {
      title: "Update Shopping List",
      description:
        "Update a shopping list's fields (e.g. name) by id. Pass only what changes in `changes`; items are preserved. Returns the concise updated list.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => shoppingListUpdateHandler(client, args),
  );
}
