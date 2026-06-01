import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerRecipeGet } from "./recipe-get.js";
import { registerRecipeSearch } from "./recipe-search.js";

/**
 * Registers all recipe tools (the "recipes" toolset).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each tool handler
 */
export function registerRecipeTools(server: McpServer, client: MealieClient): void {
  registerRecipeSearch(server, client);
  registerRecipeGet(server, client);
}
