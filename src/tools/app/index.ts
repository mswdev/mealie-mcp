import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerAppDownloadFile } from "./app-download-file.js";
import { registerAppGetInfo } from "./app-get-info.js";

/**
 * Registers the app toolset (instance info + file-download URL resolver). Both
 * tools are reads, so there is no read-only split.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerAppTools(server: McpServer, client: MealieClient): void {
  registerAppGetInfo(server, client);
  registerAppDownloadFile(server, client);
}
