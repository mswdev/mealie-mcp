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
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource: category, tag, or tool"),
  id: z.string().describe("Organizer id (uuid), or slug when by_slug=true"),
  by_slug: z.boolean().optional().describe("Look up by slug instead of id"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) = id/slug/name; detailed = the full object"),
};

type GetArgs = {
  type: OrganizerType;
  id: string;
  by_slug?: boolean | undefined;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles organizer_get: fetches one organizer by id (default) or by slug, then
 * projects it. To list recipes for an organizer, use recipe_search instead.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (type, id, by_slug, response_format)
 * @returns An MCP result with the projected organizer, or an error result
 */
export async function organizerGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const base = organizerBasePath(args.type);
    const path = args.by_slug ? `${base}/slug/${args.id}` : `${base}/${args.id}`;
    const organizer = await client.get<unknown>(path);
    return jsonResult(projectOrganizer(organizer, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "organizer_get", "Failed to get organizer");
  }
}

/**
 * Registers the organizer_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerOrganizerGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "organizer_get",
    {
      title: "Get Organizer",
      description:
        "Get one organizer (category/tag/tool) by id, or by slug with by_slug=true. To list recipes for an organizer, use recipe_search with categories/tags/tools.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => organizerGetHandler(client, args),
  );
}
