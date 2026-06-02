import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  id: z.string().describe("The food id (uuid) to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = { id: string; confirm?: boolean | undefined };

/**
 * Handles food_delete: permanently deletes an ingredient food. Requires an
 * explicit confirm:true (handler-enforced, atop the read-only switch).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function foodDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete food "${args.id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/foods/${args.id}`);
    return jsonResult({ deleted: args.id });
  } catch (error) {
    return errorResult(error, "food_delete", "Failed to delete food");
  }
}

/**
 * Registers the food_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerFoodDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "food_delete",
    {
      title: "Delete Food",
      description:
        "Permanently delete an ingredient food by id. Destructive — requires confirm:true to proceed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => foodDeleteHandler(client, args),
  );
}
