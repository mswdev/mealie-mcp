import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { errorResult, jsonResult } from "../result.js";
import { type Webhook, projectWebhook } from "./webhook-projection.js";

/** Default page size — modest, never unbounded (design §1.3). */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size to keep responses bounded. */
const MAX_PER_PAGE = 100;
/** Base path for the household webhooks resource. */
const BASE_PATH = "/api/households/webhooks";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  item_id: z.string().optional().describe("Webhook id (uuid); omit to list all webhooks"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims fields; detailed returns the whole webhook (with item_id)"),
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
 * Handles webhook_get: a single webhook by id, or the paginated webhook list.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id selects single vs list)
 * @returns An MCP result with the webhook(s), or an error result
 */
export async function webhookGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    return args.item_id ? await getOne(client, args) : await list(client, args);
  } catch (error) {
    return errorResult(error, "webhook_get", "Failed to read webhooks");
  }
}

/** Fetches and projects a single webhook by id. */
async function getOne(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const hook = await client.get<Webhook>(`${BASE_PATH}/${args.item_id}`);
  return jsonResult(projectWebhook(hook, args.response_format ?? "concise"));
}

/** Fetches the paginated webhook list and projects concise items. */
async function list(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const page = await client.getPaginated<Webhook>(BASE_PATH, {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
    queryFilter: args.queryFilter,
  });
  return jsonResult(toConcise(page));
}

/** Projects a webhook page to slim items plus pagination meta. */
function toConcise(page: PaginatedResult<Webhook>): Record<string, unknown> {
  return {
    items: page.items.map((hook) => ({
      id: hook.id,
      name: hook.name,
      url: hook.url,
      enabled: hook.enabled,
      webhookType: hook.webhookType,
      scheduledTime: hook.scheduledTime,
    })),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
    totalPages: page.totalPages,
  };
}

/**
 * Registers the webhook_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerWebhookGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "webhook_get",
    {
      title: "Get Webhooks",
      description:
        "Read household webhooks: omit item_id to list (paginated), or pass item_id for one webhook. Webhooks POST meal-plan data to a URL on a daily schedule.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => webhookGetHandler(client, args),
  );
}
