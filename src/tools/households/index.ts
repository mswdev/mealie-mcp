import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerHouseholdInvitationsList } from "./household-invitations-list.js";
import { registerHouseholdInvite } from "./household-invite.js";
import { registerHouseholdSelfGet } from "./household-self-get.js";
import { registerHouseholdSelfUpdate } from "./household-self-update.js";

/** Options controlling which household tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the households_mgmt toolset (opt-in via MEALIE_TOOLSETS=households):
 * self-service reads/writes and invitations. Reads are always registered; writes
 * are registered only when not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerHouseholdTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerHouseholdSelfGet(server, client);
  registerHouseholdInvitationsList(server, client);

  if (options.readOnly) return;
  registerHouseholdSelfUpdate(server, client);
  registerHouseholdInvite(server, client);
}
