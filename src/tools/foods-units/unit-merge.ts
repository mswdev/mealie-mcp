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
  fromUnit: z.string().describe("Unit id to merge FROM (absorbed into toUnit, then removed)"),
  toUnit: z.string().describe("Unit id to merge INTO (kept)"),
  confirm: z.boolean().optional().describe("Must be true to perform this destructive merge"),
};

type MergeArgs = {
  fromUnit: string;
  toUnit: string;
  confirm?: boolean | undefined;
};

/**
 * Handles unit_merge: combines one unit into another (all references repoint to
 * toUnit; fromUnit is removed). Destructive — requires confirm:true.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (fromUnit, toUnit, confirm)
 * @returns An MCP result with the merge outcome, or an error result
 */
export async function unitMergeHandler(
  client: MergeClient,
  args: MergeArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(
    args.confirm,
    `merge unit "${args.fromUnit}" into "${args.toUnit}"`,
  );
  if (unconfirmed) return unconfirmed;
  try {
    const body: components["schemas"]["MergeUnit"] = {
      fromUnit: args.fromUnit,
      toUnit: args.toUnit,
    };
    const result = await client.put<unknown>("/api/units/merge", body);
    return jsonResult(result ?? { merged: { from: args.fromUnit, to: args.toUnit } });
  } catch (error) {
    return errorResult(error, "unit_merge", "Failed to merge units");
  }
}

/**
 * Registers the unit_merge tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUnitMerge(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "unit_merge",
    {
      title: "Merge Units",
      description:
        "Merge one unit into another (references repoint to the target, the source is removed). Destructive — requires confirm:true.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => unitMergeHandler(client, args),
  );
}
