import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import { type UnitDetail, projectUnit } from "./unit-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  search: z.string().optional().describe("Full-text search filter (e.g. a unit name)"),
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

type SearchArgs = {
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles unit_search: lists ingredient units with pagination.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments
 * @returns An MCP result with concise items + pagination meta, or an error result
 */
export async function unitSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<UnitDetail>("/api/units", {
      ...args,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
    });
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "unit_search", "Failed to search units");
  }
}

/** Projects a unit page to concise items plus pagination meta. */
function toConcise(page: PaginatedResult<UnitDetail>): Record<string, unknown> {
  return {
    items: page.items.map((unit) => projectUnit(unit, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the unit_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUnitSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "unit_search",
    {
      title: "Search Units",
      description:
        "Search and filter ingredient units with pagination. Returns concise items (id, name, abbreviation). Use to resolve a unit name to its id for recipes/shopping items.",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => unitSearchHandler(client, args),
  );
}
