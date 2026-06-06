import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerExploreGet } from "./explore-get.js";
import { registerExploreList } from "./explore-list.js";
import { registerExploreRecipeGet } from "./explore-recipe-get.js";
import { registerExploreRecipeSearch } from "./explore-recipe-search.js";
import { registerExploreRecipeSuggestions } from "./explore-recipe-suggestions.js";

/**
 * Registers the explore toolset — the public, unauthenticated browse surface
 * (/api/explore/groups/{group_slug}/...). All five tools are reads, so there is
 * no read-only split and the registrar takes no options (registerAppTools
 * precedent); the toolset fully survives MEALIE_READ_ONLY.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerExploreTools(server: McpServer, client: MealieClient): void {
  registerExploreRecipeSearch(server, client);
  registerExploreRecipeGet(server, client);
  registerExploreRecipeSuggestions(server, client);
  registerExploreList(server, client);
  registerExploreGet(server, client);
}
