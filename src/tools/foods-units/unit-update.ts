import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type UnitDetail, projectUnit } from "./unit-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  id: z.string().describe("Unit id (uuid) to update"),
  changes: z
    .record(z.unknown())
    .describe("Fields to change; merged onto the current unit before the PUT"),
};

type UpdateArgs = {
  id: string;
  changes: Record<string, unknown>;
};

/**
 * Handles unit_update: fetch-merge then PUT. Mealie's PUT reuses the create
 * schema (full replace), so merging changes onto the current unit preserves
 * untouched required-with-default fields (fraction, abbreviation, aliases, ...).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, changes)
 * @returns An MCP result echoing the updated unit, or an error result
 */
export async function unitUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  try {
    const path = `/api/units/${args.id}`;
    const current = await client.get<Record<string, unknown>>(path);
    const merged = { ...current, ...args.changes };
    const updated = await client.put<UnitDetail>(path, merged);
    return jsonResult(projectUnit(updated, "concise"));
  } catch (error) {
    return errorResult(error, "unit_update", "Failed to update unit");
  }
}

/**
 * Registers the unit_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUnitUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "unit_update",
    {
      title: "Update Unit",
      description:
        "Update an ingredient unit. Pass id and changes (merged onto the current unit; PUT is a full replace, so the merge preserves untouched fields).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => unitUpdateHandler(client, args),
  );
}
