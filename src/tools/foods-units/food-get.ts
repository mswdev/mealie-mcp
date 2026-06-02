import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type FoodDetail, projectFood } from "./food-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  id: z.string().describe("Food id (uuid, from food_search)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims to key fields; detailed returns the full food"),
};

type GetArgs = {
  id: string;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles food_get: fetches a single ingredient food and projects it.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, response_format)
 * @returns An MCP result with the projected food, or an error result
 */
export async function foodGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    const food = await client.get<FoodDetail>(`/api/foods/${args.id}`);
    return jsonResult(projectFood(food, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "food_get", "Failed to get food");
  }
}

/**
 * Registers the food_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerFoodGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "food_get",
    {
      title: "Get Food",
      description:
        "Get a single ingredient food by id. Returns concise by default; pass response_format: detailed for every field.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => foodGetHandler(client, args),
  );
}
