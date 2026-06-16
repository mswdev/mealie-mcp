import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { PaginatedResult } from "../../../client/pagination.js";
import { errorResult, jsonResult } from "../../result.js";
import { type AdminUser, pickFields, projectAdminUser } from "../admin-projection.js";

const USERS_PATH = "/api/admin/users";
/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;
/** The arg fields passed through as list query params. */
const LIST_QUERY_FIELDS = ["queryFilter", "page", "perPage", "orderBy", "orderDirection"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  item_id: z.string().optional().describe("Read one user by id (plain string upstream)"),
  queryFilter: z.string().optional().describe("Mealie query filter (e.g. email LIKE %@x.io)"),
  page: z.number().int().positive().optional().describe("1-based page number"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE})`),
  orderBy: z.string().optional().describe("Field to sort by (e.g. username)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims a by-id read; detailed returns everything"),
};

type UserGetArgs = {
  item_id?: string | undefined;
  queryFilter?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles admin_user_get: lists all users on the instance (paginated) or reads
 * one by id. cacheKey is redacted from every output.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id branches to the by-id read)
 * @returns An MCP result with slim items + meta, or one projected user, or an error result
 */
export async function adminUserGetHandler(
  client: GetClient,
  args: UserGetArgs,
): Promise<CallToolResult> {
  try {
    if (args.item_id) return await readOne(client, args);
    return await list(client, args);
  } catch (error) {
    return errorResult(error, "admin_user_get", "Failed to read users");
  }
}

/** Reads one user by id and projects it (concise default; cacheKey always dropped). */
async function readOne(client: GetClient, args: UserGetArgs): Promise<CallToolResult> {
  const user = await client.get<AdminUser>(`${USERS_PATH}/${args.item_id}`);
  return jsonResult(projectAdminUser(user, args.response_format ?? "concise"));
}

/** Lists users with pagination passthrough and slim search items. */
async function list(client: GetClient, args: UserGetArgs): Promise<CallToolResult> {
  const query = pickFields(args as Record<string, unknown>, LIST_QUERY_FIELDS);
  const page = await client.getPaginated<AdminUser>(USERS_PATH, {
    ...query,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
  });
  return jsonResult(toSlim(page));
}

/** Projects a user page to slim list items plus pagination meta. */
function toSlim(page: PaginatedResult<AdminUser>): Record<string, unknown> {
  return {
    items: page.items.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      admin: user.admin,
    })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the admin_user_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminUserGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_user_get",
    {
      title: "Admin: Get Users",
      description:
        "List all users on the instance (paginated) or read one by item_id (admin-only). The token list shows ids/names only, never token values.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => adminUserGetHandler(client, args),
  );
}
