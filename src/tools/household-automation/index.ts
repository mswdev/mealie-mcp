import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerEventNotificationGet } from "./event-notification-get.js";
import { registerEventNotificationTest } from "./event-notification-test.js";
import { registerEventNotificationWrite } from "./event-notification-write.js";
import { registerWebhookAction } from "./webhook-action.js";
import { registerWebhookGet } from "./webhook-get.js";
import { registerWebhookWrite } from "./webhook-write.js";

/** Options controlling which household-automation tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the household_automation toolset (opt-in via MEALIE_TOOLSETS=automation):
 * webhooks, event notifications, and recipe actions. Reads are always registered;
 * writes and side-effecting action verbs are registered only when not read-only.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerHouseholdAutomationTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerWebhookGet(server, client);
  registerEventNotificationGet(server, client);

  if (options.readOnly) return;
  registerWebhookWrite(server, client);
  registerWebhookAction(server, client);
  registerEventNotificationWrite(server, client);
  registerEventNotificationTest(server, client);
}
