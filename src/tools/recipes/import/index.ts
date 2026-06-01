import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeImport } from "./recipe-import.js";
import { registerRecipeParseIngredients } from "./recipe-parse-ingredients.js";

/**
 * Registers always-on import-group reads (the stateless ingredient parser).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerImportReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeParseIngredients(server, client);
}

/**
 * Registers import-group writes (stripped under read-only mode).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerImportWriteTools(server: McpServer, client: MealieClient): void {
  registerRecipeImport(server, client);
}
