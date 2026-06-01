import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { logger } from "../../logger.js";
import type { components } from "../../types/mealie.js";
import { JSON_INDENT } from "../format.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

type RecipeSummary = components["schemas"]["RecipeSummary"];
/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "getPaginated">;

const inputSchema = {
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
};

type SearchArgs = {
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  categories?: string[] | undefined;
  tags?: string[] | undefined;
  tools?: string[] | undefined;
  foods?: string[] | undefined;
};

/**
 * Handles the recipe_search tool: lists recipes with pagination + filters.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments
 * @returns An MCP result with concise items (id, slug, name) + pagination meta
 */
export async function recipeSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const page = await client.getPaginated<RecipeSummary>("/api/recipes", {
      ...args,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(toConcise(page), null, JSON_INDENT) }],
    };
  } catch (error) {
    logger.error({ err: error }, "recipe_search failed");
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to search recipes: ${message}` }],
      isError: true,
    };
  }
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
 * Registers the recipe_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_search",
    {
      title: "Search Recipes",
      description:
        "Search and filter recipes with pagination. Returns concise summaries (id, slug, name).",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => recipeSearchHandler(client, args),
  );
}
