import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

/** Base path for the group reports resource. */
const BASE_PATH = "/api/groups/reports";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  item_id: z.string().describe("Report id to delete"),
  confirm: z.boolean().optional().describe("Must be true to delete"),
};

type DeleteArgs = {
  item_id: string;
  confirm?: boolean | undefined;
};

/**
 * Handles group_report_delete: deletes a report (confirm-gated). Mealie returns
 * 200 with an untyped body, so we ignore it and synthesize { deleted: id }.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id + confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function groupReportDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete report "${args.item_id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${BASE_PATH}/${args.item_id}`);
    return jsonResult({ deleted: args.item_id });
  } catch (error) {
    return errorResult(error, "group_report_delete", "Failed to delete report");
  }
}

/**
 * Registers the group_report_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupReportDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_report_delete",
    {
      title: "Delete Report",
      description: "Delete a group report by id. Destructive — requires confirm:true.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => groupReportDeleteHandler(client, args),
  );
}
