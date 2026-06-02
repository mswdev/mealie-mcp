import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type TodayClient = Pick<MealieClient, "get">;

const inputSchema = {};

type TodayArgs = Record<string, never>;

/**
 * Handles mealplan_today: returns the meals planned for today. Mealie types this
 * endpoint's body as unknown upstream, so the result is returned verbatim.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param _args - No arguments
 * @returns An MCP result with today's planned meals, or an error result
 */
export async function mealplanTodayHandler(
  client: TodayClient,
  _args: TodayArgs,
): Promise<CallToolResult> {
  try {
    return jsonResult(await client.get("/api/households/mealplans/today"));
  } catch (error) {
    return errorResult(error, "mealplan_today", "Failed to get today's meals");
  }
}

/**
 * Registers the mealplan_today tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanToday(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_today",
    {
      title: "Today's Meals",
      description: "List the meals planned for today in the current household.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => mealplanTodayHandler(client, args),
  );
}
