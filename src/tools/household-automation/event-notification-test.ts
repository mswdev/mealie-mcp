import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

/** Base path for the household event-notifications resource. */
const BASE_PATH = "/api/households/events/notifications";

/** Minimal client surface the handler needs (eases test fakes). */
type TestClient = Pick<MealieClient, "post">;

const inputSchema = {
  item_id: z.string().describe("Notifier id, a UUID — the notifier to send a test message to"),
};

type TestArgs = { item_id: string };

/**
 * Handles event_notification_test: fires a live Apprise test message to the
 * notifier's configured target. The endpoint returns 204 (no body), so we
 * return a generic success echo.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id)
 * @returns An MCP result acknowledging the test send, or an error result
 */
export async function eventNotificationTestHandler(
  client: TestClient,
  args: TestArgs,
): Promise<CallToolResult> {
  try {
    await client.post(`${BASE_PATH}/${args.item_id}/test`, {});
    return jsonResult({ ok: true, action: "test", item_id: args.item_id });
  } catch (error) {
    return errorResult(error, "event_notification_test", "Failed to send test notification");
  }
}

/**
 * Registers the event_notification_test tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerEventNotificationTest(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "event_notification_test",
    {
      title: "Test Event Notification",
      description:
        "Send a live test message to a household event notifier's configured Apprise target. Non-destructive but hits the network (external send).",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => eventNotificationTestHandler(client, args),
  );
}
