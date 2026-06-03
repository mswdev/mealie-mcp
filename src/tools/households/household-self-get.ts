import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type Household, projectHousehold } from "./household-projection.js";

/** Default page size for the members list. */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
const SELF_PATH = "/api/households/self";
const PREFERENCES_PATH = "/api/households/preferences";
const STATISTICS_PATH = "/api/households/statistics";
const MEMBERS_PATH = "/api/households/members";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  view: z
    .enum(["household", "preferences", "statistics", "members", "recipe"])
    .optional()
    .describe("Which self-service view (default household)"),
  recipe_slug: z.string().optional().describe("Recipe slug (required when view=recipe)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims the household view; detailed returns everything"),
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
  queryFilter: z.string().optional().describe("Mealie filter expression (view=members)"),
};

type GetArgs = {
  view?: "household" | "preferences" | "statistics" | "members" | "recipe" | undefined;
  recipe_slug?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  queryFilter?: string | undefined;
};

/**
 * Handles household_self_get: a read dispatcher over the caller's own household
 * (household | preferences | statistics | members | recipe).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (view + view-specific fields)
 * @returns An MCP result for the requested view, or an error result
 */
export async function householdSelfGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "household_self_get", "Failed to read household");
  }
}

/** Routes to the requested view. */
async function read(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  if (args.view === "preferences") return jsonResult(await client.get(PREFERENCES_PATH));
  if (args.view === "statistics") return jsonResult(await client.get(STATISTICS_PATH));
  if (args.view === "members") return members(client, args);
  if (args.view === "recipe") return recipe(client, args);
  const self = await client.get<Household>(SELF_PATH);
  return jsonResult(projectHousehold(self, args.response_format ?? "concise"));
}

/** Returns the paginated household members list. */
async function members(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const page = await client.getPaginated(MEMBERS_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    queryFilter: args.queryFilter,
  });
  return jsonResult(page);
}

/**
 * Returns this household's thin recipe pivot ({lastMade, recipeId}) for a slug —
 * NOT full recipe content; use the recipes toolset for that.
 */
async function recipe(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  if (!args.recipe_slug) {
    return {
      content: [{ type: "text", text: "household_self_get: view=recipe requires recipe_slug" }],
      isError: true,
    };
  }
  return jsonResult(await client.get(`${SELF_PATH}/recipes/${args.recipe_slug}`));
}

/**
 * Registers the household_self_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerHouseholdSelfGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "household_self_get",
    {
      title: "Get Household (Self)",
      description:
        "Read your own household by view: household (default), preferences, statistics, members (paginated), or recipe (needs recipe_slug — returns a thin {lastMade, recipeId} pivot, not full recipe content).",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => householdSelfGetHandler(client, args),
  );
}
