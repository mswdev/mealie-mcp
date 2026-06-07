import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import {
  EXPLORE_TYPES,
  type ExploreType,
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
  exploreBasePath,
  projectExploreItem,
} from "./explore-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  type: z
    .enum(EXPLORE_TYPES)
    .describe("Which public resource: cookbook, category, tag, tool, food, or household"),
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  id: z
    .string()
    .describe(
      "Item id (uuid) for cookbook/category/tag/tool/food; the household slug for household " +
        "(the public surface offers exactly one lookup per type)",
    ),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) = key fields; detailed = the full object"),
};

type GetArgs = {
  type: ExploreType;
  group_slug: string;
  id: string;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles explore_get: fetches one public catalog item. The lookup mode is
 * routed by type — five catalog types use the item id, household uses its slug
 * (design §3.5); the URL shape is uniform either way.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (type, group_slug, id, response_format)
 * @returns An MCP result with the projected item, or an error result
 */
export async function exploreGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    const path = `${exploreBasePath(args.type, args.group_slug)}/${encodeURIComponent(args.id)}`;
    const item = await client.get<unknown>(path);
    return jsonResult(projectExploreItem(item, args.type, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "explore_get", "Failed to get public resource");
  }
}

/**
 * Registers the explore_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_get",
    {
      title: "Get Public Resource",
      description: `Get one public cookbook/category/tag/tool/food by id, or a household by slug (set type). ${PUBLIC_GROUP_HINT}`,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => exploreGetHandler(client, args),
  );
}
