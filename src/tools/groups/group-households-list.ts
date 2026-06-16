import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import { type HouseholdSummary, projectHouseholdSummary } from "./group-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
/** Base path for the group-scoped household listing. */
const BASE_PATH = "/api/groups/households";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  household_slug: z
    .string()
    .optional()
    .describe("Household slug (NOT a uuid); omit to list all households in the group"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims to id/slug/name; detailed returns the whole household"),
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
  household_slug?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  queryFilter?: string | undefined;
};

/**
 * Handles group_households_list: the group's household roster. Lists all
 * households (paginated) or fetches one by slug. This is the group-scoped
 * read-only listing — distinct from the household_* self-service toolset.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (household_slug selects single vs list)
 * @returns An MCP result with the household(s), or an error result
 */
export async function groupHouseholdsListHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    return args.household_slug ? await getOne(client, args) : await list(client, args);
  } catch (error) {
    return errorResult(error, "group_households_list", "Failed to read households");
  }
}

/** Fetches and projects a single household by slug. */
async function getOne(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const household = await client.get<HouseholdSummary>(`${BASE_PATH}/${args.household_slug}`);
  return jsonResult(projectHouseholdSummary(household, args.response_format ?? "concise"));
}

/** Fetches the paginated household list and projects concise items. */
async function list(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const page = await client.getPaginated<HouseholdSummary>(BASE_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    queryFilter: args.queryFilter,
  });
  return jsonResult(toConcise(page));
}

/** Projects a household page to slim items plus pagination meta. */
function toConcise(page: PaginatedResult<HouseholdSummary>): Record<string, unknown> {
  return {
    items: page.items.map((household) => projectHouseholdSummary(household, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the group_households_list tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupHouseholdsList(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_households_list",
    {
      title: "List Group Households",
      description:
        "List the households in your group (paginated), or pass household_slug for one. Read-only group-scoped roster — distinct from the household_* self-service tools.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => groupHouseholdsListHandler(client, args),
  );
}
