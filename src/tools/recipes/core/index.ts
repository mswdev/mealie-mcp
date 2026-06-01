import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeCreate } from "./recipe-create.js";
import { registerRecipeGet } from "./recipe-get.js";
import { registerRecipeSearch } from "./recipe-search.js";

/**
 * Registers always-on recipe reads in the core group.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerCoreReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeSearch(server, client);
  registerRecipeGet(server, client);
}

/**
 * Registers core recipe writes (stripped under read-only mode).
 *
 * @param _server - The McpServer to register on
 * @param _client - The MealieClient passed to each handler
 */
export function registerCoreWriteTools(server: McpServer, client: MealieClient): void {
  registerRecipeCreate(server, client);
  // update/delete/update_many/duplicate/mark_made added next in Phase 2
}
