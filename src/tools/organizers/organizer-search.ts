import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import {
  ORGANIZER_TYPES,
  type OrganizerType,
  organizerBasePath,
  projectOrganizer,
} from "./organizer-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded (design §1.3). */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type SearchClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource: category, tag, or tool"),
  empty_only: z
    .boolean()
    .optional()
    .describe("Only those with no recipes (category/tag only; invalid for tool)"),
  search: z.string().optional().describe("Full-text search filter"),
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
  type: OrganizerType;
  empty_only?: boolean | undefined;
  search?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles organizer_search: a paginated list, or the un-enveloped "empty" subset
 * (categories/tags with no recipes). Concise items are id/slug/name.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated search arguments (type + filters)
 * @returns An MCP result with concise items + pagination meta (or a bare empty list)
 */
export async function organizerSearchHandler(
  client: SearchClient,
  args: SearchArgs,
): Promise<CallToolResult> {
  if (args.empty_only) return searchEmpty(client, args.type);
  try {
    const page = await client.getPaginated<Record<string, unknown>>(organizerBasePath(args.type), {
      search: args.search,
      page: args.page,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
      orderBy: args.orderBy,
      orderDirection: args.orderDirection,
    });
    return jsonResult(toConcise(page));
  } catch (error) {
    return errorResult(error, "organizer_search", "Failed to search organizers");
  }
}

/** Fetches the un-enveloped /empty list (category/tag only; tool has no /empty). */
async function searchEmpty(client: SearchClient, type: OrganizerType): Promise<CallToolResult> {
  if (type === "tool") {
    return {
      content: [{ type: "text", text: "organizer_search: empty_only is not supported for tools" }],
      isError: true,
    };
  }
  try {
    const items = await client.get<unknown>(`${organizerBasePath(type)}/empty`);
    const list = Array.isArray(items) ? items.map((item) => projectOrganizer(item, "concise")) : [];
    return jsonResult({ items: list, count: list.length });
  } catch (error) {
    return errorResult(error, "organizer_search", "Failed to list empty organizers");
  }
}

/** Projects a page to concise items (id/slug/name) plus pagination meta. */
function toConcise(page: PaginatedResult<Record<string, unknown>>): Record<string, unknown> {
  return {
    items: page.items.map((item) => projectOrganizer(item, "concise")),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the organizer_search tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerOrganizerSearch(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "organizer_search",
    {
      title: "Search Organizers",
      description:
        "Search recipe categories, tags, or tools (set type). empty_only returns those with no recipes (category/tag only). Returns concise items (id, slug, name) + pagination.",
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => organizerSearchHandler(client, args),
  );
}
