import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { type EventNotifier, projectEventNotifier } from "./event-notification-projection.js";

/** Base path for the household event-notifications resource. */
const BASE_PATH = "/api/households/events/notifications";

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("Notifier write operation"),
  item_id: z.string().optional().describe("Notifier id, a UUID (action=update/delete)"),
  name: z.string().optional().describe("Notifier name (action=create)"),
  appriseUrl: z
    .string()
    .optional()
    .describe("Apprise URL the notifier sends to (action=create, optional)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change, merged onto the current notifier (action=update)"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type WriteArgs = {
  action: "create" | "update" | "delete";
  item_id?: string | undefined;
  name?: string | undefined;
  appriseUrl?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles event_notification_write: create, update (fetch-merge), or delete
 * (confirm-gated) a household event notifier.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected notifier, or an error result
 */
export async function eventNotificationWriteHandler(
  client: WriteClient,
  args: WriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "event_notification_write", "Failed to write event notification");
  }
}

/** POSTs a new notifier (minimal create body: name + optional appriseUrl). */
async function create(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.name) return missing("create requires name");
  const body: components["schemas"]["GroupEventNotifierCreate"] = {
    name: args.name,
    ...(args.appriseUrl !== undefined ? { appriseUrl: args.appriseUrl } : {}),
  };
  return jsonResult(
    projectEventNotifier(await client.post<EventNotifier>(BASE_PATH, body), "concise"),
  );
}

/**
 * PUTs an edited notifier. GroupEventNotifierUpdate is a distinct schema but
 * still a FULL replace (name/enabled/groupId/householdId/options/id all required),
 * so we fetch the current notifier and merge changes — the fetched record carries
 * the 27-toggle `options` block, preserving it when only a subset is changed.
 */
async function update(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id || !args.changes) return missing("update requires item_id and changes");
  const path = `${BASE_PATH}/${args.item_id}`;
  const current = await client.get<Record<string, unknown>>(path);
  const merged = { ...current, ...args.changes };
  return jsonResult(projectEventNotifier(await client.put<EventNotifier>(path, merged), "concise"));
}

/** DELETEs a notifier (confirm-gated). The endpoint returns 204 (no body). */
async function remove(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id) return missing("delete requires item_id");
  const unconfirmed = requireConfirmation(args.confirm, `delete event notifier "${args.item_id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${BASE_PATH}/${args.item_id}`);
    return jsonResult({ deleted: args.item_id });
  } catch (error) {
    return errorResult(error, "event_notification_write", "Failed to delete event notification");
  }
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `event_notification_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the event_notification_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerEventNotificationWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "event_notification_write",
    {
      title: "Write Event Notification",
      description:
        "Create, edit, or delete a household event notifier. create needs name (appriseUrl optional); update merges changes onto the current notifier (full replace, preserves the 27 event toggles). Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => eventNotificationWriteHandler(client, args),
  );
}
