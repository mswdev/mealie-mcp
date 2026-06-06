import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import {
  EXPLORE_TYPES,
  type ExploreType,
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
  exploreBasePath,
  projectExploreItem,
} from "./explore-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type ListClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  type: z
    .enum(EXPLORE_TYPES)
    .describe("Which public resource: cookbook, category, tag, tool, food, or household"),
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  search: z.string().optional().describe("Full-text search filter (not supported for household)"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. name)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

type ListArgs = {
  type: ExploreType;
  group_slug: string;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles explore_list: a paginated public catalog list for one of the six
 * resource types, scoped to a public group. Search is rejected for households
 * (the upstream households list has no search param — design §3.4).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated list arguments (type + group_slug + filters)
 * @returns An MCP result with concise items + pagination meta, or an error result
 */
export async function exploreListHandler(
  client: ListClient,
  args: ListArgs,
): Promise<CallToolResult> {
  if (args.type === "household" && args.search !== undefined) {
    return {
      content: [{ type: "text", text: "explore_list: search is not supported for households" }],
      isError: true,
    };
  }
  try {
    const page = await client.getPaginated<Record<string, unknown>>(
      exploreBasePath(args.type, args.group_slug),
      {
        search: args.search,
        page: args.page,
        perPage: args.perPage ?? DEFAULT_PER_PAGE,
        orderBy: args.orderBy,
        orderDirection: args.orderDirection,
      },
    );
    return jsonResult(toConcise(page, args.type));
  } catch (error) {
    return errorResult(error, "explore_list", "Failed to list public resources");
  }
}

/** Projects a page to per-type concise items plus pagination meta. */
function toConcise(
  page: PaginatedResult<Record<string, unknown>>,
  type: ExploreType,
): Record<string, unknown> {
  return {
    items: page.items.map((item) => projectExploreItem(item, type, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the explore_list tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreList(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_list",
    {
      title: "List Public Resources",
      description: `Browse a public group's cookbooks, categories, tags, tools, foods, or households (set type) without needing an account on that group. ${PUBLIC_GROUP_HINT} Returns concise items + pagination.`,
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => exploreListHandler(client, args),
  );
}
