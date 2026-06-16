import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";

/** Default page size for the timeline events list. */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size. */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type TimelineClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  action: z.enum(["list", "get"]).optional().describe("list events (paginated) or get one by id"),
  eventId: z.string().optional().describe("Timeline event id (action=get)"),
  queryFilter: z
    .string()
    .optional()
    .describe('Mealie query filter, e.g. recipe_id="<uuid>" to scope to one recipe (action=list)'),
  page: z.number().int().positive().optional().describe("1-based page number (action=list)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, action=list)`),
  orderBy: z.string().optional().describe("Field to sort by (action=list)"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction (action=list)"),
};

type TimelineArgs = {
  action?: "list" | "get" | undefined;
  eventId?: string | undefined;
  queryFilter?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles recipe_timeline (reads): the paginated timeline events (optionally
 * filtered to one recipe) or a single event by id.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the requested events, or an error result
 */
export async function recipeTimelineHandler(
  client: TimelineClient,
  args: TimelineArgs,
): Promise<CallToolResult> {
  try {
    if ((args.action ?? "list") === "get") {
      if (!args.eventId) {
        return {
          content: [{ type: "text", text: "recipe_timeline: get requires eventId" }],
          isError: true,
        };
      }
      return jsonResult(await client.get(`/api/recipes/timeline/events/${args.eventId}`));
    }
    const page = await client.getPaginated("/api/recipes/timeline/events", {
      queryFilter: args.queryFilter,
      page: args.page,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
      orderBy: args.orderBy,
      orderDirection: args.orderDirection,
    });
    return jsonResult(page);
  } catch (error) {
    return errorResult(error, "recipe_timeline", "Failed to read timeline events");
  }
}

/**
 * Registers the recipe_timeline read tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeTimeline(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_timeline",
    {
      title: "Read Recipe Timeline",
      description:
        "Read recipe timeline events (made-this, comments, etc.). list is paginated and can be filtered by recipe via queryFilter; get fetches one event. Use recipe_timeline_write to modify.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeTimelineHandler(client, args),
  );
}
