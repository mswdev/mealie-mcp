import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

/** Base path for the household webhooks resource. */
const BASE_PATH = "/api/households/webhooks";

/** Minimal client surface the handler needs (eases test fakes). */
type ActionClient = Pick<MealieClient, "post">;

const inputSchema = {
  action: z
    .enum(["test", "rerun"])
    .describe("test (fire one webhook by id) or rerun (re-fire all of today's scheduled webhooks)"),
  item_id: z.string().optional().describe("Webhook id, a UUID (action=test)"),
};

type ActionArgs = {
  action: "test" | "rerun";
  item_id?: string | undefined;
};

/**
 * Handles webhook_action: fires a test request for one webhook, or re-runs all
 * of today's scheduled webhooks. Both hit the network; the responses are untyped,
 * so we return a generic success echo rather than parsing a body.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + item_id for test)
 * @returns An MCP result acknowledging the action, or an error result
 */
export async function webhookActionHandler(
  client: ActionClient,
  args: ActionArgs,
): Promise<CallToolResult> {
  try {
    return args.action === "test" ? await test(client, args) : await rerun(client);
  } catch (error) {
    return errorResult(error, "webhook_action", "Failed to run webhook action");
  }
}

/** Fires a single webhook's test request (untyped 200 response). */
async function test(client: ActionClient, args: ActionArgs): Promise<CallToolResult> {
  if (!args.item_id) return missing("test requires item_id");
  await client.post(`${BASE_PATH}/${args.item_id}/test`, {});
  return jsonResult({ ok: true, action: "test", item_id: args.item_id });
}

/** Re-fires all of today's scheduled webhooks (untyped 200 response). */
async function rerun(client: ActionClient): Promise<CallToolResult> {
  await client.post(`${BASE_PATH}/rerun`, {});
  return jsonResult({ ok: true, action: "rerun" });
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return { content: [{ type: "text", text: `webhook_action: ${requirement}` }], isError: true };
}

/**
 * Registers the webhook_action tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerWebhookAction(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "webhook_action",
    {
      title: "Run Webhook Action",
      description:
        "Fire a household webhook: action=test sends a one-off request to a single webhook (needs item_id); action=rerun re-fires all of today's scheduled webhooks. Non-destructive but hits the network.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => webhookActionHandler(client, args),
  );
}
