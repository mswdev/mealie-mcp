import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type UnitDetail, projectUnit } from "./unit-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  id: z.string().describe("Unit id (uuid, from unit_search)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims to key fields; detailed returns the full unit"),
};

type GetArgs = {
  id: string;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles unit_get: fetches a single ingredient unit and projects it.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, response_format)
 * @returns An MCP result with the projected unit, or an error result
 */
export async function unitGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    const unit = await client.get<UnitDetail>(`/api/units/${args.id}`);
    return jsonResult(projectUnit(unit, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "unit_get", "Failed to get unit");
  }
}

/**
 * Registers the unit_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUnitGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "unit_get",
    {
      title: "Get Unit",
      description:
        "Get a single ingredient unit by id. Returns concise by default; pass response_format: detailed for every field.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => unitGetHandler(client, args),
  );
}
