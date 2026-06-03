import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import { type EventNotifier, projectEventNotifier } from "./event-notification-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
/** Base path for the household event-notifications resource. */
const BASE_PATH = "/api/households/events/notifications";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  item_id: z.string().optional().describe("Notifier id (uuid); omit to list all notifiers"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default, drops the 27 event toggles); detailed returns the whole notifier"),
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
  item_id?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
  queryFilter?: string | undefined;
};

/**
 * Handles event_notification_get: one notifier by id, or the paginated list.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id selects single vs list)
 * @returns An MCP result with the notifier(s), or an error result
 */
export async function eventNotificationGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    return args.item_id ? await getOne(client, args) : await list(client, args);
  } catch (error) {
    return errorResult(error, "event_notification_get", "Failed to read event notifications");
  }
}

/** Fetches and projects a single notifier by id. */
async function getOne(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const notifier = await client.get<EventNotifier>(`${BASE_PATH}/${args.item_id}`);
  return jsonResult(projectEventNotifier(notifier, args.response_format ?? "concise"));
}

/** Fetches the paginated notifier list and projects concise items. */
async function list(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const page = await client.getPaginated<EventNotifier>(BASE_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    queryFilter: args.queryFilter,
  });
  return jsonResult(toConcise(page));
}

/** Projects a notifier page to slim items plus pagination meta. */
function toConcise(page: PaginatedResult<EventNotifier>): Record<string, unknown> {
  return {
    items: page.items.map((notifier) => ({
      id: notifier.id,
      name: notifier.name,
      enabled: notifier.enabled,
    })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the event_notification_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerEventNotificationGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "event_notification_get",
    {
      title: "Get Event Notifications",
      description:
        "Read household event notifiers (Apprise targets fired on events): omit item_id to list (paginated), or pass item_id for one notifier.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => eventNotificationGetHandler(client, args),
  );
}
