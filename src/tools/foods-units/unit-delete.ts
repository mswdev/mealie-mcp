import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  id: z.string().describe("The unit id (uuid) to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = { id: string; confirm?: boolean | undefined };

/**
 * Handles unit_delete: permanently deletes an ingredient unit. Requires an
 * explicit confirm:true (handler-enforced, atop the read-only switch).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function unitDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete unit "${args.id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/units/${args.id}`);
    return jsonResult({ deleted: args.id });
  } catch (error) {
    return errorResult(error, "unit_delete", "Failed to delete unit");
  }
}

/**
 * Registers the unit_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUnitDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "unit_delete",
    {
      title: "Delete Unit",
      description:
        "Permanently delete an ingredient unit by id. Destructive — requires confirm:true to proceed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => unitDeleteHandler(client, args),
  );
}
