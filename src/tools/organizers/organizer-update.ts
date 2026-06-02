import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import {
  ORGANIZER_TYPES,
  type OrganizerType,
  organizerBasePath,
  projectOrganizer,
} from "./organizer-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource to update"),
  id: z.string().describe("Organizer id (uuid) to update"),
  changes: z
    .record(z.unknown())
    .describe("Fields to change; merged onto the current organizer before the PUT"),
};

type UpdateArgs = {
  type: OrganizerType;
  id: string;
  changes: Record<string, unknown>;
};

/**
 * Handles organizer_update: fetch-merge then PUT. Mealie's PUT is a full replace
 * that reuses the create schema, so merging onto the current object preserves
 * untouched required-with-default fields (e.g. a tool's householdsWithTool).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (type, id, changes)
 * @returns An MCP result echoing the updated organizer, or an error result
 */
export async function organizerUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  try {
    const path = `${organizerBasePath(args.type)}/${args.id}`;
    const current = await client.get<Record<string, unknown>>(path);
    const merged = { ...current, ...args.changes };
    const updated = await client.put<unknown>(path, merged);
    return jsonResult(projectOrganizer(updated, "concise"));
  } catch (error) {
    return errorResult(error, "organizer_update", "Failed to update organizer");
  }
}

/**
 * Registers the organizer_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerOrganizerUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "organizer_update",
    {
      title: "Update Organizer",
      description:
        "Update a category/tag/tool. Pass type, id, and changes (merged onto the current object; PUT is a full replace, so the merge preserves untouched fields).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => organizerUpdateHandler(client, args),
  );
}
