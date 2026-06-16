import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeBulkActions } from "./recipe-bulk-actions.js";
import { registerRecipeExportRun } from "./recipe-export-run.js";
import { registerRecipeExport } from "./recipe-export.js";

/**
 * Registers always-on batch reads (export reads).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerBatchReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeExport(server, client);
}

/**
 * Registers batch writes (stripped under read-only mode).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerBatchWriteTools(server: McpServer, client: MealieClient): void {
  registerRecipeBulkActions(server, client);
  registerRecipeExportRun(server, client);
}
