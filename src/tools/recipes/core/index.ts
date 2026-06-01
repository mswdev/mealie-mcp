import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeCreate } from "./recipe-create.js";
import { registerRecipeDelete } from "./recipe-delete.js";
import { registerRecipeDuplicate } from "./recipe-duplicate.js";
import { registerRecipeGet } from "./recipe-get.js";
import { registerRecipeMarkMade } from "./recipe-mark-made.js";
import { registerRecipeSearch } from "./recipe-search.js";
import { registerRecipeSuggestions } from "./recipe-suggestions.js";
import { registerRecipeUpdateMany } from "./recipe-update-many.js";
import { registerRecipeUpdate } from "./recipe-update.js";

/**
 * Registers always-on recipe reads in the core group.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerCoreReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeSearch(server, client);
  registerRecipeGet(server, client);
  registerRecipeSuggestions(server, client);
}

/**
 * Registers core recipe writes (stripped under read-only mode).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerCoreWriteTools(server: McpServer, client: MealieClient): void {
  registerRecipeCreate(server, client);
  registerRecipeUpdate(server, client);
  registerRecipeDelete(server, client);
  registerRecipeUpdateMany(server, client);
  registerRecipeDuplicate(server, client);
  registerRecipeMarkMade(server, client);
}
