import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type GroupSummary, projectGroup } from "./group-projection.js";

/** Default page size for the members list. */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
const SELF_PATH = "/api/groups/self";
const MEMBERS_PATH = "/api/groups/members";
const PREFERENCES_PATH = "/api/groups/preferences";
const STORAGE_PATH = "/api/groups/storage";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  view: z
    .enum(["group", "members", "preferences", "storage"])
    .optional()
    .describe("Which group view (default group)"),
  usernameOrId: z
    .string()
    .optional()
    .describe("Member username OR id to fetch one member (view=members; not validated as a uuid)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims the group view; detailed returns everything (view=group)"),
  page: z.number().int().positive().optional().describe("1-based page number (view=members)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, view=members)`),
  orderBy: z.string().optional().describe("Field to sort by (view=members)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction (view=members)"),
  orderByNullPosition: z
    .enum(["first", "last"])
    .optional()
    .describe("Where null values sort (view=members)"),
  queryFilter: z.string().optional().describe("Mealie filter expression (view=members)"),
};

type GetArgs = {
  view?: "group" | "members" | "preferences" | "storage" | undefined;
  usernameOrId?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  orderByNullPosition?: "first" | "last" | undefined;
  queryFilter?: string | undefined;
};

/**
 * Handles group_self_get: a read dispatcher over the caller's own group
 * (group | members | preferences | storage).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (view + view-specific fields)
 * @returns An MCP result for the requested view, or an error result
 */
export async function groupSelfGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "group_self_get", "Failed to read group");
  }
}

/** Routes to the requested view. */
async function read(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  if (args.view === "members") return members(client, args);
  if (args.view === "preferences") return jsonResult(await client.get(PREFERENCES_PATH));
  if (args.view === "storage") return jsonResult(await client.get(STORAGE_PATH));
  const group = await client.get<GroupSummary>(SELF_PATH);
  return jsonResult(projectGroup(group, args.response_format ?? "concise"));
}

/** Returns one member by username/id, or the paginated members list. */
async function members(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  if (args.usernameOrId) {
    return jsonResult(await client.get(`${MEMBERS_PATH}/${args.usernameOrId}`));
  }
  const page = await client.getPaginated(MEMBERS_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    orderByNullPosition: args.orderByNullPosition,
    queryFilter: args.queryFilter,
  });
  return jsonResult(page);
}

/**
 * Registers the group_self_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupSelfGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_self_get",
    {
      title: "Get Group (Self)",
      description:
        "Read your own group by view: group (default; embeds preferences + AI settings), members (paginated, or pass usernameOrId for one member), preferences, or storage (usage/quota).",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => groupSelfGetHandler(client, args),
  );
}
