import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type PlanEntry, projectPlanEntry } from "./mealplan-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  planId: z.number().int().positive().describe("Meal plan entry id (an integer, from mealplan_search)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims to scheduling fields; detailed returns the full entry"),
};

type GetArgs = {
  planId: number;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles mealplan_get: fetches a single meal-plan entry by its integer id.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (planId, response_format)
 * @returns An MCP result with the projected entry, or an error result
 */
export async function mealplanGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const entry = await client.get<PlanEntry>(`/api/households/mealplans/${args.planId}`);
    return jsonResult(projectPlanEntry(entry, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "mealplan_get", "Failed to get meal plan entry");
  }
}

/**
 * Registers the mealplan_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_get",
    {
      title: "Get Meal Plan Entry",
      description:
        "Get a single meal-plan entry by its integer id. Returns concise by default; pass response_format: detailed for every field.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => mealplanGetHandler(client, args),
  );
}
