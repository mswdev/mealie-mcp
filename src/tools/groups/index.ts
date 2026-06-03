import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerGroupSelfGet } from "./group-self-get.js";
import { registerGroupSelfUpdate } from "./group-self-update.js";
import { registerLabelGet } from "./label-get.js";
import { registerLabelWrite } from "./label-write.js";

/** Options controlling which group tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the groups toolset (opt-in via MEALIE_TOOLSETS=groups): group
 * self-service, household listing, labels, AI providers, reports, seeders, and
 * data migration. Reads are always registered; writes only when not read-only.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerGroupTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  // Reads (always on).
  registerGroupSelfGet(server, client);
  registerLabelGet(server, client);

  if (options.readOnly) return;
  // Writes (stripped under read-only).
  registerGroupSelfUpdate(server, client);
  registerLabelWrite(server, client);
}
