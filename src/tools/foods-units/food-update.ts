import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type FoodDetail, projectFood } from "./food-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  id: z.string().describe("Food id (uuid) to update"),
  changes: z
    .record(z.unknown())
    .describe("Fields to change; merged onto the current food before the PUT"),
};

type UpdateArgs = {
  id: string;
  changes: Record<string, unknown>;
};

/**
 * Handles food_update: fetch-merge then PUT. Mealie's PUT reuses the create
 * schema (full replace), so merging changes onto the current food preserves
 * untouched required-with-default fields (aliases, extras, households).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, changes)
 * @returns An MCP result echoing the updated food, or an error result
 */
export async function foodUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  try {
    const path = `/api/foods/${args.id}`;
    const current = await client.get<Record<string, unknown>>(path);
    const merged = { ...current, ...args.changes };
    const updated = await client.put<FoodDetail>(path, merged);
    return jsonResult(projectFood(updated, "concise"));
  } catch (error) {
    return errorResult(error, "food_update", "Failed to update food");
  }
}

/**
 * Registers the food_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerFoodUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "food_update",
    {
      title: "Update Food",
      description:
        "Update an ingredient food. Pass id and changes (merged onto the current food; PUT is a full replace, so the merge preserves untouched fields).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => foodUpdateHandler(client, args),
  );
}
