import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type ItemsCollection, projectItemsCollection } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

const inputSchema = {
  item: z
    .record(z.unknown())
    .optional()
    .describe("A single item to create (omit when using `items`)"),
  items: z
    .array(z.record(z.unknown()))
    .optional()
    .describe("Multiple items to create in bulk (omit when using `item`)"),
};

type CreateArgs = {
  item?: Record<string, unknown> | undefined;
  items?: Record<string, unknown>[] | undefined;
};

/**
 * Handles shopping_item_create: create one item (POST /items) or many
 * (POST /items/create-bulk). Each item requires shoppingListId and display.
 * Both endpoints return the created/updated/deleted collection.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item or items)
 * @returns An MCP result summarizing the created items, or an error result
 */
export async function shoppingItemCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  if (!args.item && !args.items) {
    return {
      content: [{ type: "text", text: "shopping_item_create: provide `item` (single) or `items` (bulk)" }],
      isError: true,
    };
  }
  try {
    const collection = args.items
      ? await client.post<ItemsCollection>("/api/households/shopping/items/create-bulk", args.items)
      : await client.post<ItemsCollection>("/api/households/shopping/items", args.item);
    return jsonResult(projectItemsCollection(collection));
  } catch (error) {
    return errorResult(error, "shopping_item_create", "Failed to create shopping item(s)");
  }
}

/**
 * Registers the shopping_item_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingItemCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_item_create",
    {
      title: "Create Shopping Item(s)",
      description:
        "Add item(s) to a shopping list. Pass `item` for one or `items` for many. Each item requires `shoppingListId` and `display` (the rendered text); optionally `quantity`, `note`, `foodId`, `unitId`, `labelId`, `checked`, `position`.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => shoppingItemCreateHandler(client, args),
  );
}
