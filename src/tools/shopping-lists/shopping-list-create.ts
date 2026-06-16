import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type ShoppingList, projectShoppingList } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

const inputSchema = {
  name: z.string().min(1).describe("Name of the new shopping list"),
};

type CreateArgs = { name: string };

/**
 * Handles shopping_list_create: creates an empty shopping list by name.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name)
 * @returns An MCP result with the concise created list, or an error result
 */
export async function shoppingListCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    // extras is required-with-default in ShoppingListCreate; send an empty object.
    const body: components["schemas"]["ShoppingListCreate"] = { name: args.name, extras: {} };
    const created = await client.post<ShoppingList>("/api/households/shopping/lists", body);
    return jsonResult(projectShoppingList(created, "concise"));
  } catch (error) {
    return errorResult(error, "shopping_list_create", "Failed to create shopping list");
  }
}

/**
 * Registers the shopping_list_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingListCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_create",
    {
      title: "Create Shopping List",
      description:
        "Create a new, empty shopping list by name. Use shopping_item_create or shopping_list_recipe_references to populate it.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => shoppingListCreateHandler(client, args),
  );
}
