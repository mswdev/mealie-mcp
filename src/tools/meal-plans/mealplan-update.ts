import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type PlanEntry, projectPlanEntry } from "./mealplan-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  planId: z.number().int().positive().describe("Meal plan entry id (an integer)"),
  changes: z
    .record(z.unknown())
    .describe(
      "Fields to change (e.g. date, entryType, title, text, recipeId). Merged onto the current entry so untouched fields are preserved.",
    ),
};

type UpdateArgs = {
  planId: number;
  changes: Record<string, unknown>;
};

/**
 * Handles mealplan_update: fetches the current entry, merges the requested
 * changes, drops the read-only-only fields (householdId, recipe) that the
 * UpdatePlanEntry schema does not accept, then PUTs the merged object.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (planId, changes)
 * @returns An MCP result with the concise updated entry, or an error result
 */
export async function mealplanUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  try {
    const path = `/api/households/mealplans/${args.planId}`;
    const current = await client.get<PlanEntry>(path);
    const merged = { ...(current as Record<string, unknown>), ...args.changes };
    delete merged.householdId;
    delete merged.recipe;
    await client.put(path, merged);
    const updated = await client.get<PlanEntry>(path);
    return jsonResult(projectPlanEntry(updated, "concise"));
  } catch (error) {
    return errorResult(error, "mealplan_update", "Failed to update meal plan entry");
  }
}

/**
 * Registers the mealplan_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_update",
    {
      title: "Update Meal Plan Entry",
      description:
        "Update a meal-plan entry by id. Pass only the fields you want to change in `changes`; they are merged onto the current entry. Returns the concise updated entry.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => mealplanUpdateHandler(client, args),
  );
}
