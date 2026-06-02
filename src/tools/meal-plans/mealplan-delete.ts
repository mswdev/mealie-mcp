import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  planId: z.number().int().positive().describe("The meal plan entry id to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = { planId: number; confirm?: boolean | undefined };

/**
 * Handles mealplan_delete: permanently removes a meal-plan entry. Requires an
 * explicit confirm:true (handler-enforced, on top of the read-only switch).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (planId, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function mealplanDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete meal plan entry ${args.planId}`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/households/mealplans/${args.planId}`);
    return jsonResult({ deleted: args.planId });
  } catch (error) {
    return errorResult(error, "mealplan_delete", "Failed to delete meal plan entry");
  }
}

/**
 * Registers the mealplan_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_delete",
    {
      title: "Delete Meal Plan Entry",
      description:
        "Permanently delete a meal-plan entry by id. Destructive — requires confirm:true to proceed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => mealplanDeleteHandler(client, args),
  );
}
