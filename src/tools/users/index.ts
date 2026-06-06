import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerUserMe } from "./user-me.js";
import { registerUserRatingsGet } from "./user-ratings-get.js";
import { registerUserRatingsWrite } from "./user-ratings-write.js";
import { registerUserSelfUpdate } from "./user-self-update.js";

/** Options controlling which user tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the users toolset (opt-in via MEALIE_TOOLSETS=users): the current
 * user's self-service surface — profile, ratings/favorites, passwords,
 * registration, API tokens, and avatar. Reads are always registered; writes
 * only when not read-only.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerUserTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  // Reads (always on).
  registerUserMe(server, client);
  registerUserRatingsGet(server, client);

  if (options.readOnly) return;
  // Writes (stripped under read-only).
  registerUserSelfUpdate(server, client);
  registerUserRatingsWrite(server, client);
}
