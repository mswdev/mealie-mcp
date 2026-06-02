import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import {
  type ItemsCollection,
  type ShoppingItem,
  projectItemsCollection,
} from "./shopping-projection.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  itemId: z.string().optional().describe("Item id for a single update (omit when using `items`)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change for the single update; merged onto the current item"),
  items: z
    .array(z.record(z.unknown()))
    .optional()
    .describe("Full ShoppingListItemUpdateBulk objects for a bulk update (each must include id)"),
};

type UpdateArgs = {
  itemId?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  items?: Record<string, unknown>[] | undefined;
};

/**
 * Handles shopping_item_update: single (fetch-merge → PUT /items/{id}) or bulk
 * (PUT /items with an array). Both return the created/updated/deleted collection.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (itemId+changes for single, or items for bulk)
 * @returns An MCP result summarizing the updated items, or an error result
 */
export async function shoppingItemUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  if (args.items) return bulkUpdate(client, args.items);
  if (!args.itemId) {
    return {
      content: [{ type: "text", text: "shopping_item_update: provide `itemId` (single) or `items` (bulk)" }],
      isError: true,
    };
  }
  return singleUpdate(client, args.itemId, args.changes ?? {});
}

/** Fetch-merge a single item then PUT to its item path. */
async function singleUpdate(
  client: UpdateClient,
  itemId: string,
  changes: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const path = `/api/households/shopping/items/${itemId}`;
    const current = await client.get<ShoppingItem>(path);
    const merged = { ...(current as Record<string, unknown>), ...changes };
    const collection = await client.put<ItemsCollection>(path, merged);
    return jsonResult(projectItemsCollection(collection));
  } catch (error) {
    return errorResult(error, "shopping_item_update", "Failed to update shopping item");
  }
}

/** Bulk-update via PUT to the items collection. */
async function bulkUpdate(
  client: UpdateClient,
  items: Record<string, unknown>[],
): Promise<CallToolResult> {
  try {
    const collection = await client.put<ItemsCollection>("/api/households/shopping/items", items);
    return jsonResult(projectItemsCollection(collection));
  } catch (error) {
    return errorResult(error, "shopping_item_update", "Failed to bulk-update shopping items");
  }
}

/**
 * Registers the shopping_item_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingItemUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_item_update",
    {
      title: "Update Shopping Item(s)",
      description:
        "Update shopping item(s). Single: pass `itemId` + `changes` (merged onto the current item). Bulk: pass `items` (full objects, each including `id`).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => shoppingItemUpdateHandler(client, args),
  );
}
