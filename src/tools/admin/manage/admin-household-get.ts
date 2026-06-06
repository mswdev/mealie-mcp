import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { PaginatedResult } from "../../../client/pagination.js";
import { errorResult, jsonResult } from "../../result.js";
import { type AdminHousehold, pickFields, projectAdminHousehold } from "../admin-projection.js";

const HOUSEHOLDS_PATH = "/api/admin/households";
/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;
/** The arg fields passed through as list query params. */
const LIST_QUERY_FIELDS = ["queryFilter", "page", "perPage", "orderBy", "orderDirection"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  item_id: z.string().optional().describe("Read one household by id (plain string upstream)"),
  queryFilter: z.string().optional().describe("Mealie query filter expression"),
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
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims a by-id read; detailed includes members/webhooks"),
};

type HouseholdGetArgs = {
  item_id?: string | undefined;
  queryFilter?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles admin_household_get: lists households across ALL groups (paginated)
 * or reads one by id.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id branches to the by-id read)
 * @returns An MCP result with slim items + meta, or one projected household, or an error result
 */
export async function adminHouseholdGetHandler(
  client: GetClient,
  args: HouseholdGetArgs,
): Promise<CallToolResult> {
  try {
    if (args.item_id) return await readOne(client, args);
    return await list(client, args);
  } catch (error) {
    return errorResult(error, "admin_household_get", "Failed to read households");
  }
}

/** Reads one household by id and projects it (concise default). */
async function readOne(client: GetClient, args: HouseholdGetArgs): Promise<CallToolResult> {
  const household = await client.get<AdminHousehold>(`${HOUSEHOLDS_PATH}/${args.item_id}`);
  return jsonResult(projectAdminHousehold(household, args.response_format ?? "concise"));
}

/** Lists households with pagination passthrough and slim search items. */
async function list(client: GetClient, args: HouseholdGetArgs): Promise<CallToolResult> {
  const query = pickFields(args as Record<string, unknown>, LIST_QUERY_FIELDS);
  const page = await client.getPaginated<AdminHousehold>(HOUSEHOLDS_PATH, {
    ...query,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
  });
  return jsonResult(toSlim(page));
}

/** Projects a household page to slim list items plus pagination meta. */
function toSlim(page: PaginatedResult<AdminHousehold>): Record<string, unknown> {
  return {
    items: page.items.map((household) => ({
      id: household.id,
      name: household.name,
      slug: household.slug,
      groupId: household.groupId,
    })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the admin_household_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminHouseholdGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_household_get",
    {
      title: "Admin: Get Households",
      description:
        "List households across ALL groups on the instance (paginated) or read one by item_id (admin-only). Household ids for admin_household_write come from this list.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => adminHouseholdGetHandler(client, args),
  );
}
