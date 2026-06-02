import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerCookbookCreate } from "./cookbook-create.js";
import { registerCookbookDelete } from "./cookbook-delete.js";
import { registerCookbookGet } from "./cookbook-get.js";
import { registerCookbookSearch } from "./cookbook-search.js";
import { registerCookbookUpdate } from "./cookbook-update.js";

/** Options controlling which cookbook tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the cookbooks toolset. Reads are always registered; writes are
 * registered only when the server is not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerCookbookTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerCookbookSearch(server, client);
  registerCookbookGet(server, client);

  if (options.readOnly) return;
  registerCookbookCreate(server, client);
  registerCookbookUpdate(server, client);
  registerCookbookDelete(server, client);
}
