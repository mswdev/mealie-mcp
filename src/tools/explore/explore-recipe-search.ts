import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult, QueryParams } from "../../client/pagination.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import {
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
  exploreRecipesPath,
} from "./explore-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

type RecipeSummary = components["schemas"]["RecipeSummary"];
/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  search: z.string().optional().describe("Full-text search across recipe names/descriptions"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. name, created_at, rating)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
  categories: z.array(z.string()).optional().describe("Filter by category slugs/ids"),
  tags: z.array(z.string()).optional().describe("Filter by tag slugs/ids"),
  tools: z.array(z.string()).optional().describe("Filter by tool slugs/ids"),
  foods: z.array(z.string()).optional().describe("Filter by food ids"),
  cookbook: z
    .string()
    .optional()
    .describe("Filter to one public cookbook (id or slug — from explore_list type=cookbook)"),
};

type SearchArgs = {
  group_slug: string;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  categories?: string[] | undefined;
  tags?: string[] | undefined;
  tools?: string[] | undefined;
  foods?: string[] | undefined;
  cookbook?: string | undefined;
};

/**
 * Handles explore_recipe_search: lists a public group's recipes with the same
 * pagination + filters as recipe_search, plus the browse-relevant cookbook filter.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments (group_slug + filters)
 * @returns An MCP result with concise items (id, slug, name) + pagination meta
 */
export async function exploreRecipeSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<RecipeSummary>(
      exploreRecipesPath(args.group_slug),
      toQuery(args),
    );
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "explore_recipe_search", "Failed to search public recipes");
  }
}

/** Builds the query params — group_slug stays in the path, never the query. */
function toQuery(args: SearchArgs): QueryParams {
  return {
    search: args.search,
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    categories: args.categories,
    tags: args.tags,
    tools: args.tools,
    foods: args.foods,
    cookbook: args.cookbook,
  };
}

/** Projects a recipe page to concise items (uuid + slug + name) plus pagination meta. */
function toConcise(page: PaginatedResult<RecipeSummary>): Record<string, unknown> {
  return {
    items: page.items.map((r) => ({ id: r.id, slug: r.slug, name: r.name })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the explore_recipe_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreRecipeSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_recipe_search",
    {
      title: "Search Public Recipes",
      description: `Search and filter a public group's recipes with pagination, without needing an account on that group. ${PUBLIC_GROUP_HINT} Returns concise summaries (id, slug, name).`,
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => exploreRecipeSearchHandler(client, args),
  );
}
