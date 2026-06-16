import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type MergeClient = Pick<MealieClient, "put">;

const inputSchema = {
  fromFood: z.string().describe("Food id to merge FROM (absorbed into toFood, then removed)"),
  toFood: z.string().describe("Food id to merge INTO (kept)"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive merge"),
};

type MergeArgs = {
  fromFood: string;
  toFood: string;
  confirm?: boolean | undefined;
};

/**
 * Handles food_merge: combines one food into another (all references repoint to
 * toFood; fromFood is removed). Destructive — requires confirm:true.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (fromFood, toFood, confirm)
 * @returns An MCP result with the merge outcome, or an error result
 */
export async function foodMergeHandler(
  client: MergeClient,
  args: MergeArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(
    args.confirm,
    `merge food "${args.fromFood}" into "${args.toFood}"`,
  );
  if (unconfirmed) return unconfirmed;
  try {
    const body: components["schemas"]["MergeFood"] = {
      fromFood: args.fromFood,
      toFood: args.toFood,
    };
    const result = await client.put<unknown>("/api/foods/merge", body);
    return jsonResult(result ?? { merged: { from: args.fromFood, to: args.toFood } });
  } catch (error) {
    return errorResult(error, "food_merge", "Failed to merge foods");
  }
}

/**
 * Registers the food_merge tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerFoodMerge(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "food_merge",
    {
      title: "Merge Foods",
      description:
        "Merge one food into another (references repoint to the target, the source is removed). Destructive — requires confirm:true.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => foodMergeHandler(client, args),
  );
}
