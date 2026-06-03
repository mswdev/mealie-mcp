import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { type Webhook, projectWebhook } from "./webhook-projection.js";

/** Base path for the household webhooks resource. */
const BASE_PATH = "/api/households/webhooks";
/** Must match components["schemas"]["WebhookType"] exactly (single-member enum). */
const WEBHOOK_TYPES = ["mealplan"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("Webhook write operation"),
  item_id: z.string().optional().describe("Webhook id, a UUID (action=update/delete)"),
  name: z.string().optional().describe("Webhook name (action=create)"),
  url: z.string().optional().describe("Target URL the webhook POSTs to (action=create)"),
  webhookType: z
    .enum(WEBHOOK_TYPES)
    .optional()
    .describe("Event type; only 'mealplan' (action=create, default mealplan)"),
  enabled: z.boolean().optional().describe("Whether the webhook is active (action=create)"),
  scheduledTime: z
    .string()
    .optional()
    .describe("Daily fire time as HH:MM (action=create, required)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change, merged onto the current webhook (action=update)"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type WriteArgs = {
  action: "create" | "update" | "delete";
  item_id?: string | undefined;
  name?: string | undefined;
  url?: string | undefined;
  webhookType?: (typeof WEBHOOK_TYPES)[number] | undefined;
  enabled?: boolean | undefined;
  scheduledTime?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles webhook_write: create, update (fetch-merge), or delete (confirm-gated)
 * a household webhook.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected webhook, or an error result
 */
export async function webhookWriteHandler(
  client: WriteClient,
  args: WriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "webhook_write", "Failed to write webhook");
  }
}

/** POSTs a new webhook, supplying required-with-default fields. */
async function create(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.name || !args.url || !args.scheduledTime) {
    return missing("create requires name, url, and scheduledTime");
  }
  const body: components["schemas"]["CreateWebhook"] = {
    enabled: args.enabled ?? true,
    name: args.name,
    url: args.url,
    webhookType: args.webhookType ?? "mealplan",
    scheduledTime: args.scheduledTime,
  };
  return jsonResult(projectWebhook(await client.post<Webhook>(BASE_PATH, body), "concise"));
}

/**
 * PUTs an edited webhook. The endpoint reuses CreateWebhook (full replace, no
 * distinct Update schema), so we fetch the current webhook and merge changes —
 * otherwise an omitted field would silently reset to its schema default.
 */
async function update(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id || !args.changes) return missing("update requires item_id and changes");
  const path = `${BASE_PATH}/${args.item_id}`;
  const current = await client.get<Record<string, unknown>>(path);
  const merged = { ...current, ...args.changes };
  return jsonResult(projectWebhook(await client.put<Webhook>(path, merged), "concise"));
}

/** DELETEs a webhook (confirm-gated). Mealie echoes the entity; we synthesize {deleted}. */
async function remove(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id) return missing("delete requires item_id");
  const unconfirmed = requireConfirmation(args.confirm, `delete webhook "${args.item_id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${BASE_PATH}/${args.item_id}`);
    return jsonResult({ deleted: args.item_id });
  } catch (error) {
    return errorResult(error, "webhook_write", "Failed to delete webhook");
  }
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return { content: [{ type: "text", text: `webhook_write: ${requirement}` }], isError: true };
}

/**
 * Registers the webhook_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerWebhookWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "webhook_write",
    {
      title: "Write Webhook",
      description:
        "Create, edit, or delete a household webhook. create needs name/url/scheduledTime; update merges changes onto the current webhook (full replace). Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => webhookWriteHandler(client, args),
  );
}
