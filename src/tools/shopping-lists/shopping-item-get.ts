import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

/** Default page size for the cross-list items view. */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size. */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type ItemGetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  action: z
    .enum(["list", "get"])
    .optional()
    .describe("list (items across all lists, paginated) or get (one item by id)"),
  itemId: z.string().optional().describe("Shopping item id (action=get)"),
  queryFilter: z.string().optional().describe("Mealie filter expression (action=list)"),
  page: z.number().int().positive().optional().describe("1-based page number (action=list)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, action=list)`),
};

type ItemGetArgs = {
  action?: "list" | "get" | undefined;
  itemId?: string | undefined;
  queryFilter?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
};

/**
 * Handles shopping_item_get (reads): one item by id, or the paginated cross-list
 * items view.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the requested item(s), or an error result
 */
export async function shoppingItemGetHandler(
  client: ItemGetClient,
  args: ItemGetArgs,
): Promise<CallToolResult> {
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "shopping_item_get", "Failed to read shopping items");
  }
}

/** Routes the item reads. */
async function read(client: ItemGetClient, args: ItemGetArgs): Promise<CallToolResult> {
  if ((args.action ?? "list") === "get") {
    if (!args.itemId) return missing("itemId");
    return jsonResult(await client.get(`/api/households/shopping/items/${args.itemId}`));
  }
  const page = await client.getPaginated("/api/households/shopping/items", {
    queryFilter: args.queryFilter,
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
  });
  return jsonResult(page);
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `shopping_item_get: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the shopping_item_get read tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingItemGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_item_get",
    {
      title: "Read Shopping Items",
      description:
        "Read shopping items: list (across all lists, paginated) or get (one by id). Use shopping_item_create/update/delete to mutate.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => shoppingItemGetHandler(client, args),
  );
}
