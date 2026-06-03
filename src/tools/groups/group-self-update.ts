import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

const PREFERENCES_PATH = "/api/groups/preferences";
/** Read-only keys present in ReadGroupPreferences but absent from UpdateGroupPreferences. */
const STRIPPED_KEYS = ["groupId", "id"];

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  changes: z
    .record(z.unknown())
    .describe("Preference fields to change, merged onto the current group preferences"),
};

type UpdateArgs = {
  changes?: Record<string, unknown> | undefined;
};

/**
 * Handles group_self_update: updates the group's preferences. UpdateGroupPreferences
 * is a distinct schema but a FULL replace (privateGroup/showAnnouncements both
 * required-with-default), so we fetch-merge the current preferences and strip the
 * read-only groupId/id keys the Update schema does not accept.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (the changes to merge)
 * @returns An MCP result with the updated preferences, or an error result
 */
export async function groupSelfUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  if (!args.changes) return missing("requires changes");
  try {
    const current = await client.get<Record<string, unknown>>(PREFERENCES_PATH);
    const merged = stripReadOnly({ ...current, ...args.changes });
    return jsonResult(await client.put(PREFERENCES_PATH, merged));
  } catch (error) {
    return errorResult(error, "group_self_update", "Failed to update group preferences");
  }
}

/** Drops the read-only keys the Update schema rejects (avoids Biome's noDelete). */
function stripReadOnly(merged: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(merged).filter(([key]) => !STRIPPED_KEYS.includes(key)));
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return { content: [{ type: "text", text: `group_self_update: ${requirement}` }], isError: true };
}

/**
 * Registers the group_self_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupSelfUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_self_update",
    {
      title: "Update Group (Self)",
      description:
        "Update your group's preferences (privateGroup, showAnnouncements). Merges changes onto the current preferences (full replace) so unspecified fields are not reset.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => groupSelfUpdateHandler(client, args),
  );
}
