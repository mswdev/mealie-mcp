import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type ItemsCollection, projectItemsCollection } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

/** Mealie's ShoppingListItemCreate defaults for required-with-default fields. */
const DEFAULT_QUANTITY = 1;
const DEFAULT_POSITION = 0;

/** Typed shape for a single item — enforces the two required fields up front. */
const itemSchema = z.object({
  shoppingListId: z.string().describe("UUID of the list the item belongs to (required)"),
  display: z.string().describe("Rendered text for the item, e.g. '2 eggs' (required)"),
  quantity: z.number().optional().describe("Quantity (default 1)"),
  note: z.string().optional().describe("Free-text note"),
  foodId: z.string().optional().describe("Food id (from the foods catalog)"),
  unitId: z.string().optional().describe("Unit id (from the units catalog)"),
  labelId: z.string().optional().describe("Label id"),
  checked: z.boolean().optional().describe("Whether the item is checked off (default false)"),
  position: z.number().int().optional().describe("Ordering position (default 0)"),
});

const inputSchema = {
  item: itemSchema.optional().describe("A single item to create (omit when using `items`)"),
  items: z
    .array(z.record(z.unknown()))
    .optional()
    .describe(
      "Multiple full ShoppingListItemCreate objects to create in bulk (omit when using `item`)",
    ),
};

type SingleItem = z.infer<typeof itemSchema>;
type CreateArgs = {
  item?: SingleItem | undefined;
  items?: Record<string, unknown>[] | undefined;
};

/**
 * Handles shopping_item_create: create one item (POST /items) or many
 * (POST /items/create-bulk). Both endpoints return the created/updated/deleted
 * collection. The single path is typed (shoppingListId + display enforced); the
 * bulk path accepts full ShoppingListItemCreate objects.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item or items)
 * @returns An MCP result summarizing the created items, or an error result
 */
export async function shoppingItemCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    if (args.items) {
      const collection = await client.post<ItemsCollection>(
        "/api/households/shopping/items/create-bulk",
        args.items,
      );
      return jsonResult(projectItemsCollection(collection));
    }
    if (args.item) {
      const collection = await client.post<ItemsCollection>(
        "/api/households/shopping/items",
        toBody(args.item),
      );
      return jsonResult(projectItemsCollection(collection));
    }
    return {
      content: [
        { type: "text", text: "shopping_item_create: provide `item` (single) or `items` (bulk)" },
      ],
      isError: true,
    };
  } catch (error) {
    return errorResult(error, "shopping_item_create", "Failed to create shopping item(s)");
  }
}

/** Builds a ShoppingListItemCreate from the typed single-item args, filling defaults. */
function toBody(item: SingleItem): components["schemas"]["ShoppingListItemCreate"] {
  return {
    shoppingListId: item.shoppingListId,
    display: item.display,
    quantity: item.quantity ?? DEFAULT_QUANTITY,
    note: item.note ?? "",
    checked: item.checked ?? false,
    position: item.position ?? DEFAULT_POSITION,
    extras: {},
    recipeReferences: [],
    ...(item.foodId ? { foodId: item.foodId } : {}),
    ...(item.unitId ? { unitId: item.unitId } : {}),
    ...(item.labelId ? { labelId: item.labelId } : {}),
  };
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
        "Add item(s) to a shopping list. Pass `item` (single, typed: requires shoppingListId + display) or `items` (bulk, full ShoppingListItemCreate objects).",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => shoppingItemCreateHandler(client, args),
  );
}
