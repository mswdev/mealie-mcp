import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerAdminUserGet } from "./manage/admin-user-get.js";
import { registerAdminAbout } from "./site/admin-about.js";

/** Options controlling which admin tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the admin toolset (opt-in via MEALIE_TOOLSETS=admin): the
 * site-operator surface — manage users/households/groups, AI providers,
 * backups (incl. the double-gated restore), maintenance, email test, and
 * debug. Highest-blast-radius domain: reads are always registered; writes
 * only when not read-only.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerAdminTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  // Reads (always on).
  registerAdminAbout(server, client);
  registerAdminUserGet(server, client);

  if (options.readOnly) return;
  // Writes (stripped under read-only) — added per task.
}
