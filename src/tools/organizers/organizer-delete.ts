import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { ORGANIZER_TYPES, type OrganizerType, organizerBasePath } from "./organizer-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DeleteClient = Pick<MealieClient, "delete">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource to delete"),
  id: z.string().describe("Organizer id (uuid) to delete"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive action"),
};

type DeleteArgs = {
  type: OrganizerType;
  id: string;
  confirm?: boolean | undefined;
};

/**
 * Handles organizer_delete: permanently deletes a category/tag/tool. Deleting an
 * organizer does not delete recipes — it is just removed from any that carry it.
 * Requires an explicit confirm:true (handler-enforced, atop the read-only switch).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (type, id, confirm)
 * @returns An MCP result confirming the deletion, or an error result
 */
export async function organizerDeleteHandler(
  client: DeleteClient,
  args: DeleteArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete ${args.type} "${args.id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${organizerBasePath(args.type)}/${args.id}`);
    return jsonResult({ deleted: args.id });
  } catch (error) {
    return errorResult(error, "organizer_delete", "Failed to delete organizer");
  }
}

/**
 * Registers the organizer_delete tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerOrganizerDelete(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "organizer_delete",
    {
      title: "Delete Organizer",
      description:
        "Permanently delete a category/tag/tool by id (recipes are unaffected — the organizer is just removed from them). Destructive — requires confirm:true.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => organizerDeleteHandler(client, args),
  );
}
