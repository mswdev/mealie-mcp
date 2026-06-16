import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type ShoppingList, projectShoppingList } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  listId: z.string().describe("Shopping list id (from shopping_list_search)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims item detail; detailed returns the full list"),
};

type GetArgs = {
  listId: string;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles shopping_list_get: fetches a single shopping list. The list already
 * bundles its items, recipe references, and label settings (aggregated read).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (listId, response_format)
 * @returns An MCP result with the projected list, or an error result
 */
export async function shoppingListGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const list = await client.get<ShoppingList>(`/api/households/shopping/lists/${args.listId}`);
    return jsonResult(projectShoppingList(list, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "shopping_list_get", "Failed to get shopping list");
  }
}

/**
 * Registers the shopping_list_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingListGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_get",
    {
      title: "Get Shopping List",
      description:
        "Get a single shopping list with its items, recipe references, and label settings. Concise by default; pass response_format: detailed for full item detail.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => shoppingListGetHandler(client, args),
  );
}
