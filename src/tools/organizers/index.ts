import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerOrganizerCreate } from "./organizer-create.js";
import { registerOrganizerDelete } from "./organizer-delete.js";
import { registerOrganizerGet } from "./organizer-get.js";
import { registerOrganizerSearch } from "./organizer-search.js";
import { registerOrganizerUpdate } from "./organizer-update.js";

/** Options controlling which organizer tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the organizers toolset (category/tag/tool via a type discriminator).
 * Reads are always registered; writes are registered only when not running in
 * read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerOrganizerTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerOrganizerSearch(server, client);
  registerOrganizerGet(server, client);

  if (options.readOnly) return;
  registerOrganizerCreate(server, client);
  registerOrganizerUpdate(server, client);
  registerOrganizerDelete(server, client);
}
