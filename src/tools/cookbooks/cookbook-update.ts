import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type CookbookDetail, projectCookbook } from "./cookbook-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  id: z
    .string()
    .optional()
    .describe("Cookbook id to update (single update; omit when using `items`)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change for the single update; merged onto the current cookbook"),
  items: z
    .array(z.record(z.unknown()))
    .optional()
    .describe(
      "Full UpdateCookBook objects for a bulk update (each must include id, groupId, householdId)",
    ),
};

type UpdateArgs = {
  id?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  items?: Record<string, unknown>[] | undefined;
};

/**
 * Handles cookbook_update: single (fetch-merge → PUT /{id}, body CreateCookBook)
 * or bulk (PUT the items array to the collection, body UpdateCookBook[]).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id+changes for single, or items for bulk)
 * @returns An MCP result echoing the updated cookbook(s), or an error result
 */
export async function cookbookUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  if (args.items) return bulkUpdate(client, args.items);
  if (!args.id) {
    return {
      content: [{ type: "text", text: "cookbook_update: provide `id` (single) or `items` (bulk)" }],
      isError: true,
    };
  }
  return singleUpdate(client, args.id, args.changes ?? {});
}

/** Fetch-merge a single cookbook then PUT to its item path. */
async function singleUpdate(
  client: UpdateClient,
  id: string,
  changes: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const path = `/api/households/cookbooks/${id}`;
    const current = await client.get<CookbookDetail>(path);
    const merged = { ...(current as Record<string, unknown>), ...changes };
    const updated = await client.put<CookbookDetail>(path, merged);
    return jsonResult(projectCookbook(updated, "concise"));
  } catch (error) {
    return errorResult(error, "cookbook_update", "Failed to update cookbook");
  }
}

/** Bulk-update via PUT to the collection (array of UpdateCookBook). */
async function bulkUpdate(
  client: UpdateClient,
  items: Record<string, unknown>[],
): Promise<CallToolResult> {
  try {
    await client.put("/api/households/cookbooks", items);
    return jsonResult({ updated: items.length });
  } catch (error) {
    return errorResult(error, "cookbook_update", "Failed to bulk-update cookbooks");
  }
}

/**
 * Registers the cookbook_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerCookbookUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "cookbook_update",
    {
      title: "Update Cookbook",
      description:
        "Update a cookbook. Single: pass `id` + `changes` (merged onto the current cookbook). Bulk: pass `items` (full UpdateCookBook objects with id/groupId/householdId).",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => cookbookUpdateHandler(client, args),
  );
}
