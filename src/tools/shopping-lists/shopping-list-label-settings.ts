import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type ShoppingList, projectShoppingList } from "./shopping-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type LabelClient = Pick<MealieClient, "put">;

const inputSchema = {
  listId: z.string().describe("The shopping list id"),
  labels: z
    .array(z.record(z.unknown()))
    .describe(
      "The complete set of label settings (ShoppingListMultiPurposeLabelUpdate objects: id, shoppingListId, labelId, position). The whole list is submitted, not individual labels.",
    ),
};

type LabelArgs = {
  listId: string;
  labels: Record<string, unknown>[];
};

/**
 * Handles shopping_list_label_settings: reorders/assigns a list's label settings.
 * Mealie replaces the full label set, so submit the complete array.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (listId, labels)
 * @returns An MCP result with the concise updated list, or an error result
 */
export async function shoppingListLabelSettingsHandler(
  client: LabelClient,
  args: LabelArgs,
): Promise<CallToolResult> {
  try {
    const updated = await client.put<ShoppingList>(
      `/api/households/shopping/lists/${args.listId}/label-settings`,
      args.labels,
    );
    return jsonResult(projectShoppingList(updated, "concise"));
  } catch (error) {
    return errorResult(error, "shopping_list_label_settings", "Failed to update label settings");
  }
}

/**
 * Registers the shopping_list_label_settings tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerShoppingListLabelSettings(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "shopping_list_label_settings",
    {
      title: "Update Shopping List Labels",
      description:
        "Reorder or assign the label settings of a shopping list. Submit the full set of label settings (each: id, shoppingListId, labelId, position). Returns the concise updated list.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => shoppingListLabelSettingsHandler(client, args),
  );
}
