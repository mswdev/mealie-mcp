import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import type { PlanEntry } from "./mealplan-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  startDate: z.string().optional().describe("Earliest plan date to include (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Latest plan date to include (YYYY-MM-DD)"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. date)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

type SearchArgs = {
  startDate?: string | undefined;
  endDate?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles mealplan_search: lists meal-plan entries with date-range filtering and
 * pagination. Maps startDate/endDate to Mealie's start_date/end_date query params.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments
 * @returns An MCP result with concise entries + pagination meta
 */
export async function mealplanSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<PlanEntry>("/api/households/mealplans", {
      start_date: args.startDate,
      end_date: args.endDate,
      page: args.page,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
      orderBy: args.orderBy,
      orderDirection: args.orderDirection,
    });
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "mealplan_search", "Failed to search meal plans");
  }
}

/** Projects an entry page to concise items + pagination meta. */
function toConcise(page: PaginatedResult<PlanEntry>): Record<string, unknown> {
  return {
    items: page.items.map((e) => ({
      id: e.id,
      date: e.date,
      entryType: e.entryType,
      title: e.title,
      recipeId: e.recipeId,
    })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the mealplan_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_search",
    {
      title: "Search Meal Plans",
      description:
        "List meal-plan entries with date-range filtering (startDate/endDate) and pagination. Returns concise entries (id, date, entryType, title, recipeId).",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => mealplanSearchHandler(client, args),
  );
}
