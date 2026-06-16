import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import { type Label, projectLabel } from "./group-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
/** Base path for the group MultiPurpose labels resource. */
const BASE_PATH = "/api/groups/labels";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  item_id: z.string().optional().describe("Label id (uuid); omit to list all labels"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims to id/name/color; detailed returns the whole label"),
  page: z.number().int().positive().optional().describe("1-based page number (list mode)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, list mode)`),
  orderBy: z.string().optional().describe("Field to sort by, e.g. name (list mode)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction (list mode)"),
  queryFilter: z.string().optional().describe("Mealie filter expression (list mode)"),
};

type GetArgs = {
  item_id?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  queryFilter?: string | undefined;
};

/**
 * Handles label_get: a single label by id, or the paginated label list. Labels
 * are the resolution target for shopping-list labelId references.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id selects single vs list)
 * @returns An MCP result with the label(s), or an error result
 */
export async function labelGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    return args.item_id ? await getOne(client, args) : await list(client, args);
  } catch (error) {
    return errorResult(error, "label_get", "Failed to read labels");
  }
}

/** Fetches and projects a single label by id. */
async function getOne(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const label = await client.get<Label>(`${BASE_PATH}/${args.item_id}`);
  return jsonResult(projectLabel(label, args.response_format ?? "concise"));
}

/** Fetches the paginated label list and projects concise items. */
async function list(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const page = await client.getPaginated<Label>(BASE_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    queryFilter: args.queryFilter,
  });
  return jsonResult(toConcise(page));
}

/** Projects a label page to slim items plus pagination meta. */
function toConcise(page: PaginatedResult<Label>): Record<string, unknown> {
  return {
    items: page.items.map((label) => projectLabel(label, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the label_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerLabelGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "label_get",
    {
      title: "Get Labels",
      description:
        "Read MultiPurpose labels: omit item_id to list (paginated), or pass item_id for one label. Labels are the resolution target for shopping-list labelId — use this to map a label name to its id.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => labelGetHandler(client, args),
  );
}
