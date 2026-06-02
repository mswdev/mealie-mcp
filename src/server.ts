import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "./client/MealieClient.js";
import { registerAboutTools } from "./tools/about.js";
import { registerCookbookTools } from "./tools/cookbooks/index.js";
import { registerFoodsUnitsTools } from "./tools/foods-units/index.js";
import { registerMealPlanTools } from "./tools/meal-plans/index.js";
import { registerOrganizerTools } from "./tools/organizers/index.js";
import { registerRecipeTools } from "./tools/recipes/index.js";
import { registerShoppingTools } from "./tools/shopping-lists/index.js";

const SERVER_NAME = "mealie-mcp";
const SERVER_VERSION = "0.1.0";

/** Options that influence which tools the server exposes. */
export type ServerOptions = { readOnly: boolean };

/**
 * Creates and configures the MCP server with all registered tools.
 * Called once per process for stdio, or once per HTTP request for stateless HTTP mode.
 *
 * @param client - The MealieClient instance to pass to all tool handlers
 * @param options - Server options; `readOnly` strips all mutating tools when true
 * @returns A fully configured McpServer ready to connect to a transport
 */
export function createServer(client: MealieClient, options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerAboutTools(server, client);
  registerRecipeTools(server, client, options);
  registerCookbookTools(server, client, options);
  registerMealPlanTools(server, client, options);
  registerShoppingTools(server, client, options);
  registerOrganizerTools(server, client, options);
  registerFoodsUnitsTools(server, client, options);

  return server;
}
