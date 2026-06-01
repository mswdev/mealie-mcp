import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerCoreReadTools, registerCoreWriteTools } from "./core/index.js";
import { registerImportReadTools, registerImportWriteTools } from "./import/index.js";

/** Options controlling which recipe tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the recipes toolset. Reads are always registered; writes are
 * registered only when the server is not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerRecipeTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerCoreReadTools(server, client);
  registerImportReadTools(server, client);

  if (options.readOnly) return;
  registerCoreWriteTools(server, client);
  registerImportWriteTools(server, client);
}
