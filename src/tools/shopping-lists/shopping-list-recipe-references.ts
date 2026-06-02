import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type ShoppingList, projectShoppingList } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type RefClient = Pick<MealieClient, "post">;

/** Default quantity step for add/remove when the caller omits it. */
const DEFAULT_QUANTITY = 1;

const inputSchema = {
  action: z
    .enum(["add", "add_by_recipe", "remove"])
    .describe("add (bulk endpoint), add_by_recipe (deprecated single-path form), or remove"),
  listId: z.string().describe("Shopping list id"),
  recipeId: z.string().optional().describe("Recipe UUID to add/remove"),
  quantity: z.number().positive().optional().describe("Quantity to add or remove (default 1)"),
};

type RefArgs = {
  action: "add" | "add_by_recipe" | "remove";
  listId: string;
  recipeId?: string | undefined;
  quantity?: number | undefined;
};

/**
 * Handles shopping_list_recipe_references: add a recipe's ingredients to a list
 * (bulk or deprecated single endpoint) or remove them. Remove is a POST to a
 * `/delete` path, not a DELETE verb. All variants return the updated list.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action, listId, recipeId, quantity)
 * @returns An MCP result with the concise updated list, or an error result
 */
export async function recipeReferencesHandler(
  client: RefClient,
  args: RefArgs,
): Promise<CallToolResult> {
  if (!args.recipeId) {
    return {
      content: [
        { type: "text", text: 'shopping_list_recipe_references: action requires "recipeId"' },
      ],
      isError: true,
    };
  }
  try {
    const updated = await dispatch(client, args, args.recipeId);
    return jsonResult(projectShoppingList(updated, "concise"));
  } catch (error) {
    return errorResult(
      error,
      "shopping_list_recipe_references",
      "Failed to update recipe references",
    );
  }
}

/** Routes to the add (bulk), add_by_recipe (deprecated), or remove endpoint. */
async function dispatch(client: RefClient, args: RefArgs, recipeId: string): Promise<ShoppingList> {
  const base = `/api/households/shopping/lists/${args.listId}/recipe`;
  if (args.action === "remove") {
    const body: components["schemas"]["ShoppingListRemoveRecipeParams"] = {
      recipeDecrementQuantity: args.quantity ?? DEFAULT_QUANTITY,
    };
    return client.post<ShoppingList>(`${base}/${recipeId}/delete`, body);
  }
  if (args.action === "add_by_recipe") {
    const body: components["schemas"]["ShoppingListAddRecipeParams"] = {
      recipeIncrementQuantity: args.quantity ?? DEFAULT_QUANTITY,
    };
    return client.post<ShoppingList>(`${base}/${recipeId}`, body);
  }
  const body: components["schemas"]["ShoppingListAddRecipeParamsBulk"][] = [
    { recipeId, recipeIncrementQuantity: args.quantity ?? DEFAULT_QUANTITY },
  ];
  return client.post<ShoppingList>(base, body);
}

/**
 * Registers the shopping_list_recipe_references tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeReferences(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_recipe_references",
    {
      title: "Shopping List Recipe References",
      description:
        "Add a recipe's ingredients to a shopping list (action=add) or remove them (action=remove). add_by_recipe is the deprecated single-path form. Returns the updated list.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => recipeReferencesHandler(client, args),
  );
}
