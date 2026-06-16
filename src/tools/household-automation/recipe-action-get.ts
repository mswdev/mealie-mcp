import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import { type RecipeAction, projectRecipeAction } from "./recipe-action-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
/** Base path for the household recipe-actions resource. */
const BASE_PATH = "/api/households/recipe-actions";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  item_id: z.string().optional().describe("Recipe action id (uuid); omit to list all actions"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims fields; detailed returns the whole action (with item_id)"),
  page: z.number().int().positive().optional().describe("1-based page number (list mode)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, list mode)`),
  orderBy: z.string().optional().describe("Field to sort by, e.g. title (list mode)"),
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
 * Handles recipe_action_get: one recipe action by id, or the paginated list.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id selects single vs list)
 * @returns An MCP result with the recipe action(s), or an error result
 */
export async function recipeActionGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    return args.item_id ? await getOne(client, args) : await list(client, args);
  } catch (error) {
    return errorResult(error, "recipe_action_get", "Failed to read recipe actions");
  }
}

/** Fetches and projects a single recipe action by id. */
async function getOne(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const action = await client.get<RecipeAction>(`${BASE_PATH}/${args.item_id}`);
  return jsonResult(projectRecipeAction(action, args.response_format ?? "concise"));
}

/** Fetches the paginated recipe-action list and projects concise items. */
async function list(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const page = await client.getPaginated<RecipeAction>(BASE_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    queryFilter: args.queryFilter,
  });
  return jsonResult(toConcise(page));
}

/** Projects a recipe-action page to slim items plus pagination meta. */
function toConcise(page: PaginatedResult<RecipeAction>): Record<string, unknown> {
  return {
    items: page.items.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      title: action.title,
      url: action.url,
    })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the recipe_action_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeActionGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_action_get",
    {
      title: "Get Recipe Actions",
      description:
        "Read household recipe actions (link/post actions runnable against a recipe): omit item_id to list (paginated), or pass item_id for one action.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeActionGetHandler(client, args),
  );
}
