import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

type ReadCookBook = components["schemas"]["ReadCookBook"];
/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  queryFilter: z
    .string()
    .optional()
    .describe("Mealie filter expression (the cookbooks list has no full-text search param)"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. name, position)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

type SearchArgs = {
  queryFilter?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles the cookbook_search tool: lists cookbooks with pagination.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments
 * @returns An MCP result with concise items (id, slug, name) + pagination meta
 */
export async function cookbookSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<ReadCookBook>("/api/households/cookbooks", {
      ...args,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
    });
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "cookbook_search", "Failed to search cookbooks");
  }
}

/** Projects a cookbook page to concise items (id + slug + name) plus pagination meta. */
function toConcise(page: PaginatedResult<ReadCookBook>): Record<string, unknown> {
  return {
    items: page.items.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the cookbook_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerCookbookSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "cookbook_search",
    {
      title: "Search Cookbooks",
      description:
        "Search and filter cookbooks with pagination. Returns concise summaries (id, slug, name).",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => cookbookSearchHandler(client, args),
  );
}
